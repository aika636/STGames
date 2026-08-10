// Тесты формата головоломки кроссворда (Фаза 12.3): вывод слотов из сетки, разбор
// и проверка головоломки, выдача случайной из пула.
//
// Запуск: node tests/crossword/puzzles.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    ACROSS,
    DOWN,
    parsePuzzle,
    pickPuzzle,
    serializePuzzle,
    slotAt,
    slotsFromGrid,
} from '../../src/games/crossword/core/puzzles.js';
import { FIXTURE } from './_puzzle.mjs';

test('слоты выводятся из сетки, ряды короче трёх слотами не считаются', () => {
    // ..#
    // ...
    // ..#
    const slots = slotsFromGrid('..#' + '...' + '..#', 3, 3);
    assertEqual(slots.length, 3, 'слотов');
    assertEqual(slots[0].dir, DOWN, 'первый — вертикальный из (0,0)');
    assertEqual(slots[0].length, 3, 'длина');
    assertEqual(slots[1].dir, DOWN, 'второй — вертикальный из (1,0)');
    assertEqual(slots[2].dir, ACROSS, 'третий — горизонтальный из (0,1)');
    // Столбец 2 открыт только в средней строке — ряд длиной 1, не слот.
});

test('порядок слотов: в каждой стартовой клетке сначала across, потом down', () => {
    const slots = slotsFromGrid(FIXTURE.grid, FIXTURE.cols, FIXTURE.rows);
    assertEqual(slots.length, 5, 'слотов');
    assertEqual(`${slots[0].dir}${slots[0].length}`, `${ACROSS}4`, 'слот 0');
    assertEqual(`${slots[1].dir}${slots[1].length}`, `${DOWN}5`, 'слот 1');
    assertEqual(`${slots[2].dir}${slots[2].length}`, `${DOWN}5`, 'слот 2');
    assertEqual(`${slots[3].dir}${slots[3].length}`, `${ACROSS}4`, 'слот 3');
    assertEqual(`${slots[4].dir}${slots[4].length}`, `${ACROSS}5`, 'слот 4');
    assertEqual(slots.every((s, i) => s.index === i), true, 'index совпадает с номером');
});

test('разбор фикстуры даёт банк, решение и буквы поля', () => {
    const puzzle = parsePuzzle(FIXTURE);
    assert(puzzle, 'головоломка разобрана');
    assertEqual(puzzle.bank.length, 5, 'слов в банке');
    assertEqual(puzzle.bank[3], 'МЕЛЬ', 'банк отсортирован');
    assertEqual(puzzle.letters.slice(0, 5), 'МЕЛЬ#', 'первая строка решения');
    assertEqual(puzzle.letters.slice(20), 'АТАКА', 'последняя строка решения');
    // Клетка (0,0) — пересечение: в ней сходятся слоты 0 и 1.
    assertEqual(puzzle.cellSlots[0].length, 2, 'пересечение в углу');
});

test('slotAt находит слово нужного направления под клеткой', () => {
    const puzzle = parsePuzzle(FIXTURE);
    assertEqual(slotAt(puzzle, 0, ACROSS).index, 0, 'горизонтальный');
    assertEqual(slotAt(puzzle, 0, DOWN).index, 1, 'вертикальный');
    assertEqual(slotAt(puzzle, 1, DOWN), null, 'вертикального слота здесь нет');
});

test('битая головоломка не бросает, а даёт null', () => {
    const bad = (patch, why) => {
        assertEqual(parsePuzzle({ ...FIXTURE, ...patch }), null, why);
    };
    assertEqual(parsePuzzle(null), null, 'ничего');
    assertEqual(parsePuzzle('крест'), null, 'строка');
    bad({ cols: 0 }, 'нулевая ширина');
    bad({ cols: 4 }, 'сетка не той длины');
    bad({ grid: FIXTURE.grid.replace('.', 'x') }, 'посторонний символ в сетке');
    bad({ words: 'АТАКА ЛОДКА МАРКА МЕЛЬ' }, 'слов меньше, чем слотов');
    bad({ words: 'АТАКА АТАКА МАРКА МЕЛЬ РЯДЫ' }, 'повтор в банке');
    bad({ words: 'АТАКА ЛОДКА МАРКА МЕЛЬ RYADY' }, 'латиница');
    bad({ solution: '3,2,1,4' }, 'решение короче');
    bad({ solution: '3,2,1,4,9' }, 'индекс вне банка');
    bad({ solution: '3,2,1,4,4' }, 'одно слово в двух слотах');
    bad({ solution: '2,3,1,4,0' }, 'длина слова не сходится со слотом');
    // Слово, не сходящееся на пересечении: меняем МАРКА на СЛИВА той же длины.
    bad({ words: 'АТАКА ЛОДКА МЕЛЬ РЯДЫ СЛИВА', solution: '2,4,1,3,0' }, 'пересечение не сходится');
    // Открытая клетка, в которую не ведёт ни один слот.
    bad({ grid: '...#.' + '.#.##' + '....#' + '.#.##' + '.....' }, 'клетка вне слотов');
});

test('serializePuzzle → parsePuzzle: круговой рейс', () => {
    const puzzle = parsePuzzle(FIXTURE);
    const raw = serializePuzzle(puzzle);
    assertEqual(raw.grid, FIXTURE.grid, 'сетка');
    assertEqual(raw.words, FIXTURE.words, 'банк');
    assertEqual(raw.solution, FIXTURE.solution, 'решение');
    assertEqual(parsePuzzle(raw).letters, puzzle.letters, 'поле совпало');
});

test('pickPuzzle тасует уровень, пропускает битые и падает на фолбэк', () => {
    const pool = { version: 1, levels: { easy: [FIXTURE], hard: [{ cols: 1 }] } };
    assertEqual(pickPuzzle(pool, 'easy', () => 0).bank.length, 5, 'лёгкий уровень');
    // Уровня medium в пуле нет — берётся первый непустой.
    assertEqual(pickPuzzle(pool, 'medium', () => 0).bank.length, 5, 'фолбэк на непустой уровень');
    // В hard лежит мусор — головоломки нет, но и падения нет.
    assertEqual(pickPuzzle({ version: 1, levels: { hard: [{ cols: 1 }] } }, 'hard', () => 0), null, 'битый уровень');
    assertEqual(pickPuzzle(null, 'easy'), null, 'пула нет');
    assertEqual(pickPuzzle(pool, 'easy', () => 0.999999).bank.length, 5, 'rng у самой границы');
});

report('crossword/puzzles');
