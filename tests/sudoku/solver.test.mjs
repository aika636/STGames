// Тесты решателя и базовых операций над сеткой.
// Запуск: node tests/solver.test.mjs

import {
    CELLS,
    countGivens,
    emptyGrid,
    findConflicts,
    formatGrid,
    isSolved,
    isValidPlacement,
    parseGrid,
} from '../../src/games/sudoku/core/grid.js';
import { countSolutions, findSolutions, hasUniqueSolution, solve } from '../../src/games/sudoku/core/solver.js';
import { mulberry32 } from '../../src/games/sudoku/core/rng.js';
import { assert, assertEqual, report, test } from '../_harness.mjs';

// Классический пример головоломки (Wikipedia, «Sudoku»). Решение не захардкожено —
// тест проверяет свойства решения, а не конкретную строку.
const CLASSIC =
    '530070000' +
    '600195000' +
    '098000060' +
    '800060003' +
    '400803001' +
    '700020006' +
    '060000280' +
    '000419005' +
    '000080079';

// Головоломка с 17 подсказками — известный минимум, решение единственное.
const MINIMAL_17 =
    '000000010' +
    '400000000' +
    '020000000' +
    '000050407' +
    '008000300' +
    '001090000' +
    '300400200' +
    '050100000' +
    '000806000';

console.log('grid + solver');

test('parseGrid/formatGrid — обратимы', () => {
    const grid = parseGrid(CLASSIC);
    assertEqual(grid.length, CELLS, 'длина сетки');
    assertEqual(formatGrid(grid, '0'), CLASSIC, 'строка после round-trip');
});

test('parseGrid отвергает мусор', () => {
    let threw = false;
    try {
        parseGrid('12345');
    } catch {
        threw = true;
    }
    assert(threw, 'короткая строка должна бросать');
});

test('countGivens считает подсказки', () => {
    assertEqual(countGivens(parseGrid(CLASSIC)), 30, 'подсказок в классическом примере');
    assertEqual(countGivens(parseGrid(MINIMAL_17)), 17, 'подсказок в минимальной головоломке');
});

test('findConflicts находит дубликат в строке', () => {
    const grid = emptyGrid();
    grid[0] = 5;
    grid[4] = 5; // та же строка
    const conflicts = findConflicts(grid);
    assertEqual(conflicts.size, 2, 'конфликтующих клеток');
    assert(conflicts.has(0) && conflicts.has(4), 'обе клетки помечены');
});

test('findConflicts находит дубликат в боксе', () => {
    const grid = emptyGrid();
    grid[0] = 7;
    grid[10] = 7; // соседняя строка и столбец, тот же бокс
    assertEqual(findConflicts(grid).size, 2, 'конфликтующих клеток');
});

test('findConflicts молчит на валидной сетке', () => {
    assertEqual(findConflicts(parseGrid(CLASSIC)).size, 0, 'конфликтов в валидной головоломке');
});

test('isValidPlacement учитывает всех соседей', () => {
    const grid = parseGrid(CLASSIC);
    assert(!isValidPlacement(grid, 2, 5), '5 уже стоит в первой строке');
    assert(isValidPlacement(grid, 2, 4), '4 в первой строке допустима');
});

test('solve решает классическую головоломку', () => {
    const puzzle = parseGrid(CLASSIC);
    const solution = solve(puzzle);
    assert(solution, 'решение найдено');
    assert(isSolved(solution), 'решение полное и без конфликтов');
    for (let idx = 0; idx < CELLS; idx++) {
        if (puzzle[idx]) assertEqual(solution[idx], puzzle[idx], `подсказка в клетке ${idx} сохранена`);
    }
});

test('solve справляется с головоломкой из 17 подсказок', () => {
    const solution = solve(parseGrid(MINIMAL_17));
    assert(solution && isSolved(solution), 'решение найдено и валидно');
});

test('countSolutions: у классической головоломки решение единственное', () => {
    assertEqual(countSolutions(parseGrid(CLASSIC), 2), 1, 'число решений');
    assert(hasUniqueSolution(parseGrid(CLASSIC)), 'hasUniqueSolution');
});

test('countSolutions: пустая сетка имеет много решений', () => {
    assertEqual(countSolutions(emptyGrid(), 2), 2, 'ранний выход на втором решении');
    assert(!hasUniqueSolution(emptyGrid()), 'пустая сетка не уникальна');
});

test('countSolutions: снятый «неизбежный набор» даёт ровно два решения', () => {
    // Четыре клетки на пересечении двух строк одной горизонтальной полосы и двух
    // столбцов из разных вертикальных полос, со значениями a/b и b/a — классический
    // unavoidable set: их можно обменять местами, не нарушив ни строку, ни столбец, ни
    // бокс (каждый из двух задетых боксов теряет a и получает b, и наоборот).
    // Если снять именно их, решений становится ровно два.
    const solution = solve(parseGrid(CLASSIC));
    const rect = findSwapRectangle(solution);
    assert(rect, 'прямоугольник для обмена найден');

    const broken = solution.slice();
    for (const idx of rect) broken[idx] = 0;
    assertEqual(countSolutions(broken, 3), 2, 'число решений');
});

// Ищет в решённой сетке четыре клетки со значениями a/b — b/a: строки берутся из одной
// горизонтальной полосы, столбцы — из разных вертикальных, иначе обмен сломал бы бокс.
function findSwapRectangle(grid) {
    for (let r1 = 0; r1 < 9; r1++) {
        for (let r2 = r1 + 1; r2 < 9; r2++) {
            if (Math.floor(r1 / 3) !== Math.floor(r2 / 3)) continue;
            for (let c1 = 0; c1 < 9; c1++) {
                for (let c2 = c1 + 1; c2 < 9; c2++) {
                    if (Math.floor(c1 / 3) === Math.floor(c2 / 3)) continue;
                    const a = r1 * 9 + c1;
                    const b = r1 * 9 + c2;
                    const c = r2 * 9 + c1;
                    const d = r2 * 9 + c2;
                    if (grid[a] === grid[d] && grid[b] === grid[c]) return [a, b, c, d];
                }
            }
        }
    }
    return null;
}

test('countSolutions: противоречивая сетка не имеет решений', () => {
    const grid = emptyGrid();
    grid[0] = 5;
    grid[1] = 5; // дубликат в строке
    assertEqual(countSolutions(grid, 2), 0, 'число решений');
    assertEqual(solve(grid), null, 'solve возвращает null');
});

test('solve не мутирует исходную сетку', () => {
    const puzzle = parseGrid(CLASSIC);
    const before = formatGrid(puzzle);
    solve(puzzle);
    countSolutions(puzzle, 2);
    assertEqual(formatGrid(puzzle), before, 'сетка после вызовов');
});

test('rng делает solve генератором: разные сиды — разные сетки', () => {
    const a = formatGrid(solve(emptyGrid(), { rng: mulberry32(1) }));
    const b = formatGrid(solve(emptyGrid(), { rng: mulberry32(2) }));
    assert(a !== b, 'сетки от разных сидов различаются');
    const again = formatGrid(solve(emptyGrid(), { rng: mulberry32(1) }));
    assertEqual(again, a, 'один сид даёт воспроизводимый результат');
});

test('findSolutions отдаёт не больше limit решений', () => {
    assertEqual(findSolutions(emptyGrid(), 3).length, 3, 'найдено решений');
    assertEqual(findSolutions(parseGrid(CLASSIC), 5).length, 1, 'у уникальной головоломки одно');
});

report('solver');
