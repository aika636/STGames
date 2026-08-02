// Ввод: мышь/тач по доске, клавиатура и кнопки действий под доской.
//
// Модуль не хранит состояние партии и ничего в ней не меняет — он только превращает
// события браузера в вызовы переданных обработчиков (onDigit, onErase, onMove, ...).
// Всю логику хода делает modal.js, так что здесь нет ни импорта game.js, ни знания о ST.
//
// Главный подводный камень фазы — глобальные хоткеи SillyTavern. Слушатель клавиатуры
// вешается на document в фазе перехвата (capture) и живёт только пока открыто окно;
// на каждую обработанную клавишу зовётся stopPropagation() + preventDefault(), иначе
// цифры уедут в поле ввода чата.

import { SIZE } from '../core/grid.js';

// --- Панель действий под доской
//
// Экранного ряда цифр 1–9 здесь нет намеренно: цифры вводятся с клавиатуры, а кнопки
// numpad'а занимали половину окна. Счётчик оставшихся цифр живёт отдельно, в board.js.

const PAD_ACTIONS = Object.freeze([
    { key: 'notes', label: 'Заметки', icon: 'fa-pencil', title: 'Режим заметок (N)' },
    { key: 'erase', label: 'Стереть', icon: 'fa-eraser', title: 'Стереть (Del)' },
    { key: 'undo', label: 'Отменить', icon: 'fa-rotate-left', title: 'Отменить (Ctrl+Z)' },
    { key: 'redo', label: 'Вернуть', icon: 'fa-rotate-right', title: 'Вернуть (Ctrl+Y)' },
]);

// handlers: { onErase(), onToggleNotes(), onUndo(), onRedo() }
export function createControls(handlers = {}) {
    const root = document.createElement('div');
    root.className = 'sudoku-pad';

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

    root.appendChild(actionsRow);

    const update = ({ notesMode = false, canUndo = false, canRedo = false } = {}) => {
        actionButtons.get('notes').classList.toggle('sudoku-pad-on', notesMode);
        actionButtons.get('notes').setAttribute('aria-pressed', String(notesMode));
        actionButtons.get('undo').classList.toggle('sudoku-pad-off', !canUndo);
        actionButtons.get('redo').classList.toggle('sudoku-pad-off', !canRedo);
    };

    update();

    return { root, actionButtons, update };
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

// Клавиши, которые остаются за <select> уровня: листание списка и его открытие/закрытие.
const SELECT_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Enter', 'Escape', ' ', 'Tab',
]);

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
        if (root?.contains?.(target)) {
            // В текстовых полях не перехватываем ничего — там игрок печатает.
            if (target.closest?.('input, textarea, [contenteditable="true"]')) return;
            // А вот select уровня забирает фокус сам (ST фокусирует первый элемент
            // попапа при открытии), и игрок этого не видит. Отдаём ему только клавиши
            // навигации по списку — иначе цифры молча пропадали бы до первого клика
            // по кнопке.
            if (target.closest?.('select') && SELECT_KEYS.has(event.key)) return;
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
