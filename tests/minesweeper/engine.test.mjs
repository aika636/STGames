// Тесты правил сапёра (Фаза 10.1): открытие с разливом, флажки, аккорд, конец партии
// и круговой рейс сохранения.
//
// Запуск: node tests/minesweeper/engine.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    boardFor,
    chord,
    createGame,
    deserialize,
    idx,
    neighbors,
    openCell,
    plant,
    remainingMines,
    serialize,
    toggleFlag,
    wrongFlags,
} from '../../src/games/minesweeper/core/engine.js';

// Поле 5×5 с двумя минами в правом нижнем углу: слева от них — большая пустая область,
// на которой видно разлив.
function field() {
    const state = createGame({ cols: 5, rows: 5, mines: 2 });
    plant(state, [idx(5, 4, 4), idx(5, 3, 4)]);
    return state;
}

test('соседей у угла три, у края пять, у центра восемь', () => {
    assertEqual(neighbors(5, 5, idx(5, 0, 0)).length, 3, 'угол');
    assertEqual(neighbors(5, 5, idx(5, 2, 0)).length, 5, 'край');
    assertEqual(neighbors(5, 5, idx(5, 2, 2)).length, 8, 'центр');
});

test('plant считает числа вокруг мин', () => {
    const state = field();
    assertEqual(state.count[idx(5, 4, 3)], 2, 'над двумя минами');
    assertEqual(state.count[idx(5, 2, 4)], 1, 'слева от левой мины');
    assertEqual(state.count[idx(5, 0, 0)], 0, 'дальний угол');
});

test('открытие нуля разливается до цифр и останавливается на них', () => {
    const state = field();
    const res = openCell(state, idx(5, 0, 0));
    assert(res.ok, 'ход принят');
    assert(!res.exploded, 'мины не задеты');
    // Открылось всё, кроме мин и клеток под ними: цифры входят в область, их соседи — нет.
    assertEqual(res.opened.length, 23, 'открыто клеток');
    assertEqual(state.open[idx(5, 4, 4)], 0, 'мина закрыта');
    assertEqual(state.open[idx(5, 2, 4)], 1, 'граничная цифра открыта');
});

test('флажок не даёт открыть клетку и считается в остатке мин', () => {
    const state = field();
    assertEqual(remainingMines(state), 2, 'до флажков');
    assert(toggleFlag(state, idx(5, 4, 4)), 'флажок поставлен');
    assertEqual(remainingMines(state), 1, 'после флажка');

    const res = openCell(state, idx(5, 4, 4));
    assert(!res.ok, 'клик по флажку игнорируется');
    assert(!state.over, 'партия продолжается');

    assert(toggleFlag(state, idx(5, 4, 4)), 'флажок снят');
    assertEqual(remainingMines(state), 2, 'остаток вернулся');
});

test('открытая мина заканчивает партию и запоминает клетку взрыва', () => {
    const state = field();
    const boom = idx(5, 4, 4);
    const res = openCell(state, boom);
    assert(res.exploded, 'взрыв');
    assert(state.over && !state.won, 'партия проиграна');
    assertEqual(state.exploded, boom, 'клетка взрыва');
    assert(!openCell(state, idx(5, 0, 0)).ok, 'после конца ходов нет');
});

test('победа — когда открыты все клетки без мин, флажки доставляются сами', () => {
    const state = field();
    openCell(state, idx(5, 0, 0));
    // Разлив с дальнего угла открывает всё, кроме двух мин, — этого достаточно для победы.
    assert(state.won, 'партия выиграна');
    assertEqual(state.flag[idx(5, 4, 4)], 1, 'мина помечена');
    assertEqual(remainingMines(state), 0, 'счётчик мин обнулён');
});

test('аккорд открывает соседей, когда флажков ровно столько же', () => {
    const state = createGame({ cols: 5, rows: 5, mines: 1 });
    plant(state, [idx(5, 0, 0)]);
    const one = idx(5, 1, 1);
    openCell(state, one);
    assertEqual(state.count[one], 1, 'цифра рядом с миной');

    assert(!chord(state, one).ok, 'без флажка аккорд не срабатывает');
    toggleFlag(state, idx(5, 0, 0));
    const res = chord(state, one);
    assert(res.ok, 'аккорд сработал');
    assert(!res.exploded, 'мина не задета');
    assert(state.won, 'поле дораскрыто до победы');
});

test('аккорд по неверно расставленным флажкам взрывает партию', () => {
    const state = field();
    const digit = idx(5, 4, 3);
    openCell(state, digit);
    toggleFlag(state, idx(5, 3, 3));
    toggleFlag(state, idx(5, 3, 4));
    const res = chord(state, digit);
    assert(res.exploded, 'взрыв на аккорде');
    assertEqual(wrongFlags(state).length, 1, 'неверный флажок один');
});

test('serialize/deserialize — круговой рейс', () => {
    const state = field();
    openCell(state, idx(5, 4, 3));
    toggleFlag(state, idx(5, 4, 4));
    state.elapsed = 42;

    const restored = deserialize(serialize(state));
    assert(restored, 'партия восстановлена');
    assertEqual(restored.cols, 5, 'ширина');
    assertEqual(restored.mines, 2, 'мин');
    assertEqual(restored.elapsed, 42, 'время');
    assertEqual(restored.open[idx(5, 4, 3)], 1, 'открытая клетка');
    assertEqual(restored.flag[idx(5, 4, 4)], 1, 'флажок');
    assertEqual(restored.count[idx(5, 4, 3)], 2, 'числа пересчитаны, а не сохранены');
    assertEqual(restored.openedCount, state.openedCount, 'счётчик открытых');
});

test('deserialize переживает мусор из settings.json', () => {
    assertEqual(deserialize(null), null, 'null');
    assertEqual(deserialize('привет'), null, 'строка');
    assertEqual(deserialize({ cols: 5, rows: 5, mines: 2 }), null, 'без полей поля');
    assertEqual(deserialize({ cols: 5, rows: 5, mines: 99, mine: '', open: '', flag: '' }), null, 'мин больше клеток');

    const broken = serialize(field());
    broken.open = broken.open.slice(1);
    assertEqual(deserialize(broken), null, 'обрезанная строка состояния');
});

test('deserialize закрывает открытую мину в незаконченной партии', () => {
    const state = field();
    const raw = serialize(state);
    // Ручная правка: мина «открыта», но партия не закончена — так не бывает.
    const boom = idx(5, 4, 4);
    raw.open = raw.open.slice(0, boom) + '1' + raw.open.slice(boom + 1);
    raw.over = false;

    const restored = deserialize(raw);
    assert(restored, 'партия восстановлена');
    assertEqual(restored.open[boom], 0, 'мина закрыта обратно');
});

test('boardFor знает уровни и не падает на чужом значении', () => {
    assertEqual(boardFor('hard').cols, 16, 'сложный');
    assertEqual(boardFor('нет такого').cols, boardFor('easy').cols, 'фолбэк на лёгкий');
});

report('minesweeper/engine');
