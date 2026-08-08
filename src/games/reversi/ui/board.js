// Доска реверси 8×8. Модуль знает про DOM, но ничего не знает ни про SillyTavern, ни про
// правила: на вход ему дают состояние из core/engine.js, наружу он отдаёт корневой элемент
// и render().
//
// Сетка строится один раз (64 клетки), render() только переставляет классы и подписи —
// приём из sudoku/ui/board.js. Клетки — div[role=gridcell], а не button: клавиатура висит
// на доске, а 64 кнопки забили бы Tab-порядок попапа и перехватывали бы Enter/Space себе.

import { BLACK, EMPTY, SIZE, WHITE } from '../core/engine.js';

// onPick(idx) зовётся по клику на клетку; решение, легален ли ход, принимает экран.
export function createBoard(onPick) {
    const root = document.createElement('div');
    root.className = 'reversi-board';
    root.setAttribute('role', 'grid');
    root.setAttribute('aria-label', 'Реверси');

    const cells = [];

    for (let idx = 0; idx < SIZE * SIZE; idx++) {
        const cell = document.createElement('div');
        cell.className = 'reversi-cell';
        cell.setAttribute('role', 'gridcell');
        cell.id = `reversi-cell-${idx}`;
        cell.tabIndex = -1;
        cell.dataset.idx = String(idx);

        // Фишка — отдельный элемент внутри клетки: переворот анимируется на ней, а
        // подсветка доступного хода живёт на самой клетке и от анимации не зависит.
        const disc = document.createElement('span');
        disc.className = 'reversi-disc';
        cell.appendChild(disc);

        root.appendChild(cell);
        cells.push({ cell, disc });
    }

    // Один делегированный слушатель на всю доску вместо 64: клетка узнаётся по data-idx.
    if (typeof onPick === 'function') {
        root.addEventListener('click', (event) => {
            const cell = event.target.closest?.('.reversi-cell');
            if (!cell || !root.contains(cell)) return;
            onPick(Number(cell.dataset.idx));
        });
    }

    return {
        root,
        cells,
        render: (state, options) => render(root, cells, state, options),
    };
}

// moves — Map idx → ход из legalMoves() того, чья сейчас очередь; подсвечиваются только
// когда это ход игрока и включена подсказка. lastMove — куда поставлена последняя фишка:
// без неё ход соперника незаметен, доска просто «сама меняется».
function render(
    root,
    cells,
    state,
    { cursor = null, moves = EMPTY_MAP, showHints = true, lastMove = null } = {},
) {
    for (let idx = 0; idx < cells.length; idx++) {
        const { cell } = cells[idx];
        const value = state.board[idx];
        const hint = showHints && moves.has(idx);

        cell.classList.toggle('reversi-black', value === BLACK);
        cell.classList.toggle('reversi-white', value === WHITE);
        cell.classList.toggle('reversi-empty', value === EMPTY);
        cell.classList.toggle('reversi-hint', hint);
        cell.classList.toggle('reversi-last', lastMove === idx);

        const isCursor = idx === cursor;
        cell.classList.toggle('reversi-cursor', isCursor);
        cell.setAttribute('aria-selected', isCursor ? 'true' : 'false');
        // Roving tabindex: фокусируема одна клетка, а не 64 — иначе Tab внутри попапа
        // превращается в 64 нажатия.
        cell.tabIndex = isCursor ? 0 : -1;
        cell.setAttribute('aria-label', describeCell(idx, value, hint));
    }

    if (cursor !== null) {
        root.setAttribute('aria-activedescendant', `reversi-cell-${cursor}`);
    } else {
        root.removeAttribute('aria-activedescendant');
    }
}

const EMPTY_MAP = new Map();

// Подпись для скринридера: «строка 3, столбец 5, чёрные» / «пусто, доступный ход».
function describeCell(idx, value, hint) {
    const position = `строка ${Math.floor(idx / SIZE) + 1}, столбец ${(idx % SIZE) + 1}`;
    const what = value === BLACK ? 'чёрные' : value === WHITE ? 'белые' : 'пусто';
    return hint ? `${position}, ${what}, доступный ход` : `${position}, ${what}`;
}
