// Тесты партии нонограммы (Фаза 11.3): метки, победа по закрашенным клеткам, гашение
// выполненных подсказок и круговой рейс сохранения.
//
// Запуск: node tests/nonogram/game.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    CROSS,
    EMPTY,
    FILLED,
    checkWin,
    colDone,
    createGame,
    deserialize,
    isSolved,
    remaining,
    rowDone,
    serialize,
    setMark,
    wrongMarks,
} from '../../src/games/nonogram/core/game.js';
import { cluesFromGrid } from '../../src/games/nonogram/core/solver.js';

// Картинка 3×3 «уголок»:
//   # # .
//   # . .
//   # # #
const PICTURE = [1, 1, 0, 1, 0, 0, 1, 1, 1];

function game() {
    const clues = cluesFromGrid(PICTURE, 3, 3);
    return createGame({ cols: 3, rows: 3, grid: PICTURE, ...clues });
}

function fillPicture(state) {
    for (let i = 0; i < PICTURE.length; i++) {
        if (PICTURE[i]) setMark(state, i, FILLED);
    }
}

test('createGame считает подсказки по картинке', () => {
    const state = game();
    assertEqual(state.rowClues.map((c) => c.join('')).join('|'), '2|1|3', 'строки');
    assertEqual(state.colClues.map((c) => c.join('')).join('|'), '3|11|1', 'столбцы');
    assertEqual(remaining(state), 6, 'осталось закрасить');
});

test('setMark ставит и снимает метку, повтор ничего не меняет', () => {
    const state = game();
    assert(setMark(state, 0, FILLED), 'клетка закрашена');
    assert(!setMark(state, 0, FILLED), 'та же метка — не изменение');
    assert(setMark(state, 0, CROSS), 'крестик поверх закраски');
    assert(setMark(state, 0, EMPTY), 'метка снята');
});

test('крестики на победу не влияют', () => {
    const state = game();
    fillPicture(state);
    // Крестики на пустых клетках — рабочая пометка игрока, картинку она не меняет.
    setMark(state, 2, CROSS);
    setMark(state, 4, CROSS);
    assert(isSolved(state), 'картинка собрана');
    assert(checkWin(state), 'победа зафиксирована');
    assert(state.over && state.won, 'партия закончена');
});

test('лишняя закрашенная клетка победу отменяет', () => {
    const state = game();
    fillPicture(state);
    setMark(state, 2, FILLED);
    assert(!isSolved(state), 'картинка не совпала');
    assertEqual(wrongMarks(state).length, 1, 'ошибка одна');
});

test('после победы метки не меняются', () => {
    const state = game();
    fillPicture(state);
    checkWin(state);
    assert(!setMark(state, 2, FILLED), 'поле заморожено');
});

test('выполненные подсказки гаснут по строкам и столбцам', () => {
    const state = game();
    assert(!rowDone(state, 0), 'пустая строка не выполнена');
    setMark(state, 0, FILLED);
    setMark(state, 1, FILLED);
    assert(rowDone(state, 0), 'строка выполнена');

    setMark(state, 3, FILLED);
    setMark(state, 6, FILLED);
    assert(colDone(state, 0), 'столбец выполнен');
    assert(!colDone(state, 1), 'соседний столбец ещё нет');
});

test('remaining считает только незакрашенное из картинки', () => {
    const state = game();
    setMark(state, 0, FILLED);
    assertEqual(remaining(state), 5, 'одна клетка закрашена');
    setMark(state, 2, FILLED);
    assertEqual(remaining(state), 5, 'ошибочная клетка остаток не уменьшает');
});

test('serialize/deserialize — круговой рейс', () => {
    const state = game();
    setMark(state, 0, FILLED);
    setMark(state, 2, CROSS);
    state.elapsed = 77;

    const restored = deserialize(serialize(state));
    assert(restored, 'партия восстановлена');
    assertEqual(restored.cols, 3, 'ширина');
    assertEqual(restored.marks[0], FILLED, 'закраска');
    assertEqual(restored.marks[2], CROSS, 'крестик');
    assertEqual(restored.elapsed, 77, 'время');
    assertEqual(restored.rowClues.map((c) => c.join('')).join('|'), '2|1|3', 'подсказки пересчитаны, а не сохранены');
});

test('собранная картинка восстанавливается как законченная партия', () => {
    const state = game();
    fillPicture(state);
    const raw = serialize(state);
    // Ручная правка: партия «идёт», хотя картинка уже собрана.
    raw.over = false;
    raw.won = false;

    const restored = deserialize(raw);
    assert(restored.over && restored.won, 'победа досчитана честно');
});

test('deserialize переживает мусор из settings.json', () => {
    assertEqual(deserialize(null), null, 'null');
    assertEqual(deserialize('картинка'), null, 'строка');
    assertEqual(deserialize({ cols: 3, rows: 3 }), null, 'без полей');

    const broken = serialize(game());
    broken.marks = broken.marks.replace('0', '7');
    assertEqual(deserialize(broken), null, 'чужая метка');

    const short = serialize(game());
    short.solution = short.solution.slice(1);
    assertEqual(deserialize(short), null, 'обрезанная картинка');
});

report('nonogram/game');
