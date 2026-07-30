// Отрисовка доски 9×9. Модуль знает про DOM, но ничего не знает про SillyTavern:
// на вход ему дают состояние партии из src/core/game.js, наружу он отдаёт корневой
// элемент и функцию render().
//
// DOM строится один раз (81 клетка), дальше render() только переставляет классы и текст.
// Перерисовка «снести и построить заново» на каждый ход была бы заметна на слабых
// телефонах и убивала бы фокус клавиатуры.

import { BOX_OF, CELLS, COL_OF, DIGITS, ROW_OF, SIZE } from '../core/grid.js';
import { getConflicts, hasNote, isGiven } from '../core/game.js';

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

// selected — индекс выбранной клетки или null. highlightConflicts берётся из настроек.
function render(root, cells, state, { selected = null, highlightConflicts = true } = {}) {
    const conflicts = highlightConflicts ? getConflicts(state) : EMPTY_SET;
    const selectedValue = selected === null ? 0 : state.values[selected];

    for (let idx = 0; idx < CELLS; idx++) {
        const { cell, value, notes } = cells[idx];
        const digit = state.values[idx];

        value.textContent = digit ? String(digit) : '';
        cell.classList.toggle('sudoku-given', isGiven(state, idx));
        cell.classList.toggle('sudoku-filled', digit !== 0);
        cell.classList.toggle('sudoku-conflict', conflicts.has(idx));

        // Подсветка: сама клетка, её строка/столбец/бокс и все клетки с той же цифрой.
        cell.classList.toggle('sudoku-selected', idx === selected);
        cell.classList.toggle('sudoku-peer', selected !== null && idx !== selected && isPeer(idx, selected));
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

function isPeer(a, b) {
    return ROW_OF[a] === ROW_OF[b] || COL_OF[a] === COL_OF[b] || BOX_OF[a] === BOX_OF[b];
}

// Подпись для скринридера: «строка 3, столбец 5, подсказка 7» / «пусто».
function describeCell(state, idx) {
    const position = `строка ${ROW_OF[idx] + 1}, столбец ${COL_OF[idx] + 1}`;
    const digit = state.values[idx];
    if (!digit) return `${position}, пусто`;
    return `${position}, ${isGiven(state, idx) ? 'подсказка' : 'цифра'} ${digit}`;
}
