// Тесты офлайн-генератора кроссворда (Фаза 12.2): сетка симметрична и связна,
// банк укладывается, а главное — раскладка ЕДИНСТВЕННА. В конце — замер времени,
// как в Фазе 1 для судоку и в Фазе 11 для нонограммы.
//
// Генератор — офлайн-инструмент (tools/), в расширение он не входит; тест гоняет
// его на настоящем словаре по длинам (src/games/crossword/data/words.js, Фаза 12.1)
// и заодно проверяет, что генератор этот формат читает.
//
// Запуск: node tests/crossword/generator.test.mjs

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assert, assertEqual, report, test } from '../_harness.mjs';
import { parsePuzzle, slotsFromGrid } from '../../src/games/crossword/core/puzzles.js';
import {
    LEVELS,
    buildDictionary,
    countArrangements,
    generateGrid,
    generatePuzzle,
    levelFor,
    loadDictionary,
    mulberry32,
    renderPool,
} from '../../tools/build-crossword.mjs';

const WORDS = fileURLToPath(new URL('../../src/games/crossword/data/words.js', import.meta.url));
const dict = buildDictionary(await loadDictionary(WORDS));

test('словарь по длинам читается генератором', () => {
    for (let len = 3; len <= 9; len++) {
        assert((dict.byLength.get(len)?.length ?? 0) > 100, `длина ${len}: ${dict.byLength.get(len)?.length ?? 0} слов`);
    }
});

test('levelFor знает уровни и не падает на чужом значении', () => {
    assertEqual(levelFor('hard').cols, 11, 'сложный');
    assertEqual(levelFor('чего?').cols, levelFor('easy').cols, 'фолбэк на лёгкий');
});

test('сетка симметрична на 180° и связна по пересечениям', () => {
    const rng = mulberry32(1234);
    let built = 0;
    for (let i = 0; i < 600 && built < 20; i++) {
        const grid = generateGrid({ ...LEVELS.medium, dict, rng });
        if (!grid) continue;
        built++;
        const { cols, rows } = LEVELS.medium;
        for (let cell = 0; cell < grid.length; cell++) {
            const x = cell % cols;
            const y = (cell - x) / cols;
            const twin = (rows - 1 - y) * cols + (cols - 1 - x);
            assertEqual(grid[cell], grid[twin], `клетка ${cell} и её зеркало`);
        }
        const slots = slotsFromGrid(grid, cols, rows);
        assert(slots.length >= LEVELS.medium.minSlots, 'слотов не меньше нижней границы');
        assert(slots.length <= LEVELS.medium.maxSlots, 'слотов не больше верхней границы');
    }
    assert(built >= 20, `сеток построено ${built}`);
});

test('countArrangements ловит неоднозначность', () => {
    // Крест 5×5: два пятибуквенных слова, одно пересечение посередине. Обе буквы
    // на стыке — третьи, поэтому слова свободно меняются местами: раскладок две.
    const grid = '##.##' + '##.##' + '.....' + '##.##' + '##.##';
    const slots = slotsFromGrid(grid, 5, 5);
    assertEqual(slots.length, 2, 'слота два');
    assertEqual(countArrangements(slots, ['КНИГА', 'СЛИВА'], 25, 5), 2, 'раскладок две');
    // А если букв на стыке разные — не ложится вовсе.
    assertEqual(countArrangements(slots, ['КНИГА', 'ЛОДКА'], 25, 5), 0, 'не ложится');
});

test('countArrangements считает единственную раскладку', () => {
    const grid = '....#' + '.#.##' + '....#' + '.#.##' + '.....';
    const slots = slotsFromGrid(grid, 5, 5);
    const bank = ['АТАКА', 'ЛОДКА', 'МАРКА', 'МЕЛЬ', 'РЯДЫ'];
    assertEqual(countArrangements(slots, bank, 25, 5), 1, 'ровно одна');
});

test('головоломка каждого уровня раскладывается однозначно', () => {
    for (const level of Object.keys(LEVELS)) {
        const rng = mulberry32(2026);
        for (let i = 0; i < 5; i++) {
            const raw = generatePuzzle({ level, dict, rng });
            assert(raw, `${level}: головоломка построена`);

            // Ядро обязано принять то, что выдал генератор: один формат на двоих.
            const puzzle = parsePuzzle(raw);
            assert(puzzle, `${level}: ядро разобрало головоломку`);
            assertEqual(puzzle.slots.length, puzzle.bank.length, `${level}: слов ровно по слотам`);

            // Главная гарантия Фазы 12.2.
            assertEqual(
                countArrangements(puzzle.slots, puzzle.bank, puzzle.cols * puzzle.rows, 3),
                1,
                `${level}: раскладка единственна`,
            );

            // И у каждого слота есть пересечение — без него слово ничем не держится.
            for (const slot of puzzle.slots) {
                const crossed = slot.cells.some((cell) => puzzle.cellSlots[cell].length > 1);
                assert(crossed, `${level}: слот ${slot.index} без пересечений`);
            }
        }
    }
});

await test('renderPool пишет модуль, который читается обратно', async () => {
    const rng = mulberry32(77);
    const puzzle = generatePuzzle({ level: 'easy', dict, rng });
    const dir = mkdtempSync(join(tmpdir(), 'stgames-crossword-'));
    try {
        const file = join(dir, 'puzzles.js');
        writeFileSync(file, renderPool({ easy: [puzzle] }), 'utf8');
        const pool = (await import(pathToFileURL(file).href)).default;
        assertEqual(pool.version, 1, 'версия формата');
        assertEqual(pool.levels.easy.length, 1, 'головоломок в уровне');
        assert(parsePuzzle(pool.levels.easy[0]), 'записанная головоломка разбирается');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// --- Замер времени. Бюджета нет: генератор офлайновый, пул собирается руками
// и коммитится. Таблица нужна, чтобы оценить время сборки пула.

test('замер генерации', () => {
    const rows = [];
    for (const level of Object.keys(LEVELS)) {
        const rng = mulberry32(31337);
        const N = 10;
        let total = 0;
        let max = 0;
        let grids = 0;
        let fills = 0;
        let slots = 0;
        for (let i = 0; i < N; i++) {
            const started = performance.now();
            const puzzle = generatePuzzle({ level, dict, rng });
            const spent = performance.now() - started;
            assert(puzzle, `${level}: генератор сошёлся`);
            total += spent;
            max = Math.max(max, spent);
            grids += puzzle.grids;
            fills += puzzle.fills;
            slots += puzzle.slots;
        }
        rows.push({ level, avg: total / N, max, grids: grids / N, fills: fills / N, slots: slots / N });
    }

    console.log('      уровень | ср. время |   макс. | сеток | укладок | слов в банке');
    for (const r of rows) {
        console.log(`      ${r.level.padEnd(7)} | ${r.avg.toFixed(0).padStart(6)} мс | ${r.max.toFixed(0).padStart(4)} мс | ${r.grids.toFixed(1).padStart(5)} | ${r.fills.toFixed(1).padStart(7)} | ${r.slots.toFixed(1)}`);
    }
});

report('crossword/generator');
