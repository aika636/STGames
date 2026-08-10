// Тесты генерации поля и решателя (Фаза 10.2): безопасный первый клик, точное число
// мин, воспроизводимость по семени и главное — поле в режиме «без угадывания» берётся
// решателем целиком. В конце — замер времени генерации, как в Фазе 1 для судоку.
//
// Запуск: node tests/minesweeper/generator.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import { BOARDS, idx, neighbors, plant, createGame } from '../../src/games/minesweeper/core/engine.js';
import { generateField, mulberry32, safeZone } from '../../src/games/minesweeper/core/generator.js';
import { solveFrom } from '../../src/games/minesweeper/core/solver.js';

function fieldOf(board, mines) {
    const state = createGame(board);
    plant(state, mines);
    return { ...board, mine: state.mine, count: state.count };
}

test('безопасная зона — клетка и её соседи', () => {
    const zone = safeZone(9, 9, idx(9, 4, 4), 10);
    assertEqual(zone.length, 9, 'девять клеток');
    assert(zone.includes(idx(9, 4, 4)), 'сама клетка');
});

test('на тесном поле безопасная зона сжимается до одной клетки', () => {
    // 3×3 с восемью минами: свободна ровно одна клетка, зоной вокруг неё жертвуем.
    const zone = safeZone(3, 3, idx(3, 1, 1), 8);
    assertEqual(zone.length, 1, 'только сама клетка');
});

test('первый клик безопасен, мин ровно столько, сколько заказано', () => {
    const rng = mulberry32(7);
    for (const board of Object.values(BOARDS)) {
        for (let i = 0; i < 20; i++) {
            const safe = Math.floor(rng() * board.cols * board.rows);
            const { mines } = generateField({ ...board, safeIndex: safe, rng });
            assertEqual(mines.length, board.mines, 'число мин');
            assertEqual(new Set(mines).size, board.mines, 'мины не дублируются');
            assert(!mines.includes(safe), 'мины нет под первым кликом');
            for (const j of neighbors(board.cols, board.rows, safe)) {
                assert(!mines.includes(j), 'мины нет рядом с первым кликом');
            }
        }
    }
});

test('одно семя — одно и то же поле', () => {
    const board = BOARDS.medium;
    const a = generateField({ ...board, safeIndex: 40, rng: mulberry32(99) }).mines;
    const b = generateField({ ...board, safeIndex: 40, rng: mulberry32(99) }).mines;
    assertEqual(a.join(','), b.join(','), 'расстановки совпали');
});

test('режим «без угадывания» даёт поле, которое решатель берёт целиком', () => {
    const rng = mulberry32(2024);
    for (const [level, board] of Object.entries(BOARDS)) {
        for (let i = 0; i < 25; i++) {
            const safe = Math.floor(rng() * board.cols * board.rows);
            const { mines, guessFree } = generateField({ ...board, safeIndex: safe, rng, noGuess: true });
            assert(guessFree, `${level}: поле обещано без угадывания`);
            const { solved } = solveFrom(fieldOf(board, mines), safe);
            assert(solved, `${level}: решатель дошёл до конца`);
        }
    }
});

test('решатель честно отказывается от поля с развилкой', () => {
    // Классическая концовка «пятьдесят на пятьдесят»: поле 2×3 с одной миной в верхней
    // строке. Обе цифры под ней видят обе клетки и говорят одно и то же, счётчик мин
    // тоже: конфигурации две, различить их нечем.
    //
    //   ? ?
    //   1 1
    //   0 0   ← первый клик
    const board = { cols: 2, rows: 3, mines: 1 };
    const { solved } = solveFrom(fieldOf(board, [idx(2, 0, 0)]), idx(2, 0, 2));
    assert(!solved, 'развилка не разбирается логикой');
});

test('правило подмножества разбирает то, чего не берут одиночные цифры', () => {
    // Поле 3×4: мины в двух клетках верхней строки. Простое правило встаёт, вывод
    // «1-2 по краю» — нет.
    const board = { cols: 3, rows: 4, mines: 2 };
    const mines = [idx(3, 0, 0), idx(3, 1, 0)];
    const { solved } = solveFrom(fieldOf(board, mines), idx(3, 1, 3));
    assert(solved, 'поле разобрано без угадывания');
});

// --- Замер времени: бюджет — «меньше 100 мс на поле», как у генератора судоку.

test('генерация укладывается в бюджет', () => {
    const rows = [];
    for (const [level, board] of Object.entries(BOARDS)) {
        const rng = mulberry32(31337);
        const N = 50;
        let total = 0;
        let max = 0;
        let attempts = 0;
        for (let i = 0; i < N; i++) {
            const safe = Math.floor(rng() * board.cols * board.rows);
            const started = performance.now();
            const result = generateField({ ...board, safeIndex: safe, rng, noGuess: true });
            const spent = performance.now() - started;
            total += spent;
            max = Math.max(max, spent);
            attempts += result.attempts;
        }
        rows.push({ level, avg: total / N, max, attempts: attempts / N });
        assert(max < 100, `${level}: худшая генерация ${max.toFixed(1)} мс`);
    }

    console.log('      уровень | ср. время | макс. | попыток');
    for (const r of rows) {
        console.log(`      ${r.level.padEnd(7)} | ${r.avg.toFixed(1).padStart(6)} мс | ${r.max.toFixed(1).padStart(5)} | ${r.attempts.toFixed(1)}`);
    }
});

report('minesweeper/generator');
