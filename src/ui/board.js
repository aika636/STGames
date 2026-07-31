// Отрисовка доски 9×9. Модуль знает про DOM, но ничего не знает про SillyTavern:
// на вход ему дают состояние партии из src/core/game.js, наружу он отдаёт корневой
// элемент и функцию render().
//
// DOM строится один раз (81 клетка), дальше render() только переставляет классы и текст.
// Перерисовка «снести и построить заново» на каждый ход была бы заметна на слабых
// телефонах и убивала бы фокус клавиатуры.

import { CELLS, COL_OF, DIGITS, ROW_OF, SIZE } from '../core/grid.js';
import { getConflicts, getMistakes, hasNote, isGiven } from '../core/game.js';

export function createBoard() {
    const root = document.createElement('div');
    root.className = 'sudoku-board';
    root.setAttribute('role', 'grid');
    root.setAttribute('aria-label', 'Судоку');

    const cells = [];

    for (let idx = 0; idx < CELLS; idx++) {
        const cell = document.createElement('div');
        cell.className = 'sudoku-cell';
        cell.setAttribute('role', 'gridcell');
        cell.dataset.idx = String(idx);

        // Утолщённые границы боксов рисуются по data-атрибутам, а не по громоздким
        // nth-child-селекторам: так правило в CSS читается и не ломается при правках.
        if (COL_OF[idx] % 3 === 0 && COL_OF[idx] !== 0) cell.dataset.boxLeft = '1';
        if (ROW_OF[idx] % 3 === 0 && ROW_OF[idx] !== 0) cell.dataset.boxTop = '1';

        const value = document.createElement('span');
        value.className = 'sudoku-value';
        cell.appendChild(value);

        const notes = document.createElement('div');
        notes.className = 'sudoku-notes';
        for (const digit of DIGITS) {
            const note = document.createElement('span');
            note.className = 'sudoku-note';
            note.textContent = String(digit);
            notes.appendChild(note);
        }
        cell.appendChild(notes);

        root.appendChild(cell);
        cells.push({ cell, value, notes: Array.from(notes.children) });
    }

    return {
        root,
        cells,
        render: (state, options) => render(root, cells, state, options),
    };
}

// Ряд цифр 1–9 под доской: он же счётчик оставшихся, он же экранный numpad.
// Одним элементом, а не двумя: на телефоне физической клавиатуры нет, а держать
// отдельно «сколько осталось» и «куда нажать» — лишняя строка на узком экране.
// onDigit(digit) необязателен: без него ряд остаётся просто счётчиком.
export function createRemainingCounter(onDigit) {
    const root = document.createElement('div');
    root.className = 'sudoku-remaining';

    const items = new Map();
    for (const digit of DIGITS) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'sudoku-remaining-item';
        item.dataset.digit = String(digit);
        item.setAttribute('aria-label', `Цифра ${digit}`);

        const label = document.createElement('span');
        label.className = 'sudoku-remaining-digit';
        label.textContent = String(digit);

        const left = document.createElement('span');
        left.className = 'sudoku-remaining-left';

        item.append(label, left);
        root.appendChild(item);
        items.set(digit, { item, left });
    }

    if (typeof onDigit === 'function') {
        root.addEventListener('click', (event) => {
            const button = event.target.closest?.('.sudoku-remaining-item');
            if (!button || !root.contains(button)) return;
            onDigit(Number(button.dataset.digit));
        });
        // Тап по цифре не должен уводить фокус с корня окна: иначе следующая клавиша
        // с физической клавиатуры уйдёт кнопке, а не игре.
        root.addEventListener('mousedown', (event) => {
            if (event.target.closest?.('.sudoku-remaining-item')) event.preventDefault();
        });
    }

    const update = (counts = {}) => {
        for (const digit of DIGITS) {
            const { item, left } = items.get(digit);
            const remaining = counts[digit] ?? 0;
            left.textContent = String(Math.max(remaining, 0));
            // Цифра выставлена вся — пункт гаснет, но остаётся на месте: строка не
            // должна дёргаться по ширине при каждом ходе.
            item.classList.toggle('sudoku-remaining-done', remaining <= 0);
        }
    };

    update();

    return { root, items, update };
}

// selected — индекс выбранной клетки или null. Оба флага подсветки берутся из настроек.
// highlightMistakes сверяет доску с решением, поэтому подсвечивает и ошибки, которые
// пока ни с чем не конфликтуют; подсказки в него не попадают — они всегда верны.
function render(
    root,
    cells,
    state,
    { selected = null, highlightConflicts = true, highlightMistakes = false } = {},
) {
    const conflicts = highlightConflicts ? getConflicts(state) : EMPTY_SET;
    const mistakes = highlightMistakes ? getMistakes(state) : EMPTY_SET;
    const selectedValue = selected === null ? 0 : state.values[selected];

    for (let idx = 0; idx < CELLS; idx++) {
        const { cell, value, notes } = cells[idx];
        const digit = state.values[idx];

        value.textContent = digit ? String(digit) : '';
        cell.classList.toggle('sudoku-given', isGiven(state, idx));
        cell.classList.toggle('sudoku-filled', digit !== 0);
        cell.classList.toggle('sudoku-conflict', conflicts.has(idx));
        cell.classList.toggle('sudoku-mistake', mistakes.has(idx));

        // Подсветка: сама клетка и все клетки с той же цифрой. Строку/столбец/бокс
        // выбранной клетки не подсвечиваем — сплошная заливка трёх юнитов забивает
        // доску сильнее, чем помогает читать её.
        cell.classList.toggle('sudoku-selected', idx === selected);
        cell.classList.toggle(
            'sudoku-same',
            selectedValue !== 0 && idx !== selected && digit === selectedValue,
        );

        const hasValue = digit !== 0;
        for (let d = 0; d < SIZE; d++) {
            notes[d].classList.toggle('sudoku-note-on', !hasValue && hasNote(state, idx, d + 1));
        }

        cell.setAttribute('aria-label', describeCell(state, idx));
    }

    root.classList.toggle('sudoku-board-done', Boolean(state.completedAt));
}

const EMPTY_SET = new Set();

// Подпись для скринридера: «строка 3, столбец 5, подсказка 7» / «пусто».
function describeCell(state, idx) {
    const position = `строка ${ROW_OF[idx] + 1}, столбец ${COL_OF[idx] + 1}`;
    const digit = state.values[idx];
    if (!digit) return `${position}, пусто`;
    return `${position}, ${isGiven(state, idx) ? 'подсказка' : 'цифра'} ${digit}`;
}
