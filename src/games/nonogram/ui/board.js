// Поле нонограммы в DOM: подсказки сверху и слева, сетка клеток и — главное — рисование
// протяжкой. Модуль знает про DOM, но ничего не знает ни про SillyTavern, ни про правила:
// состояние приходит из core/game.js, наружу отдаются корневой элемент и render().
//
// Про ввод. Нонограмма — единственная игра каталога, где ход делается не по клетке, а по
// росчерку: закрасить десять клеток подряд десятью отдельными тапами невозможно долго.
// Отсюда три решения:
//   * режим росчерка определяется первой клеткой. Начали с пустой — красим, начали с
//     закрашенной — стираем. Иначе рука, ведя по ряду, попеременно красит и стирает;
//   * росчерк держится оси. Как только палец ушёл на соседнюю клетку, направление
//     фиксируется, и в другую сторону росчерк уже не сворачивает: в нонограмме рисуют
//     линиями, а дрожь пальца иначе красит соседний ряд;
//   * клетка под пальцем ищется через elementFromPoint, а не берётся из event.target:
//     тач-браузер захватывает указатель на элемент, где начался жест, и все pointermove
//     приходят с ним, каким бы далеко палец ни уехал.

import { CROSS, EMPTY, FILLED } from '../core/game.js';

// Толстая линия каждые пять клеток — стандарт бумажных нонограмм: без неё на поле 15×15
// невозможно отсчитать «седьмая сверху».
const BLOCK = 5;

// crossMode() — переключатель «тап ставит крестик» из шапки экрана: на тач-экране
// правой кнопки нет, и без него крестики оставались бы привилегией мыши.
export function createBoard({ cols, rows, rowClues, colClues, onPaint, crossMode = () => false }) {
    const root = document.createElement('div');
    root.className = 'nonogram-layout';
    root.style.setProperty('--nonogram-cols', String(cols));
    root.style.setProperty('--nonogram-rows', String(rows));

    const corner = document.createElement('div');
    corner.className = 'nonogram-corner';

    const colsBox = document.createElement('div');
    colsBox.className = 'nonogram-clues nonogram-clues-cols';
    const colClueEls = [];
    for (let x = 0; x < cols; x++) {
        const box = document.createElement('div');
        box.className = 'nonogram-clue nonogram-clue-col';
        if (x > 0 && x % BLOCK === 0) box.classList.add('nonogram-block');
        for (const value of colClues[x]) {
            const span = document.createElement('span');
            span.textContent = String(value);
            box.appendChild(span);
        }
        colsBox.appendChild(box);
        colClueEls.push(box);
    }

    const rowsBox = document.createElement('div');
    rowsBox.className = 'nonogram-clues nonogram-clues-rows';
    const rowClueEls = [];
    for (let y = 0; y < rows; y++) {
        const box = document.createElement('div');
        box.className = 'nonogram-clue nonogram-clue-row';
        if (y > 0 && y % BLOCK === 0) box.classList.add('nonogram-block');
        for (const value of rowClues[y]) {
            const span = document.createElement('span');
            span.textContent = String(value);
            box.appendChild(span);
        }
        rowsBox.appendChild(box);
        rowClueEls.push(box);
    }

    const board = document.createElement('div');
    board.className = 'nonogram-board';
    board.setAttribute('role', 'grid');
    board.setAttribute('aria-label', 'Поле нонограммы');

    const cells = [];
    for (let index = 0; index < cols * rows; index++) {
        const cell = document.createElement('div');
        cell.className = 'nonogram-cell';
        cell.setAttribute('role', 'gridcell');
        cell.id = `nonogram-cell-${index}`;
        cell.tabIndex = -1;
        cell.dataset.idx = String(index);
        const x = index % cols;
        const y = Math.floor(index / cols);
        if (x > 0 && x % BLOCK === 0) cell.classList.add('nonogram-block-left');
        if (y > 0 && y % BLOCK === 0) cell.classList.add('nonogram-block-top');
        board.appendChild(cell);
        cells.push(cell);
    }

    root.append(corner, colsBox, rowsBox, board);

    // --- Росчерк

    // Что именно ставит текущий росчерк: FILLED, CROSS или EMPTY (стирание).
    let paintMark = null;
    let startIndex = null;
    // 'x' — росчерк идёт по строке, 'y' — по столбцу, null — ось ещё не выбрана.
    let axis = null;
    let painted = null;

    function cellIndexAt(x, y) {
        const element = document.elementFromPoint?.(x, y);
        const cell = element?.closest?.('.nonogram-cell');
        if (!cell || !board.contains(cell)) return null;
        return Number(cell.dataset.idx);
    }

    function onPointerDown(event) {
        const cell = event.target.closest?.('.nonogram-cell');
        if (!cell || !board.contains(cell)) return;
        // Правая кнопка мыши — крестики, всё остальное (левая, палец, перо) — закраска.
        // Дальше решает сама клетка: по закрашенной росчерк стирает, по пустой — красит.
        const cross = event.button === 2 || crossMode();
        const index = Number(cell.dataset.idx);
        event.preventDefault();

        startIndex = index;
        axis = null;
        painted = new Set();
        paintMark = markFor(cross, index);
        apply(index);
    }

    function onPointerMove(event) {
        if (paintMark === null || startIndex === null) return;
        const index = cellIndexAt(event.clientX, event.clientY);
        if (index === null || index === startIndex) return;

        const sx = startIndex % cols;
        const sy = Math.floor(startIndex / cols);
        const x = index % cols;
        const y = Math.floor(index / cols);

        if (axis === null) {
            // Ось выбирается по первой же клетке, на которую съехал росчерк. Диагональ
            // тоже считается: берём то направление, где сдвиг больше.
            axis = Math.abs(x - sx) >= Math.abs(y - sy) ? 'x' : 'y';
        }
        // Держим ось: клетки вне выбранной строки/столбца росчерк не задевает.
        const target = axis === 'x' ? sy * cols + x : y * cols + sx;
        apply(target);
    }

    function endPaint() {
        paintMark = null;
        startIndex = null;
        axis = null;
        painted = null;
    }

    // Какую метку ставит росчерк, начавшийся на клетке index: по занятой — стирает,
    // по свободной — ставит свою.
    let markProvider = () => EMPTY;
    function markFor(cross, index) {
        const current = markProvider(index);
        const wanted = cross ? CROSS : FILLED;
        return current === wanted ? EMPTY : wanted;
    }

    function apply(index) {
        if (painted?.has(index)) return;
        painted?.add(index);
        onPaint?.(index, paintMark);
    }

    // Правая кнопка на поле не должна открывать меню браузера: она рисует крестики.
    function onContextMenu(event) {
        event.preventDefault();
    }

    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    board.addEventListener('pointerup', endPaint);
    board.addEventListener('pointercancel', endPaint);
    board.addEventListener('pointerleave', endPaint);
    board.addEventListener('contextmenu', onContextMenu);

    return {
        root,
        board,
        cells,
        // Экран отдаёт доске способ узнать текущую метку клетки: доска не хранит партию,
        // но без этого не смогла бы решить, красит росчерк или стирает.
        setMarkProvider(provider) {
            markProvider = provider;
        },
        render: (state, options) => render({ cells, board, rowClueEls, colClueEls }, state, options),
        destroy() {
            endPaint();
            board.removeEventListener('pointerdown', onPointerDown);
            board.removeEventListener('pointermove', onPointerMove);
            board.removeEventListener('pointerup', endPaint);
            board.removeEventListener('pointercancel', endPaint);
            board.removeEventListener('pointerleave', endPaint);
            board.removeEventListener('contextmenu', onContextMenu);
        },
    };
}

