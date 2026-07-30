// Оценка сложности головоломки. Идея: решать её так, как решает человек — только
// логическими техниками, без перебора, — и смотреть, до какой техники пришлось дойти.
//
// Уровни техник (tier):
//   1 — одиночки: naked single (в клетке один кандидат), hidden single (в юните цифра
//       помещается в одну клетку);
//   2 — locked candidates: pointing (в боксе цифра только в одной строке/столбце) и
//       claiming (в строке/столбце цифра только внутри одного бокса);
//   3 — пары: naked pair и hidden pair.
// Если после всего этого сетка не решена, значит нужен перебор или продвинутые техники —
// это expert.
//
// Итоговый уровень — максимум из «уровня по технике» и «уровня по числу подсказок»:
// головоломка на 28 подсказок объективно сложнее, чем на 42, даже если формально обе
// разбираются одними одиночками (меньше подсказок = дольше сканировать глазами).
//
// Важное ограничение шкалы по подсказкам: сама по себе она поднимает уровень максимум до
// hard. Expert выдаётся только за технику — точнее, за её нехватку: головоломка, которую
// не берут одиночки, locked candidates и пары. Иначе «экспертом» становилась бы любая
// разреженная сетка, решаемая одними одиночками, — а таких при 25 подсказках примерно
// каждая четвёртая.

import {
    ALL_DIGITS_MASK,
    BOX_OF,
    BOX_UNITS,
    CELLS,
    COL_OF,
    COL_UNITS,
    PEERS,
    POPCOUNT,
    ROW_OF,
    ROW_UNITS,
    SIZE,
    UNITS,
    bitOf,
    countGivens,
} from './grid.js';

export const LEVELS = Object.freeze(['easy', 'medium', 'hard', 'expert']);

// Границы по числу подсказок: сколько минимум их должно быть, чтобы уровень считался
// не сложнее указанного. Ниже 32 подсказок шкала упирается в hard — expert по этой
// шкале не выдаётся принципиально (см. комментарий в шапке модуля).
const GIVENS_THRESHOLDS = Object.freeze([
    { level: 'easy', minGivens: 38 },
    { level: 'medium', minGivens: 32 },
]);

const TIER_LEVELS = Object.freeze(['easy', 'medium', 'hard']);

function levelIndex(level) {
    return LEVELS.indexOf(level);
}

function maxLevel(a, b) {
    return levelIndex(a) >= levelIndex(b) ? a : b;
}

function levelFromGivens(givens) {
    for (const { level, minGivens } of GIVENS_THRESHOLDS) {
        if (givens >= minGivens) return level;
    }
    return 'hard';
}

// Маски кандидатов для каждой клетки: 0 у заполненных, иначе биты допустимых цифр.
function computeCandidates(grid) {
    const candidates = new Int16Array(CELLS);
    for (let idx = 0; idx < CELLS; idx++) {
        if (grid[idx]) continue;
        let used = 0;
        for (const peer of PEERS[idx]) {
            if (grid[peer]) used |= bitOf(grid[peer]);
        }
        candidates[idx] = ALL_DIGITS_MASK & ~used;
    }
    return candidates;
}

function place(grid, candidates, idx, digit) {
    grid[idx] = digit;
    candidates[idx] = 0;
    const bit = bitOf(digit);
    for (const peer of PEERS[idx]) candidates[peer] &= ~bit;
}

function digitOfSingleBit(mask) {
    return POPCOUNT[mask] === 1 ? 32 - Math.clz32(mask) : 0;
}

// --- Tier 1

function applyNakedSingles(grid, candidates) {
    let changed = false;
    for (let idx = 0; idx < CELLS; idx++) {
        if (grid[idx]) continue;
        const mask = candidates[idx];
        if (mask === 0) return 'contradiction';
        if (POPCOUNT[mask] === 1) {
            place(grid, candidates, idx, digitOfSingleBit(mask));
            changed = true;
        }
    }
    return changed;
}

function applyHiddenSingles(grid, candidates) {
    let changed = false;
    for (const unit of UNITS) {
        for (let digit = 1; digit <= SIZE; digit++) {
            const bit = bitOf(digit);
            let spot = -1;
            let count = 0;
            for (const idx of unit) {
                if (grid[idx] === digit) { count = -1; break; } // цифра уже стоит в юните
                if (candidates[idx] & bit) {
                    count++;
                    spot = idx;
                    if (count > 1) break;
                }
            }
            if (count === 1) {
                place(grid, candidates, spot, digit);
                changed = true;
            }
        }
    }
    return changed;
}

// --- Tier 2: locked candidates

function eliminate(candidates, cells, bit, exclude) {
    let changed = false;
    for (const idx of cells) {
        if (exclude.has(idx)) continue;
        if (candidates[idx] & bit) {
            candidates[idx] &= ~bit;
            changed = true;
        }
    }
    return changed;
}

