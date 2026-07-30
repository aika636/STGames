// Решатель судоку: backtracking с выбором клетки минимальных кандидатов (MRV).
// Чистый модуль, работает под node без браузера.
//
// Занятые цифры хранятся в трёх наборах 9-битных масок (строки, столбцы, боксы), поэтому
// проверка «можно ли поставить цифру» — это одно ИЛИ и одно И, без обхода 20 соседей.

import {
    ALL_DIGITS_MASK,
    BOX_OF,
    CELLS,
    COL_OF,
    POPCOUNT,
    ROW_OF,
    SIZE,
    bitOf,
    cloneGrid,
} from './grid.js';

// Маски занятых цифр для готовой сетки. null — в исходной сетке уже есть конфликт
// (дубликат в юните), то есть решать нечего.
function buildMasks(grid) {
    const rows = new Int32Array(SIZE);
    const cols = new Int32Array(SIZE);
    const boxes = new Int32Array(SIZE);

    for (let idx = 0; idx < CELLS; idx++) {
        const value = grid[idx];
        if (!value) continue;
        const bit = bitOf(value);
        const r = ROW_OF[idx];
        const c = COL_OF[idx];
        const b = BOX_OF[idx];
        if ((rows[r] & bit) || (cols[c] & bit) || (boxes[b] & bit)) return null;
        rows[r] |= bit;
        cols[c] |= bit;
        boxes[b] |= bit;
    }
    return { rows, cols, boxes };
}

// Порядок перебора цифр внутри клетки. Без rng — по возрастанию (детерминированно);
// с rng — в случайном порядке, что и превращает солвер в генератор полных сеток.
function candidateOrder(mask, rng) {
    const digits = [];
    for (let digit = 1; digit <= SIZE; digit++) {
        if (mask & bitOf(digit)) digits.push(digit);
    }
    if (!rng) return digits;
    for (let i = digits.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = digits[i];
        digits[i] = digits[j];
        digits[j] = tmp;
    }
    return digits;
}

// Рекурсивный поиск. Возвращает число найденных решений (не больше limit); найденные
// решения складываются в out. Сетка grid мутируется, но к выходу восстанавливается.
function search(grid, masks, limit, rng, out) {
    const { rows, cols, boxes } = masks;

    // MRV: ищем пустую клетку с наименьшим числом кандидатов. Клетка без кандидатов —
    // тупик, выходим сразу, не спускаясь глубже.
    let bestIdx = -1;
    let bestMask = 0;
    let bestCount = SIZE + 1;

    for (let idx = 0; idx < CELLS; idx++) {
        if (grid[idx]) continue;
        const used = rows[ROW_OF[idx]] | cols[COL_OF[idx]] | boxes[BOX_OF[idx]];
        const candidates = ALL_DIGITS_MASK & ~used;
        if (candidates === 0) return 0;
        const count = POPCOUNT[candidates];
        if (count < bestCount) {
            bestCount = count;
            bestIdx = idx;
            bestMask = candidates;
            if (count === 1) break; // лучше единственного кандидата уже не будет
        }
    }

    // Пустых клеток не осталось — сетка решена.
    if (bestIdx === -1) {
        out.push(cloneGrid(grid));
        return 1;
    }

    const r = ROW_OF[bestIdx];
    const c = COL_OF[bestIdx];
    const b = BOX_OF[bestIdx];
    let found = 0;

    for (const digit of candidateOrder(bestMask, rng)) {
        const bit = bitOf(digit);
        grid[bestIdx] = digit;
        rows[r] |= bit;
        cols[c] |= bit;
        boxes[b] |= bit;

        found += search(grid, masks, limit - found, rng, out);

        grid[bestIdx] = 0;
        rows[r] &= ~bit;
        cols[c] &= ~bit;
        boxes[b] &= ~bit;

        if (found >= limit) break;
    }

    return found;
}

// Первое найденное решение или null, если решений нет (в том числе когда исходная сетка
// уже противоречива). rng задаёт порядок перебора цифр: с ним решение случайное.
export function solve(grid, { rng = null } = {}) {
    const work = cloneGrid(grid);
    const masks = buildMasks(work);
    if (!masks) return null;

    const out = [];
    search(work, masks, 1, rng, out);
    return out.length ? out[0] : null;
}

// Сколько у сетки решений, но не больше limit. Ключевая функция генератора: выкалывание
// клетки допустимо, только пока countSolutions(..., 2) === 1. Ранний выход на втором
// решении — именно поэтому проверка единственности стоит дёшево.
export function countSolutions(grid, limit = 2) {
    if (limit <= 0) return 0;
    const work = cloneGrid(grid);
    const masks = buildMasks(work);
    if (!masks) return 0;

    const out = [];
    return search(work, masks, limit, null, out);
}

export function hasUniqueSolution(grid) {
    return countSolutions(grid, 2) === 1;
}

// До limit решений сразу — нужно тестам и отладке; в игре не используется.
export function findSolutions(grid, limit = 2) {
    const work = cloneGrid(grid);
    const masks = buildMasks(work);
    if (!masks) return [];

    const out = [];
    search(work, masks, limit, null, out);
    return out;
}
