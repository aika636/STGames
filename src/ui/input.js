// Ввод: мышь/тач по доске, клавиатура и экранный numpad.
//
// Модуль не хранит состояние партии и ничего в ней не меняет — он только превращает
// события браузера в вызовы переданных обработчиков (onDigit, onErase, onMove, ...).
// Всю логику хода делает modal.js, так что здесь нет ни импорта game.js, ни знания о ST.
//
// Главный подводный камень фазы — глобальные хоткеи SillyTavern. Слушатель клавиатуры
// вешается на document в фазе перехвата (capture) и живёт только пока открыто окно;
// на каждую обработанную клавишу зовётся stopPropagation() + preventDefault(), иначе
// цифры уедут в поле ввода чата.

import { DIGITS, SIZE } from '../core/grid.js';

// --- Экранный numpad

const PAD_ACTIONS = Object.freeze([
    { key: 'notes', label: 'Заметки', icon: 'fa-pencil', title: 'Режим заметок (N)' },
    { key: 'erase', label: 'Стереть', icon: 'fa-eraser', title: 'Стереть (Del)' },
    { key: 'undo', label: 'Отменить', icon: 'fa-rotate-left', title: 'Отменить (Ctrl+Z)' },
    { key: 'redo', label: 'Вернуть', icon: 'fa-rotate-right', title: 'Вернуть (Ctrl+Y)' },
]);

// handlers: { onDigit(digit), onErase(), onToggleNotes(), onUndo(), onRedo() }
export function createNumpad(handlers = {}) {
    const root = document.createElement('div');
    root.className = 'sudoku-pad';

    const digitsRow = document.createElement('div');
    digitsRow.className = 'sudoku-pad-digits';

    const digitButtons = new Map();
    for (const digit of DIGITS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sudoku-pad-btn';
        button.dataset.digit = String(digit);
        button.setAttribute('aria-label', `Цифра ${digit}`);

        const label = document.createElement('span');
        label.className = 'sudoku-pad-digit';
        label.textContent = String(digit);

        // Сколько этой цифры ещё не выставлено. Пустой текст, пока не пришло состояние.
        const left = document.createElement('span');
        left.className = 'sudoku-pad-left';

        button.append(label, left);
        digitsRow.appendChild(button);
        digitButtons.set(digit, { button, left });
    }

    // Делегирование: одна подписка вместо девяти, и кнопки можно перерисовывать.
    digitsRow.addEventListener('click', (event) => {
        const button = event.target.closest?.('.sudoku-pad-btn');
        if (!button || !digitsRow.contains(button)) return;
        handlers.onDigit?.(Number(button.dataset.digit));
    });

    const actionsRow = document.createElement('div');
    actionsRow.className = 'sudoku-pad-actions';

    const actionButtons = new Map();
    for (const action of PAD_ACTIONS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sudoku-pad-action menu_button';
        button.dataset.action = action.key;
        button.title = action.title;
        button.setAttribute('aria-label', action.label);

        const icon = document.createElement('i');
        icon.className = `fa-solid ${action.icon}`;
        const text = document.createElement('span');
        text.className = 'sudoku-pad-action-label';
        text.textContent = action.label;

        button.append(icon, text);
        actionsRow.appendChild(button);
        actionButtons.set(action.key, button);
    }

    actionsRow.addEventListener('click', (event) => {
        const button = event.target.closest?.('.sudoku-pad-action');
        if (!button || !actionsRow.contains(button)) return;
        switch (button.dataset.action) {
            case 'notes': handlers.onToggleNotes?.(); break;
            case 'erase': handlers.onErase?.(); break;
            case 'undo': handlers.onUndo?.(); break;
            case 'redo': handlers.onRedo?.(); break;
        }
    });

    root.append(digitsRow, actionsRow);

    // counts: { 1: сколько осталось, ... }; флаги — состояние режима и истории.
    const update = ({ counts = {}, notesMode = false, canUndo = false, canRedo = false } = {}) => {
        for (const digit of DIGITS) {
            const { button, left } = digitButtons.get(digit);
            const remaining = counts[digit] ?? 0;
            left.textContent = remaining > 0 ? String(remaining) : '';
            // Все девять выставлены — кнопка гаснет, но остаётся кликабельной: цифру
            // ещё могут стирать и переставлять, а недоступная кнопка сбивала бы с толку.
            button.classList.toggle('sudoku-pad-done', remaining <= 0);
        }
        actionButtons.get('notes').classList.toggle('sudoku-pad-on', notesMode);
        actionButtons.get('notes').setAttribute('aria-pressed', String(notesMode));
        actionButtons.get('undo').classList.toggle('sudoku-pad-off', !canUndo);
        actionButtons.get('redo').classList.toggle('sudoku-pad-off', !canRedo);
    };

    update();

    return { root, digitButtons, actionButtons, update };
}

