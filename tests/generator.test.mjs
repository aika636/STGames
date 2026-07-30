// Тесты генератора и оценки сложности.
// Запуск: node tests/generator.test.mjs [числоГоловоломокНаУровень]
//
// Главный тест — прогон PUZZLES_PER_LEVEL генераций на каждом уровне с проверкой, что
// каждая головоломка валидна, имеет ровно одно решение, попадает в заказанный уровень и
// укладывается в бюджет времени.

import { CELLS, countGivens, formatGrid, isSolved, parseGrid } from '../src/core/grid.js';
import { hasUniqueSolution, solve } from '../src/core/solver.js';
import { LEVELS, rate } from '../src/core/rate.js';
import {
    DIFFICULTY_TARGETS,
    digHoles,
    generatePuzzle,
    generateSolution,
    isConsistent,
} from '../src/core/generator.js';
import { mulberry32 } from '../src/core/rng.js';
import { assert, assertEqual, report, test } from './_harness.mjs';

const PUZZLES_PER_LEVEL = Number(process.argv[2]) || 100;
const TIME_BUDGET_MS = 100; // на одну головоломку, см. docs/roadmap.md, Фаза 1

console.log('generator + rate');

test('generateSolution даёт валидную полную сетку', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 20; i++) {
        const solution = generateSolution(rng);
        assertEqual(solution.length, CELLS, 'длина сетки');
        assert(isSolved(solution), `сетка ${i} полна и без конфликтов`);
    }
});

test('generateSolution с разными сидами даёт разные сетки', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 20; seed++) {
        seen.add(formatGrid(generateSolution(mulberry32(seed))));
    }
    assertEqual(seen.size, 20, 'уникальных сеток');
});

test('digHoles сохраняет единственность решения', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10; i++) {
        const solution = generateSolution(rng);
        const puzzle = digHoles(solution, { targetGivens: 30, symmetric: true, rng });
        assert(hasUniqueSolution(puzzle), `головоломка ${i} имеет единственное решение`);
        assertEqual(formatGrid(solve(puzzle)), formatGrid(solution), 'решение совпадает с исходным');
    }
});

test('digHoles с symmetric сохраняет центральную симметрию', () => {
    const rng = mulberry32(11);
    const solution = generateSolution(rng);
    const puzzle = digHoles(solution, { targetGivens: 30, symmetric: true, rng });
    for (let idx = 0; idx < CELLS; idx++) {
        const mirror = CELLS - 1 - idx;
        assertEqual(
            puzzle[idx] === 0,
            puzzle[mirror] === 0,
            `клетки ${idx} и ${mirror} пусты или заполнены вместе`,
        );
    }
});

test('rate: головоломка на одних одиночках — easy', () => {
    // 45 подсказок, решается naked/hidden singles.
    const easy = parseGrid(
        '534678912' +
        '672195348' +
        '198342567' +
        '859761423' +
        '426853791' +
        '713924856' +
        '961537284' +
        '287419635' +
        '345286179',
    );
    // Снимаем 20 клеток — остаётся 61 подсказка, тривиальный уровень.
    for (const idx of [0, 5, 12, 19, 24, 30, 36, 41, 48, 55, 60, 66, 70, 74, 78, 3, 17, 29, 44, 53]) {
        easy[idx] = 0;
    }
    const rating = rate(easy);
    assert(rating.solved, 'решается логикой');
    assertEqual(rating.level, 'easy', 'уровень');
});

test('rate: нерешаемая логикой головоломка — expert', () => {
    // «Platinum Blonde» — известная головоломка, требующая продвинутых техник.
    const hardest = parseGrid(
        '000000012' +
        '000000003' +
        '002300400' +
        '001800005' +
        '040000800' +
        '000060090' +
        '000000700' +
        '050000600' +
        '004000000',
    );
    const rating = rate(hardest);
    assert(!rating.solved, 'одиночками/парами не решается');
    assertEqual(rating.level, 'expert', 'уровень');
});

test('rate не мутирует исходную головоломку', () => {
    const puzzle = generatePuzzle({ difficulty: 'medium', rng: mulberry32(3) }).puzzle;
    const before = formatGrid(puzzle);
    rate(puzzle);
    assertEqual(formatGrid(puzzle), before, 'головоломка после rate');
});

test('generatePuzzle отвергает неизвестный уровень и падает на medium', () => {
    const result = generatePuzzle({ difficulty: 'нечто', rng: mulberry32(5) });
    assertEqual(result.difficulty, 'medium', 'уровень по умолчанию');
});

// --- Основной прогон

for (const level of LEVELS) {
    test(`${level}: ${PUZZLES_PER_LEVEL} генераций — валидность, единственность, уровень, время`, () => {
        const rng = mulberry32(0x5eed + LEVELS.indexOf(level));
        const times = [];
        let inexact = 0;
        let totalAttempts = 0;
        const givens = [];

        for (let i = 0; i < PUZZLES_PER_LEVEL; i++) {
            const started = performance.now();
            const result = generatePuzzle({ difficulty: level, rng });
            times.push(performance.now() - started);

            assert(isConsistent(result), `#${i}: головоломка согласована с решением и уникальна`);
            assertEqual(result.givens, countGivens(result.puzzle), `#${i}: givens посчитан верно`);
            assertEqual(
                formatGrid(solve(result.puzzle)),
                formatGrid(result.solution),
                `#${i}: решение головоломки совпадает с заявленным`,
            );

            givens.push(result.givens);
            totalAttempts += result.attempts;
            if (!result.exact) inexact++;
        }

        const total = times.reduce((a, b) => a + b, 0);
        const avg = total / times.length;
        const max = Math.max(...times);
        const target = DIFFICULTY_TARGETS[level].targetGivens;

        console.log(
            `      ${level}: ср. ${avg.toFixed(1)} мс, макс ${max.toFixed(1)} мс, ` +
            `подсказок ${Math.min(...givens)}–${Math.max(...givens)} (цель ${target}), ` +
            `попыток в среднем ${(totalAttempts / PUZZLES_PER_LEVEL).toFixed(2)}, ` +
            `не в уровень: ${inexact}`,
        );

        assertEqual(inexact, 0, `${level}: головоломок мимо заказанного уровня`);
        assert(max < TIME_BUDGET_MS, `${level}: макс. время ${max.toFixed(1)} мс не превышает ${TIME_BUDGET_MS} мс`);
    });
}

report('generator');