// Pointing: если в боксе все места для цифры лежат в одной строке (столбце), то в
// остальной части этой строки (столбца) цифры быть не может.
function applyPointing(grid, candidates) {
    let changed = false;
    for (const box of BOX_UNITS) {
        for (let digit = 1; digit <= SIZE; digit++) {
            const bit = bitOf(digit);
            const spots = box.filter((idx) => candidates[idx] & bit);
            if (spots.length < 2) continue;

            const rows = new Set(spots.map((idx) => ROW_OF[idx]));
            const cols = new Set(spots.map((idx) => COL_OF[idx]));
            const exclude = new Set(box);

            if (rows.size === 1) {
                changed = eliminate(candidates, ROW_UNITS[ROW_OF[spots[0]]], bit, exclude) || changed;
            }
            if (cols.size === 1) {
                changed = eliminate(candidates, COL_UNITS[COL_OF[spots[0]]], bit, exclude) || changed;
            }
        }
    }
    return changed;
}

// Claiming: если в строке (столбце) все места для цифры лежат в одном боксе, то в
// остальной части бокса цифры быть не может.
function applyClaiming(grid, candidates) {
    let changed = false;
    for (const unit of [...ROW_UNITS, ...COL_UNITS]) {
        for (let digit = 1; digit <= SIZE; digit++) {
            const bit = bitOf(digit);
            const spots = unit.filter((idx) => candidates[idx] & bit);
            if (spots.length < 2) continue;

            const boxes = new Set(spots.map((idx) => BOX_OF[idx]));
            if (boxes.size !== 1) continue;

            changed = eliminate(candidates, BOX_UNITS[BOX_OF[spots[0]]], bit, new Set(unit)) || changed;
        }
    }
    return changed;
}

// --- Tier 3: пары

// Naked pair: две клетки юнита с одинаковой парой кандидатов забирают эти две цифры себе.
function applyNakedPairs(grid, candidates) {
    let changed = false;
    for (const unit of UNITS) {
        const pairs = unit.filter((idx) => !grid[idx] && POPCOUNT[candidates[idx]] === 2);
        for (let i = 0; i < pairs.length; i++) {
            for (let j = i + 1; j < pairs.length; j++) {
                const mask = candidates[pairs[i]];
                if (candidates[pairs[j]] !== mask) continue;
                const exclude = new Set([pairs[i], pairs[j]]);
                for (let digit = 1; digit <= SIZE; digit++) {
                    const bit = bitOf(digit);
                    if (mask & bit) {
                        changed = eliminate(candidates, unit, bit, exclude) || changed;
                    }
                }
            }
        }
    }
    return changed;
}

// Hidden pair: две цифры юнита помещаются ровно в одни и те же две клетки — значит, в
// этих клетках ничего другого стоять не может.
function applyHiddenPairs(grid, candidates) {
    let changed = false;
    for (const unit of UNITS) {
        // Для каждой цифры — где в юните она может стоять.
        const spots = new Map();
        for (let digit = 1; digit <= SIZE; digit++) {
            const bit = bitOf(digit);
            const cells = unit.filter((idx) => candidates[idx] & bit);
            if (cells.length === 2) spots.set(digit, cells);
        }

        const digits = Array.from(spots.keys());
        for (let i = 0; i < digits.length; i++) {
            for (let j = i + 1; j < digits.length; j++) {
                const a = spots.get(digits[i]);
                const b = spots.get(digits[j]);
                if (a[0] !== b[0] || a[1] !== b[1]) continue;

                const pairMask = bitOf(digits[i]) | bitOf(digits[j]);
                for (const idx of a) {
                    if (candidates[idx] !== pairMask) {
                        candidates[idx] &= pairMask;
                        changed = true;
                    }
                }
            }
        }
    }
    return changed;
}

const TIERS = [
    { tier: 1, techniques: [['nakedSingle', applyNakedSingles], ['hiddenSingle', applyHiddenSingles]] },
    { tier: 2, techniques: [['pointing', applyPointing], ['claiming', applyClaiming]] },
    { tier: 3, techniques: [['nakedPair', applyNakedPairs], ['hiddenPair', applyHiddenPairs]] },
];

// Пробует решить головоломку логикой. Возвращает:
//   { solved, level, maxTier, techniques, grid }
// techniques — какие техники реально пригодились (для отладки и подсказок в будущем).
export function rate(puzzle) {
    const grid = puzzle.slice();
    const candidates = computeCandidates(grid);
    const techniques = new Set();

    let maxTier = 1;
    let contradiction = false;

    outer: for (;;) {
        // Всегда начинаем с самой дешёвой техники: как только она снова даёт результат,
        // возвращаемся к ней, а не продолжаем крутить дорогие.
        for (const { tier, techniques: list } of TIERS) {
            for (const [name, apply] of list) {
                const result = apply(grid, candidates);
                if (result === 'contradiction') {
                    contradiction = true;
                    break outer;
                }
                if (result) {
                    techniques.add(name);
                    if (tier > maxTier) maxTier = tier;
                    continue outer;
                }
            }
        }
        break;
    }

    const solved = !contradiction && grid.every((value) => value !== 0);
    const givens = countGivens(puzzle);
    const level = solved
        ? maxLevel(TIER_LEVELS[maxTier - 1], levelFromGivens(givens))
        : 'expert';

    return {
        solved,
        contradiction,
        level,
        maxTier: solved ? maxTier : 4,
        givens,
        techniques: Array.from(techniques),
        grid,
    };
}

// Уровень сложности головоломки одной строкой.
export function rateLevel(puzzle) {
    return rate(puzzle).level;
}