function render(
    { cells, board, rowClueEls, colClueEls },
    state,
    { cursor = null, wrong = EMPTY_SET, rowDone = () => false, colDone = () => false } = {},
) {
    for (let index = 0; index < cells.length; index++) {
        const cell = cells[index];
        const mark = state.marks[index];

        cell.classList.toggle('nonogram-fill', mark === FILLED);
        cell.classList.toggle('nonogram-cross', mark === CROSS);
        cell.classList.toggle('nonogram-wrong', wrong.has(index));

        const isCursor = index === cursor;
        cell.classList.toggle('nonogram-cursor', isCursor);
        cell.setAttribute('aria-selected', isCursor ? 'true' : 'false');
        // Roving tabindex: фокусируема одна клетка, а не все двести двадцать пять.
        cell.tabIndex = isCursor ? 0 : -1;
        cell.setAttribute('aria-label', describeCell(state.cols, index, mark));
    }

    // Выполненные подсказки гаснут: без этого взгляд каждый раз перечитывает всю
    // колонку чисел заново.
    for (let y = 0; y < rowClueEls.length; y++) {
        rowClueEls[y].classList.toggle('nonogram-done', rowDone(y));
    }
    for (let x = 0; x < colClueEls.length; x++) {
        colClueEls[x].classList.toggle('nonogram-done', colDone(x));
    }

    if (cursor !== null) {
        board.setAttribute('aria-activedescendant', `nonogram-cell-${cursor}`);
    } else {
        board.removeAttribute('aria-activedescendant');
    }
}

const EMPTY_SET = new Set();

function describeCell(cols, index, mark) {
    const position = `строка ${Math.floor(index / cols) + 1}, столбец ${(index % cols) + 1}`;
    if (mark === FILLED) return `${position}, закрашено`;
    if (mark === CROSS) return `${position}, крестик`;
    return `${position}, пусто`;
}
