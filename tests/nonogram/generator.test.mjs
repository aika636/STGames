// Тесты генератора нонограммы (Фаза 11.2): картинка решается однозначно линейными
// выводами, подсказки совпадают с ней, генерация воспроизводима по семени. В конце —
// замер времени, как в Фазе 1 для судоку.
//
// Запуск: node tests/nonogram/generator.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import { BOARDS, boardFor, generatePuzzle, mulberry32 } from '../../src/games/nonogram/core/generator.js';
import { FILLED, cluesFromGrid, solveGrid } from '../../src/games/nonogram/core/solver.js';

test('boardFor знает уровни и не падает на чужом значении', () => {
    assertEqual(boardFor('hard').cols, 15, 'сложный');
    assertEqual(boardFor('чего?').cols, boardFor('easy').cols, 'фолбэк на лёгкий');
});

test('подсказки считаются по самой картинке', () => {
    const rng = mulberry32(11);
    const board = BOARDS.medium;
    const puzzle = generatePuzzle({ ...board, rng });
    const clues = cluesFromGrid(puzzle.grid, board.cols, board.rows);
    assertEqual(
        clues.rowClues.map((c) => c.join(',')).join('|'),
        puzzle.rowClues.map((c) => c.join(',')).join('|'),
        'строки',
    );
    assertEqual(
        clues.colClues.map((c) => c.join(',')).join('|'),
        puzzle.colClues.map((c) => c.join(',')).join('|'),
        'столбцы',
    );
});

test('картинка каждого уровня решается однозначно и без перебора', () => {
    for (const [level, board] of Object.entries(BOARDS)) {
        const rng = mulberry32(2025);
        for (let i = 0; i < 25; i++) {
            const puzzle = generatePuzzle({ ...board, rng });
            assert(puzzle.unique, `${level}: генератор обещал однозначность`);

            const result = solveGrid({
                cols: board.cols,
                rows: board.rows,
                rowClues: puzzle.rowClues,
                colClues: puzzle.colClues,
            });
            assert(result.solved, `${level}: решатель дошёл до конца`);
            for (let c = 0; c < puzzle.grid.length; c++) {
                const filled = result.grid[c] === FILLED ? 1 : 0;
                assertEqual(filled, puzzle.grid[c], `${level}: клетка ${c}`);
            }
        }
    }
});

test('картинка не пустая и не закрашена целиком', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 20; i++) {
        const puzzle = generatePuzzle({ ...BOARDS.easy, rng });
        const filled = puzzle.grid.reduce((sum, cell) => sum + cell, 0);
        assert(filled > 0, 'что-то закрашено');
        assert(filled < puzzle.grid.length, 'закрашено не всё');
    }
});

test('одно семя — одна и та же картинка', () => {
    const board = BOARDS.medium;
    const a = generatePuzzle({ ...board, rng: mulberry32(777) }).grid.join('');
    const b = generatePuzzle({ ...board, rng: mulberry32(777) }).grid.join('');
    assertEqual(a, b, 'картинки совпали');
});

// --- Замер времени: бюджет — «меньше 100 мс на картинку», как у генератора судоку.

test('генерация укладывается в бюджет', () => {
    const rows = [];
    for (const [level, board] of Object.entries(BOARDS)) {
        const rng = mulberry32(31337);
        const N = 50;
        let total = 0;
        let max = 0;
        let attempts = 0;
        for (let i = 0; i < N; i++) {
            const started = performance.now();
            const puzzle = generatePuzzle({ ...board, rng });
            const spent = performance.now() - started;
            total += spent;
            max = Math.max(max, spent);
            attempts += puzzle.attempts;
        }
        rows.push({ level, avg: total / N, max, attempts: attempts / N });
        assert(max < 100, `${level}: худшая генерация ${max.toFixed(1)} мс`);
    }

    console.log('      уровень | ср. время | макс. | попыток');
    for (const r of rows) {
        console.log(`      ${r.level.padEnd(7)} | ${r.avg.toFixed(1).padStart(6)} мс | ${r.max.toFixed(1).padStart(5)} | ${r.attempts.toFixed(1)}`);
    }
});

report('nonogram/generator');
