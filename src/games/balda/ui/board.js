// Поле балды в DOM. Модуль знает про DOM, но ничего не знает ни про SillyTavern, ни про
// правила: состояние приходит из core/engine.js, наружу отдаются корневой элемент,
// render() и два события указателя.
//
// Про ввод. Ход в балде состоит из двух РАЗНЫХ действий: поставить букву в пустую клетку
// и набрать через неё путь по занятым. Чтобы одно и то же работало и мышью, и пальцем,
// оба действия начинаются одинаково — нажатием на клетку, а разбирается в них экран
// (ui/game.js): на пустой клетке нажатие выбирает место для буквы, на занятой — начинает
// или продолжает путь.
//
// Набор пути — росчерком (образец — нонограмма) и тапами одновременно, и это не две ветки,
// а одна: тап это росчерк длиной в одну клетку. Отсюда три решения:
//   * нажатие на клетку всегда идёт в onTap, а протяжка поверх соседних — в onDrag;
//     последовательность тапов даёт ровно ту же цепочку вызовов, что и росчерк;
//   * клетка под пальцем ищется через elementFromPoint, а не берётся из event.target:
//     тач-браузер захватывает указатель на элемент, где начался жест, и все pointermove
//     приходят с ним, куда бы палец ни уехал;
//   * pointerdown отменяется (preventDefault) — иначе росчерк выделяет текст мышью и
//     прокручивает попап пальцем; за прокрутку отвечает ещё и touch-action: none в CSS.

import { letterAt } from '../core/engine.js';

/**
 * @param {{size: number, onTap: (index: number) => void, onDrag: (index: number) => void}} handlers
 */
export function createBoard({ size, onTap, onDrag }) {
    const root = document.createElement('div');
    root.className = 'balda-board';
    root.setAttribute('role', 'grid');
    root.setAttribute('aria-label', 'Поле балды');
    root.style.setProperty('--balda-cells', String(size));

    const cells = [];
    for (let index = 0; index < size * size; index++) {
        const cell = document.createElement('div');
        cell.className = 'balda-cell';
        cell.setAttribute('role', 'gridcell');
        cell.id = `balda-cell-${index}`;
        cell.tabIndex = -1;
        cell.dataset.idx = String(index);

        // Буква — отдельным элементом: номер шага в пути рисуется в углу клетки и не
        // должен смещать саму букву.
        const glyph = document.createElement('span');
        glyph.className = 'balda-glyph';
        cell.appendChild(glyph);

        root.appendChild(cell);
        cells.push({ cell, glyph });
    }

    // --- Указатель

    // Индекс клетки, на которой указатель был в прошлый раз: без него один pointermove
    // внутри той же клетки слал бы onDrag на каждый пиксель.
    let lastIndex = null;
    let tracking = false;

    function cellIndexAt(x, y) {
        const element = document.elementFromPoint?.(x, y);
        const cell = element?.closest?.('.balda-cell');
        if (!cell || !root.contains(cell)) return null;
        return Number(cell.dataset.idx);
    }

    function onPointerDown(event) {
        const cell = event.target.closest?.('.balda-cell');
        if (!cell || !root.contains(cell)) return;
        // Правая кнопка мыши здесь ничего не делает: второго действия у клетки нет.
        if (event.button > 0) return;

        event.preventDefault();
        tracking = true;
        lastIndex = Number(cell.dataset.idx);
        onTap?.(lastIndex);
    }

    function onPointerMove(event) {
        if (!tracking) return;
        const index = cellIndexAt(event.clientX, event.clientY);
        if (index === null || index === lastIndex) return;
        lastIndex = index;
        onDrag?.(index);
    }

    function endStroke() {
        tracking = false;
        lastIndex = null;
    }

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', endStroke);
    root.addEventListener('pointercancel', endStroke);
    root.addEventListener('pointerleave', endStroke);

    return {
        root,
        cells,
        render: (state, options) => render(cells, state, options),
        destroy() {
            endStroke();
            root.removeEventListener('pointerdown', onPointerDown);
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerup', endStroke);
            root.removeEventListener('pointercancel', endStroke);
            root.removeEventListener('pointerleave', endStroke);
        },
    };
}

/**
 * @param {object} state состояние из core/engine.js
 * @param {{selected: number|null, pendingLetter: string, path: number[]}} options
 *        незавершённый ход игрока: выбранная клетка, поставленная в неё буква и путь.
 */
function render(cells, state, { selected = null, pendingLetter = '', path = EMPTY_PATH } = {}) {
    // Позиция клетки в пути (1, 2, 3…) — показывается номером в углу: без него набранное
    // слово читается только в строке статуса, и промах видно лишь по букве.
    const order = new Map();
    for (let step = 0; step < path.length; step++) order.set(path[step], step + 1);

    for (let index = 0; index < cells.length; index++) {
        const { cell, glyph } = cells[index];
        const isPending = index === selected && pendingLetter !== '';
        const letter = isPending ? pendingLetter : letterAt(state, index);
        const filled = letter !== '';

        glyph.textContent = letter;

        cell.classList.toggle('balda-filled', filled && !isPending);
        cell.classList.toggle('balda-empty', !filled);
        cell.classList.toggle('balda-pending', isPending);
        cell.classList.toggle('balda-selected', index === selected && !isPending);

        const step = order.get(index);
        cell.classList.toggle('balda-path', step !== undefined);
        if (step === undefined) delete cell.dataset.order;
        else cell.dataset.order = String(step);

        cell.setAttribute('aria-label', describeCell(state.size, index, letter, isPending, step));
    }
}

const EMPTY_PATH = [];

function describeCell(size, index, letter, isPending, step) {
    const position = `строка ${Math.floor(index / size) + 1}, столбец ${(index % size) + 1}`;
    const what = letter === '' ? 'пусто' : letter;
    const marks = [];
    if (isPending) marks.push('новая буква');
    if (step !== undefined) marks.push(`шаг ${step}`);
    return marks.length ? `${position}, ${what}, ${marks.join(', ')}` : `${position}, ${what}`;
}
