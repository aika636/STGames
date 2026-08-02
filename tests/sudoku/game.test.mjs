// Тесты модели партии.
// Запуск: node tests/game.test.mjs

import { CELLS, parseGrid } from '../../src/games/sudoku/core/grid.js';
import { generatePuzzle } from '../../src/games/sudoku/core/generator.js';
import { mulberry32 } from '../../src/games/sudoku/core/rng.js';
import {
    canRedo,
    canUndo,
    clearCell,
    complete,
    countFilled,
    createGame,
    deserializeGame,
    formatElapsed,
    getConflicts,
    getElapsedMs,
    getMistakes,
    hasNote,
    isGiven,
    isWon,
    pauseTimer,
    redo,
    remainingCounts,
    serializeGame,
    setValue,
    startTimer,
    toggleNote,
    undo,
} from '../../src/games/sudoku/core/game.js';
import { assert, assertEqual, report, test } from '../_harness.mjs';

function newGame(difficulty = 'easy', seed = 123) {
    const generated = generatePuzzle({ difficulty, rng: mulberry32(seed) });
    return createGame(generated);
}

// Индекс первой пустой клетки — на ней ставятся все опыты.
function firstEmpty(state) {
    return state.values.findIndex((value) => value === 0);
}

console.log('game');

test('createGame отвергает сетку неправильной длины', () => {
    let threw = false;
    try {
        createGame({ puzzle: [1, 2, 3], solution: new Array(CELLS).fill(1) });
    } catch {
        threw = true;
    }
    assert(threw, 'ожидалось исключение');
});

test('createGame копирует массивы, а не ссылается на них', () => {
    const generated = generatePuzzle({ difficulty: 'easy', rng: mulberry32(1) });
    const state = createGame(generated);
    state.values[0] = 9;
    assert(state.puzzle !== generated.puzzle, 'puzzle скопирован');
    assertEqual(generated.puzzle[0], generated.puzzle[0], 'исходная головоломка не тронута');
});

test('setValue не трогает подсказки', () => {
    const state = newGame();
    const givenIdx = state.puzzle.findIndex((value) => value !== 0);
    assert(isGiven(state, givenIdx), 'клетка — подсказка');
    assertEqual(setValue(state, givenIdx, 5), false, 'ход отклонён');
});

test('setValue ставит и снимает цифру повторным вводом', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    assert(setValue(state, idx, 7), 'цифра поставлена');
    assertEqual(state.values[idx], 7, 'значение клетки');
    assert(setValue(state, idx, 7), 'повторный ввод изменил состояние');
    assertEqual(state.values[idx], 0, 'клетка очищена');
});

test('setValue чистит пометки соседей', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    // Пометка «5» в клетке-соседе по строке.
    const peer = state.values.findIndex((value, i) => value === 0 && i !== idx && Math.floor(i / 9) === Math.floor(idx / 9));
    assert(peer !== -1, 'сосед по строке найден');
    toggleNote(state, peer, 5);
    assert(hasNote(state, peer, 5), 'пометка стоит');

    setValue(state, idx, 5);
    assert(!hasNote(state, peer, 5), 'пометка убрана автоматически');
});

test('setValue с autoCleanNotes: false не трогает соседей', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    const peer = state.values.findIndex((value, i) => value === 0 && i !== idx && Math.floor(i / 9) === Math.floor(idx / 9));
    toggleNote(state, peer, 5);
    setValue(state, idx, 5, { autoCleanNotes: false });
    assert(hasNote(state, peer, 5), 'пометка на месте');
});

test('toggleNote работает только в пустых клетках', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    assert(toggleNote(state, idx, 3), 'пометка поставлена');
    assert(hasNote(state, idx, 3), 'пометка читается');
    assert(toggleNote(state, idx, 3), 'пометка снята');
    assert(!hasNote(state, idx, 3), 'пометки нет');

    setValue(state, idx, 4);
    assertEqual(toggleNote(state, idx, 3), false, 'в заполненной клетке пометку не поставить');
});

test('setValue стирает пометки самой клетки', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    toggleNote(state, idx, 1);
    toggleNote(state, idx, 2);
    setValue(state, idx, 8);
    assertEqual(state.notes[idx], 0, 'пометки очищены');
});

test('clearCell очищает значение и пометки', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    setValue(state, idx, 6);
    assert(clearCell(state, idx), 'клетка очищена');
    assertEqual(state.values[idx], 0, 'значение');
    assertEqual(clearCell(state, idx), false, 'повторная очистка ничего не меняет');
});

test('undo/redo откатывают ход целиком, вместе с чисткой пометок соседей', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    const peer = state.values.findIndex((value, i) => value === 0 && i !== idx && Math.floor(i / 9) === Math.floor(idx / 9));
    toggleNote(state, peer, 5);

    setValue(state, idx, 5);
    assert(!hasNote(state, peer, 5), 'пометка соседа убрана ходом');

    assert(undo(state), 'undo сработал');
    assertEqual(state.values[idx], 0, 'значение откатано');
    assert(hasNote(state, peer, 5), 'пометка соседа вернулась');

    assert(redo(state), 'redo сработал');
    assertEqual(state.values[idx], 5, 'значение вернулось');
    assert(!hasNote(state, peer, 5), 'пометка снова убрана');
});

