// Генератор головоломок. Двухшаговая схема, классическая для судоку:
//
//   1. Полное решение — тот же backtracking-солвер, но со случайным порядком перебора
//      цифр: пустая сетка «решается» в случайную валидную сетку 9×9.
//   2. Выкалывание — клетки убираются в случайном порядке, и каждое удаление
//      откатывается, если решение перестало быть единственным.
//
// Единственность проверяется через countSolutions(..., 2) с ранним выходом на втором
// решении, поэтому проверка стоит доли миллисекунды.
//
// Полученная головоломка прогоняется через rate(): если уровень не совпал с заказанным,
// попытка повторяется с новым решением. После исчерпания бюджета попыток возвращается
// лучшее, что получилось (с exact: false) — генератор никогда не зависает и никогда не
// возвращает null.

import { CELLS, cloneGrid, countGivens, emptyGrid, isSolved } from './grid.js';
import { LEVELS, rate } from './rate.js';
import { shuffle } from './rng.js';
import { hasUniqueSolution, solve } from './solver.js';

// targetGivens — сколько подсказок оставить. Значения подобраны под пороги rate.js
// (easy ≥38 подсказок, medium ≥32, ниже — hard):
//   easy/medium/hard попадают в свой уровень числом подсказок и сходятся с первой
//   попытки, если только головоломка не окажется логически сложнее ожидаемого;
//   expert уровнем подсказок не берётся принципиально — его выдают только за то, что
//   головоломку не решают одиночки, locked candidates и пары, поэтому при 25 подсказках
//   в среднем срабатывает вторая-третья попытка. Симметрия для expert выключена: без неё
//   выкалывание опускается до меньшего числа подсказок, а значит чаще получается сетка,
//   которую логика не берёт.
export const DIFFICULTY_TARGETS = Object.freeze({
    easy: { targetGivens: 42, symmetric: true },
    medium: { targetGivens: 34, symmetric: true },
    hard: { targetGivens: 29, symmetric: true },
    expert: { targetGivens: 25, symmetric: false },
});

export const DEFAULT_ATTEMPTS = 30;

// Случайная полностью заполненная валидная сетка.
export function generateSolution(rng = Math.random) {
    const solution = solve(emptyGrid(), { rng });
    if (!solution) {
        // Недостижимо: у пустой сетки решения есть всегда. Но лучше явная ошибка, чем
        // молчаливый null, уехавший в UI.
        throw new Error('generateSolution: солвер не смог заполнить пустую сетку');
    }
    return solution;
}

// Выкалывает клетки из готового решения, сохраняя единственность решения.
// symmetric — убирать клетки парами, симметричными относительно центра: так головоломка
// выглядит аккуратнее, но опускается до меньшего числа подсказок хуже, поэтому для
// expert симметрия выключена.
export function digHoles(solution, { targetGivens, symmetric = true, rng = Math.random } = {}) {
    const puzzle = cloneGrid(solution);
    let givens = CELLS;

    const order = shuffle(Array.from({ length: CELLS }, (_, i) => i), rng);

    for (const idx of order) {
        if (givens <= targetGivens) break;

        const mirror = CELLS - 1 - idx;
        const group = symmetric && mirror !== idx ? [idx, mirror] : [idx];
        const backup = group.map((i) => puzzle[i]);
        if (backup.every((value) => value === 0)) continue;

        for (const i of group) puzzle[i] = 0;
        const removed = backup.filter((value) => value !== 0).length;

        if (hasUniqueSolution(puzzle)) {
            givens -= removed;
        } else {
            group.forEach((i, k) => { puzzle[i] = backup[k]; });
        }
    }

    return puzzle;
}

// Основная точка входа: головоломка заданного уровня.
// Возвращает { puzzle, solution, difficulty, level, givens, techniques, exact, attempts }.
//   difficulty — что заказывали, level — что реально получилось (совпадают, если exact).
export function generatePuzzle({
    difficulty = 'medium',
    rng = Math.random,
    attempts = DEFAULT_ATTEMPTS,
    symmetric = null,
} = {}) {
    const requested = LEVELS.includes(difficulty) ? difficulty : 'medium';
    const target = DIFFICULTY_TARGETS[requested];

    let best = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const solution = generateSolution(rng);
        const puzzle = digHoles(solution, {
            targetGivens: target.targetGivens,
            symmetric: symmetric === null ? target.symmetric : symmetric,
            rng,
        });

        const rating = rate(puzzle);
        const candidate = {
            puzzle,
            solution,
            difficulty: requested,
            level: rating.level,
            givens: countGivens(puzzle),
            techniques: rating.techniques,
            exact: rating.level === requested,
            attempts: attempt,
        };

        if (candidate.exact) return candidate;

        // Фолбэк — головоломка, чей уровень ближе всего к заказанному по шкале LEVELS.
        if (!best || levelDistance(candidate.level, requested) < levelDistance(best.level, requested)) {
            best = candidate;
        }
    }

    return { ...best, attempts };
}

function levelDistance(a, b) {
    return Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(b));
}

// Проверка, что сгенерированная пара «головоломка + решение» согласована. Используется
// тестами; в игре — дешёвая страховка перед показом доски.
export function isConsistent({ puzzle, solution }) {
    if (!isSolved(solution)) return false;
    for (let idx = 0; idx < CELLS; idx++) {
        if (puzzle[idx] && puzzle[idx] !== solution[idx]) return false;
    }
    return hasUniqueSolution(puzzle);
}