// --- Мышь и тач по доске

// onSelect(idx) — клик по клетке. Возвращает функцию отписки.
export function attachPointer(boardRoot, onSelect) {
    const onClick = (event) => {
        const cell = event.target.closest?.('.sudoku-cell');
        if (!cell || !boardRoot.contains(cell)) return;
        onSelect(Number(cell.dataset.idx));
    };

    // Клик по доске не должен уводить фокус в чат и выделять текст при быстром вводе.
    const onMouseDown = (event) => {
        if (event.target.closest?.('.sudoku-cell')) event.preventDefault();
    };

    boardRoot.addEventListener('click', onClick);
    boardRoot.addEventListener('mousedown', onMouseDown);

    return () => {
        boardRoot.removeEventListener('click', onClick);
        boardRoot.removeEventListener('mousedown', onMouseDown);
    };
}

// --- Клавиатура

// Клавиша 'n' на ЙЦУКЕН даёт 'т' — раскладку игрок посреди партии не переключает.
const NOTES_KEYS = new Set(['n', 'N', 'т', 'Т']);

const MOVES = Object.freeze({
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -SIZE,
    ArrowDown: SIZE,
});

// handlers: { onDigit, onErase, onMove(delta), onToggleNotes, onUndo, onRedo }.
// root — корень окна игры: события из полей ввода внутри него (селектор уровня)
// не перехватываются, всё остальное — да.
export function attachKeyboard(root, handlers = {}) {
    const onKeyDown = (event) => {
        if (event.altKey || event.metaKey) return;

        const target = event.target;
        // Свои же контролы (select уровня) должны нормально работать стрелками.
        if (root?.contains?.(target) && target.closest?.('select, input, textarea, [contenteditable="true"]')) {
            return;
        }

        const handled = dispatch(event, handlers);
        if (!handled) return;

        // Ради этих двух строк слушатель и висит в capture: иначе цифра уйдёт
        // в поле ввода чата, а стрелки прокрутят историю сообщений ST.
        event.preventDefault();
        event.stopPropagation();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
}

function dispatch(event, handlers) {
    const key = event.key;

    if (event.ctrlKey) {
        // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — привычная тройка отмены.
        if (key === 'z' || key === 'Z' || key === 'я' || key === 'Я') {
            if (event.shiftKey) handlers.onRedo?.();
            else handlers.onUndo?.();
            return true;
        }
        if (key === 'y' || key === 'Y' || key === 'н' || key === 'Н') {
            handlers.onRedo?.();
            return true;
        }
        return false;
    }

    if (key >= '1' && key <= '9') {
        handlers.onDigit?.(Number(key));
        return true;
    }

    if (key === '0' || key === 'Delete' || key === 'Backspace') {
        handlers.onErase?.();
        return true;
    }

    if (key in MOVES) {
        handlers.onMove?.(MOVES[key]);
        return true;
    }

    if (NOTES_KEYS.has(key)) {
        handlers.onToggleNotes?.();
        return true;
    }

    return false;
}

// Сдвиг выделения на delta с учётом краёв доски: по горизонтали строка не
// «перепрыгивает» на следующую, по вертикали упирается в верх и низ.
export function moveSelection(selected, delta) {
    if (selected === null || selected === undefined) {
        // Первое нажатие стрелки при пустом выделении ставит курсор в левый верхний угол.
        return 0;
    }
    if (delta === -1 || delta === 1) {
        const col = selected % SIZE;
        const nextCol = col + delta;
        if (nextCol < 0 || nextCol >= SIZE) return selected;
        return selected + delta;
    }
    const next = selected + delta;
    if (next < 0 || next >= SIZE * SIZE) return selected;
    return next;
}