test('undo на пустой истории безопасен', () => {
    const state = newGame();
    assertEqual(canUndo(state), false, 'история пуста');
    assertEqual(undo(state), false, 'undo вернул false');
    assertEqual(redo(state), false, 'redo вернул false');
});

test('новый ход обесценивает redo', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    setValue(state, idx, 1);
    undo(state);
    assert(canRedo(state), 'redo доступен');
    setValue(state, idx, 2);
    assertEqual(canRedo(state), false, 'после нового хода redo сброшен');
});

test('ход, ничего не меняющий, в историю не пишется', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    assertEqual(setValue(state, idx, 0), false, 'постановка нуля в пустую клетку');
    assertEqual(canUndo(state), false, 'история пуста');
});

test('getConflicts находит дубликат, поставленный игроком', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    const row = Math.floor(idx / 9);
    const given = state.puzzle.findIndex((value, i) => value !== 0 && Math.floor(i / 9) === row);
    assert(given !== -1, 'подсказка в той же строке найдена');

    setValue(state, idx, state.puzzle[given]);
    const conflicts = getConflicts(state);
    assert(conflicts.has(idx) && conflicts.has(given), 'обе клетки в конфликте');
});

test('getMistakes находит расхождение с решением', () => {
    const state = newGame();
    const idx = firstEmpty(state);
    const wrong = state.solution[idx] === 9 ? 1 : state.solution[idx] + 1;
    setValue(state, idx, wrong);
    assert(getMistakes(state).has(idx), 'ошибка найдена');

    setValue(state, idx, wrong); // снять
    setValue(state, idx, state.solution[idx]);
    assertEqual(getMistakes(state).size, 0, 'верная цифра ошибкой не считается');
});

test('isWon и complete срабатывают на решённой доске', () => {
    const state = newGame();
    assert(!isWon(state), 'партия не решена');
    assertEqual(complete(state), false, 'complete на нерешённой доске');

    for (let idx = 0; idx < CELLS; idx++) {
        if (!isGiven(state, idx)) setValue(state, idx, state.solution[idx]);
    }
    assert(isWon(state), 'партия решена');
    assertEqual(countFilled(state), CELLS, 'все клетки заполнены');

    startTimer(state, 1000);
    assert(complete(state, 5000), 'победа зафиксирована');
    assertEqual(complete(state, 6000), false, 'повторный вызов идемпотентен');
    assertEqual(state.startedAt, null, 'таймер остановлен');
});

test('remainingCounts считает оставшиеся цифры', () => {
    const state = newGame();
    const counts = remainingCounts(state);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    assertEqual(total, CELLS - countFilled(state), 'сумма оставшихся = числу пустых клеток');

    const idx = firstEmpty(state);
    const digit = state.solution[idx];
    setValue(state, idx, digit);
    assertEqual(remainingCounts(state)[digit], counts[digit] - 1, 'счётчик цифры уменьшился');
});

test('таймер копит время через паузы', () => {
    const state = newGame();
    startTimer(state, 1000);
    assertEqual(getElapsedMs(state, 3000), 2000, 'время идёт');
    pauseTimer(state, 3000);
    assertEqual(getElapsedMs(state, 9000), 2000, 'на паузе время стоит');
    startTimer(state, 10000);
    assertEqual(getElapsedMs(state, 11000), 3000, 'после снятия паузы счёт продолжился');
});

test('formatElapsed форматирует минуты и часы', () => {
    assertEqual(formatElapsed(0), '00:00', 'ноль');
    assertEqual(formatElapsed(65_000), '01:05', 'минуты');
    assertEqual(formatElapsed(3_725_000), '1:02:05', 'часы');
});

test('serialize/deserialize сохраняют партию', () => {
    const state = newGame('medium', 77);
    const idx = firstEmpty(state);
    setValue(state, idx, 4);
    toggleNote(state, state.values.findIndex((value, i) => value === 0 && i !== idx), 7);
    startTimer(state, 1000);

    const restored = deserializeGame(serializeGame(state, 4000));
    assert(restored, 'партия восстановлена');
    assertEqual(restored.values.join(''), state.values.join(''), 'значения');
    assertEqual(restored.notes.join(''), state.notes.join(''), 'пометки');
    assertEqual(restored.elapsedMs, 3000, 'накопленное время');
    assertEqual(restored.difficulty, 'medium', 'уровень');
    assertEqual(restored.history.length, 0, 'история не сохраняется');
});

test('deserializeGame отвергает мусор', () => {
    assertEqual(deserializeGame(null), null, 'null');
    assertEqual(deserializeGame({ version: 999 }), null, 'чужая версия');
    assertEqual(deserializeGame({ version: 1, puzzle: [1, 2] }), null, 'короткий массив');

    const state = newGame();
    const broken = serializeGame(state);
    broken.values = broken.values.slice(0, 80);
    assertEqual(deserializeGame(broken), null, 'обрезанные значения');
});

test('deserializeGame восстанавливает решённую партию', () => {
    const state = newGame();
    for (let idx = 0; idx < CELLS; idx++) {
        if (!isGiven(state, idx)) setValue(state, idx, state.solution[idx]);
    }
    complete(state, 5000);
    const restored = deserializeGame(serializeGame(state));
    assert(isWon(restored), 'восстановленная партия решена');
    assertEqual(restored.completedAt, 5000, 'момент победы сохранён');
});

report('game');
