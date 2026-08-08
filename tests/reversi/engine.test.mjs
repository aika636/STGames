// Тесты правил реверси (Фаза 8.1). Чистое ядро, зависимостей нет.
// Запуск: node tests/reversi/engine.test.mjs

import {
    BLACK, EMPTY, SIZE, WHITE,
    applyMove, createGame, deserialize, flipsFor, hasMoves, idx, isOver,
    legalMoves, opponent, score, serialize, winner,
} from '../../src/games/reversi/core/engine.js';
import { assert, assertEqual, report, test } from '../_harness.mjs';

console.log('reversi engine');

// Доска из восьми строк по восемь символов: '0' пусто, '1' чёрные, '2' белые.
// Читаемая раскладка позиции — в тестах важно видеть доску глазами.
function fromRows(rows) {
    assertEqual(rows.length, SIZE, 'строк в тестовой доске');
    const board = new Int8Array(SIZE * SIZE);
    rows.forEach((row, y) => {
        assertEqual(row.length, SIZE, `длина строки ${y}`);
        for (let x = 0; x < SIZE; x++) board[idx(x, y)] = row.charCodeAt(x) - 48;
    });
    return board;
}

// Доска, залитая одним цветом, с точечными исключениями: {'x,y': значение}.
function filled(value, holes = {}) {
    const board = new Int8Array(SIZE * SIZE).fill(value);
    for (const [key, cell] of Object.entries(holes)) {
        const [x, y] = key.split(',').map(Number);
        board[idx(x, y)] = cell;
    }
    return board;
}

function movesAsSet(board, player) {
    return new Set(legalMoves(board, player).map((m) => `${m.x},${m.y}`));
}

test('стартовая позиция: четыре фишки и четыре хода у чёрных', () => {
    const state = createGame();
    const counts = score(state.board);

    assertEqual(state.turn, BLACK, 'первыми ходят чёрные');
    assertEqual(counts.black, 2, 'чёрных фишек');
    assertEqual(counts.white, 2, 'белых фишек');
    assertEqual(counts.empty, 60, 'пустых клеток');

    const moves = movesAsSet(state.board, BLACK);
    assertEqual(moves.size, 4, 'ходов у чёрных');
    for (const cell of ['3,2', '2,3', '5,4', '4,5']) {
        assert(moves.has(cell), `ход ${cell} доступен`);
    }
});

test('ход переворачивает фишку и передаёт очередь', () => {
    const state = createGame();
    const res = applyMove(state, 3, 2);

    assert(res.ok, 'ход принят');
    assertEqual(res.flips.length, 1, 'перевёрнута одна фишка');
    assertEqual(state.board[idx(3, 3)], BLACK, 'белая в центре стала чёрной');
    assertEqual(state.board[idx(3, 2)], BLACK, 'фишка поставлена');
    assertEqual(state.turn, WHITE, 'очередь перешла к белым');
    assert(!res.passed && !res.over, 'ни паса, ни конца партии');

    const counts = score(state.board);
    assertEqual(counts.black, 4, 'чёрных стало четыре');
    assertEqual(counts.white, 1, 'белых осталась одна');
});

test('переворот считается во всех восьми направлениях', () => {
    // Кольцо белых вокруг (4,4), за ним кольцо чёрных: ход в центр бьёт по всем восьми
    // лучам сразу.
    const board = fromRows([
        '00000000',
        '00000000',
        '00111110',
        '00122210',
        '00120210',
        '00122210',
        '00111110',
        '00000000',
    ]);

    const flips = flipsFor(board, BLACK, 4, 4);
    assertEqual(flips.length, 8, 'перевёрнуты все восемь соседей');
    for (const [x, y] of [[3, 3], [4, 3], [5, 3], [3, 4], [5, 4], [3, 5], [4, 5], [5, 5]]) {
        assert(flips.includes(idx(x, y)), `клетка ${x},${y} перевёрнута`);
    }
});

test('переворот берёт всю цепочку чужих фишек', () => {
    const board = fromRows([
        '12220000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
    ]);

    const flips = flipsFor(board, BLACK, 4, 0);
    assertEqual(flips.length, 3, 'перевёрнуты три фишки подряд');
    for (const x of [1, 2, 3]) assert(flips.includes(idx(x, 0)), `клетка ${x},0 перевёрнута`);
});

test('цепочка без своей фишки на конце ничего не переворачивает', () => {
    const board = fromRows([
        '02220000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
    ]);

    assertEqual(flipsFor(board, BLACK, 4, 0).length, 0, 'цепочка упёрлась в пустоту');
    assertEqual(flipsFor(board, BLACK, 0, 0).length, 0, 'с другой стороны тоже');
});

test('переворот не заворачивается через край доски', () => {
    // Если ходить смещением индекса, а не координатами, шаг влево от (0,1) попадает
    // в (7,0) — и ход «переворачивает» фишки на предыдущей строке.
    const leftEdge = fromRows([
        '00000012',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
    ]);
    assertEqual(flipsFor(leftEdge, BLACK, 0, 1).length, 0, 'влево с левого края — некуда');
    assert(!movesAsSet(leftEdge, BLACK).has('0,1'), 'ход в (0,1) нелегален');

    // Зеркальный случай: шаг вправо от (7,0) попал бы в (0,1).
    const rightEdge = fromRows([
        '00000000',
        '21000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
        '00000000',
    ]);
    assertEqual(flipsFor(rightEdge, BLACK, 7, 0).length, 0, 'вправо с правого края — некуда');
});

