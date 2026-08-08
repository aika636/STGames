// Поле «Слов»: 6 строк по 5 плиток. Модуль знает про DOM, но ничего не знает ни о
// правилах, ни о SillyTavern — на вход ему дают догадки с разметкой, наружу он отдаёт
// корень и render().
//
// Сетка строится один раз, render() только переставляет классы и подписи — приём из
// sudoku/ui/board.js. Плитки — неинтерактивные div'ы: 30 кнопок забили бы Tab-порядок
// попапа, а нажимать на них нечего.
//
// Раскраска в состоянии НЕ хранится (см. core/mark.js): render() каждый раз получает
// готовую разметку, посчитанную от секрета и догадок.

import { ABSENT, CORRECT, PRESENT } from '../core/mark.js';

const STATE_CLASS = Object.freeze({
    [CORRECT]: 'words-tile-correct',
    [PRESENT]: 'words-tile-present',
    [ABSENT]: 'words-tile-absent',
});

const STATE_LABEL = Object.freeze({
    [CORRECT]: 'на месте',
    [PRESENT]: 'есть в слове',
    [ABSENT]: 'нет в слове',
});

// Пауза между переворотами соседних плиток. Должна совпадать с --words-reveal-step
// в style.css: JS расставляет задержки, CSS их проигрывает.
const REVEAL_STEP_MS = 150;
const FLIP_MS = 300;

/** Сколько миллисекунд идёт раскрытие всей строки. */
export function revealDuration(length) {
    return (length - 1) * REVEAL_STEP_MS + FLIP_MS;
}

export function createGrid({ length, maxAttempts }) {
    const root = document.createElement('div');
    root.className = 'words-grid';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Поле игры');
    root.style.setProperty('--words-cols', String(length));

    const rows = [];

    for (let r = 0; r < maxAttempts; r++) {
        const row = document.createElement('div');
        row.className = 'words-row';
        const tiles = [];

        for (let c = 0; c < length; c++) {
            const tile = document.createElement('div');
            tile.className = 'words-tile';
            // Задержка переворота — от позиции буквы: строка раскрывается слева направо.
            tile.style.setProperty('--words-reveal-delay', `${c * REVEAL_STEP_MS}ms`);
            row.appendChild(tile);
            tiles.push(tile);
        }

        root.appendChild(row);
        rows.push({ row, tiles });
    }

    return {
        root,
        rows,
        /** Элемент строки, которую сейчас набирают, — по нему трясёт feedback.js. */
        rowAt: (index) => rows[index]?.row ?? null,
        render: (view) => render(rows, view),
    };
}

/**
 * @param {Array} rows
 * @param {{ guesses: string[], marks: string[][], current: string, revealRow: number|null }} view
 */
function render(rows, { guesses = [], marks = [], current = '', revealRow = null } = {}) {
    for (let r = 0; r < rows.length; r++) {
        const { row, tiles } = rows[r];
        const guess = guesses[r];
        const rowMarks = marks[r];
        const typing = !guess && r === guesses.length;

        row.classList.toggle('words-row-current', typing);
        row.classList.toggle('words-row-reveal', r === revealRow);

        for (let c = 0; c < tiles.length; c++) {
            const tile = tiles[c];
            const letter = guess ? guess[c] : (typing ? (current[c] ?? '') : '');
            const state = guess && rowMarks ? rowMarks[c] : null;

            tile.textContent = letter;
            tile.classList.toggle('words-tile-filled', Boolean(letter));
            for (const [key, className] of Object.entries(STATE_CLASS)) {
                tile.classList.toggle(className, state === key);
            }
            tile.dataset.state = state ?? (letter ? 'typed' : 'empty');

            // Подпись несёт состояние ВСЕГДА, независимо от режима дальтоника: цвет не
            // должен быть единственным носителем информации. Пустая плитка скрыта от
            // скринридера — тридцать «пусто» подряд читать незачем.
            if (state) {
                tile.setAttribute('aria-label', `${letter}, ${STATE_LABEL[state]}`);
                tile.removeAttribute('aria-hidden');
            } else if (letter) {
                tile.setAttribute('aria-label', letter);
                tile.removeAttribute('aria-hidden');
            } else {
                tile.removeAttribute('aria-label');
                tile.setAttribute('aria-hidden', 'true');
            }
        }
    }
}

/** Расшифровка подтверждённой строки для живого региона. */
export function describeRow(guess, rowMarks) {
    return [...guess]
        .map((letter, i) => `${letter} — ${STATE_LABEL[rowMarks[i]] ?? 'неизвестно'}`)
        .join(', ');
}
