// Тесты банка картинок нонограммы: формат рисунков и — главное — их честность. Каждый
// рисунок обязан решаться линейными выводами, иначе игрок вынужден угадывать, а победа
// сверяется ровно с одной картинкой. Это тот тест, который надо гонять после каждой
// новой картинки в src/games/nonogram/data/pictures.js.
//
// Запуск: node tests/nonogram/pictures.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import { PICTURES, gridOf, picturesFor } from '../../src/games/nonogram/data/pictures.js';
import { BOARDS } from '../../src/games/nonogram/core/generator.js';
import { FILLED, cluesFromGrid, solveGrid } from '../../src/games/nonogram/core/solver.js';

test('строки картинки одной длины и без посторонних символов', () => {
    for (const pic of PICTURES) {
        assertEqual(pic.cells.length, pic.rows, `${pic.id}: число строк`);
        for (const row of pic.cells) {
            assertEqual(row.length, pic.cols, `${pic.id}: ширина строки «${row}»`);
            assert(/^[#.]+$/.test(row), `${pic.id}: только # и . в «${row}»`);
        }
    }
});

test('id картинок не повторяются', () => {
    const seen = new Set();
    for (const pic of PICTURES) {
        assert(!seen.has(pic.id), `${pic.id}: повтор id`);
        seen.add(pic.id);
    }
});

test('картинка не пустая и не закрашена целиком', () => {
    for (const pic of PICTURES) {
        const grid = gridOf(pic);
        const filled = grid.reduce((sum, cell) => sum + cell, 0);
        assert(filled > 0, `${pic.id}: что-то закрашено`);
        assert(filled < grid.length, `${pic.id}: закрашено не всё`);
    }
});

test('каждая картинка решается однозначно и без перебора', () => {
    for (const pic of PICTURES) {
        const grid = gridOf(pic);
        const clues = cluesFromGrid(grid, pic.cols, pic.rows);
        const result = solveGrid({ cols: pic.cols, rows: pic.rows, ...clues });
        assert(!result.contradiction, `${pic.id}: подсказки непротиворечивы`);
        assert(result.solved, `${pic.id}: решатель дошёл до конца линейными выводами`);
        for (let i = 0; i < grid.length; i++) {
            const filled = result.grid[i] === FILLED ? 1 : 0;
            assertEqual(filled, grid[i], `${pic.id}: клетка ${i}`);
        }
    }
});

test('на каждый уровень есть из чего выбирать', () => {
    for (const [level, board] of Object.entries(BOARDS)) {
        const pool = picturesFor(board.cols, board.rows);
        // Меньше двадцати — и «Новая» начнёт крутить одно и то же по кругу за вечер.
        assert(pool.length >= 20, `${level}: рисунков ${pool.length}`);
    }
    // Не «ровно 100», а «не меньше»: банк пополняется, и тест не должен мешать этому.
    assert(PICTURES.length >= 100, `весь банк: ${PICTURES.length} рисунков`);
});

report('nonogram/pictures');