test('занятая клетка и клетка без переворотов — нелегальны', () => {
    const state = createGame();
    const before = Array.from(state.board).join('');

    const occupied = applyMove(state, 3, 3);
    assert(!occupied.ok, 'ход в занятую клетку отклонён');

    const barren = applyMove(state, 0, 0);
    assert(!barren.ok, 'ход, ничего не переворачивающий, отклонён');

    assertEqual(Array.from(state.board).join(''), before, 'доска не изменилась');
    assertEqual(state.turn, BLACK, 'очередь не изменилась');
});

test('пас: у соперника нет ходов, очередь возвращается ходившему', () => {
    // Доска залита чёрными; белые — только (1,0) и (6,7), пустые — (0,0) и (7,7).
    // После хода чёрных в (0,0) у белых не остаётся ни одного хода, а у чёрных есть (7,7).
    const state = {
        board: filled(BLACK, { '0,0': EMPTY, '1,0': WHITE, '7,7': EMPTY, '6,7': WHITE }),
        turn: BLACK,
        human: BLACK,
        passed: false,
        over: false,
    };

    assert(!hasMoves(state.board, WHITE), 'белым ходить нечем и до хода');

    const res = applyMove(state, 0, 0);
    assert(res.ok, 'ход принят');
    assert(res.passed, 'зафиксирован пас соперника');
    assert(!res.over, 'партия не окончена');
    assertEqual(state.turn, BLACK, 'очередь осталась за чёрными');
    assertEqual(state.board[idx(1, 0)], BLACK, 'белая фишка перевёрнута');
});

test('конец партии: ходов нет ни у кого', () => {
    const state = {
        board: filled(BLACK, { '7,7': EMPTY, '6,7': WHITE }),
        turn: BLACK,
        human: BLACK,
        passed: false,
        over: false,
    };

    const res = applyMove(state, 7, 7);
    assert(res.ok, 'последний ход принят');
    assert(res.over, 'партия окончена');
    assert(!res.passed, 'конец партии — не пас');
    assert(isOver(state.board), 'на полной доске ходов нет');

    const counts = score(state.board);
    assertEqual(counts.empty, 0, 'пустых клеток не осталось');
    assertEqual(counts.black, 64, 'все фишки чёрные');
    assertEqual(winner(state.board), BLACK, 'победили чёрные');

    const after = applyMove(state, 3, 3);
    assert(!after.ok, 'после конца партии ходы не принимаются');
});

test('обоюдный пас на неполной доске тоже заканчивает партию', () => {
    // Одни чёрные и пустые клетки: переворачивать некого — ходов нет ни у кого,
    // хотя доска не заполнена.
    const board = filled(EMPTY, { '0,0': BLACK, '1,1': BLACK });
    assert(isOver(board), 'партия окончена без единого хода');
    assert(!hasMoves(board, BLACK) && !hasMoves(board, WHITE), 'ходов нет ни у одной стороны');
    assertEqual(winner(board), BLACK, 'победа по числу фишек');
});

test('ничья определяется по равному числу фишек', () => {
    const board = filled(EMPTY, { '0,0': BLACK, '7,7': WHITE });
    assertEqual(winner(board), EMPTY, 'равный счёт — ничья');
});

test('opponent и границы доски', () => {
    assertEqual(opponent(BLACK), WHITE, 'соперник чёрных');
    assertEqual(opponent(WHITE), BLACK, 'соперник белых');

    const board = createGame().board;
    assertEqual(flipsFor(board, BLACK, -1, 0).length, 0, 'за левым краем');
    assertEqual(flipsFor(board, BLACK, SIZE, 0).length, 0, 'за правым краем');
    assertEqual(flipsFor(board, BLACK, 0, -1).length, 0, 'выше доски');
    assertEqual(flipsFor(board, BLACK, 0, SIZE).length, 0, 'ниже доски');
});

test('сохранение партии переживает круговой рейс', () => {
    const state = createGame({ human: WHITE });
    applyMove(state, 3, 2);

    const restored = deserialize(serialize(state));
    assert(restored !== null, 'партия восстановлена');
    assertEqual(Array.from(restored.board).join(''), Array.from(state.board).join(''), 'доска та же');
    assertEqual(restored.turn, state.turn, 'очередь та же');
    assertEqual(restored.human, WHITE, 'цвет игрока сохранён');
    assertEqual(restored.over, false, 'партия продолжается');
});

test('битая сохранённая партия даёт null, а не исключение', () => {
    const valid = serialize(createGame());

    assertEqual(deserialize(null), null, 'null');
    assertEqual(deserialize(undefined), null, 'undefined');
    assertEqual(deserialize('строка'), null, 'не объект');
    assertEqual(deserialize({}), null, 'без доски');
    assertEqual(deserialize({ ...valid, board: '111' }), null, 'короткая доска');
    assertEqual(deserialize({ ...valid, board: valid.board.replace('0', '7') }), null, 'чужой символ');
    assertEqual(deserialize({ ...valid, turn: 5 }), null, 'неизвестная очередь');
    assertEqual(deserialize({ ...valid, human: null }), null, 'неизвестный цвет игрока');
});

test('очередь хода чинится по доске, а не по сохранённому значению', () => {
    // Файл настроек правят руками: ход может стоять за игроком, которому ходить нечем.
    const stuck = {
        board: Array.from(filled(BLACK, { '7,7': EMPTY, '6,7': WHITE })).join(''),
        turn: WHITE,
        human: WHITE,
    };
    const restored = deserialize(stuck);
    assert(restored !== null, 'партия восстановлена');
    assertEqual(restored.turn, BLACK, 'очередь передана тому, кто может ходить');
    assertEqual(restored.over, false, 'партия продолжается');

    const finished = { board: Array.from(filled(BLACK)).join(''), turn: BLACK, human: BLACK };
    const done = deserialize(finished);
    assert(done !== null, 'законченная партия восстановлена');
    assert(done.over, 'без ходов у обоих партия помечена оконченной');
});

report('reversi engine');
