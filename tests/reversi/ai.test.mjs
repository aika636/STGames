// Тесты соперника в реверси (Фаза 8.2). Чистое ядро, зависимостей нет.
// Запуск: node tests/reversi/ai.test.mjs
//
// Кроме поведения ИИ здесь же замер времени: сложный уровень обязан укладываться
// в бюджет на ход, иначе пауза «соперник думает» перестаёт быть паузой.

import {
    BLACK, EMPTY, SIZE, WHITE,
    applyMove, createGame, idx, isOver, legalMoves, opponent, score, winner,
} from '../../src/games/reversi/core/engine.js';
import {
    LEVEL_DEPTH, chooseMove, depthForLevel, evaluate, mulberry32, weightAt,
} from '../../src/games/reversi/core/ai.js';
import { assert, assertEqual, report, test } from '../_harness.mjs';

console.log('reversi ai');

const TIME_BUDGET_MS = 100;

function fromRows(rows) {
    assertEqual(rows.length, SIZE, 'строк в тестовой доске');
    const board = new Int8Array(SIZE * SIZE);
    rows.forEach((row, y) => {
        assertEqual(row.length, SIZE, `длина строки ${y}`);
        for (let x = 0; x < SIZE; x++) board[idx(x, y)] = row.charCodeAt(x) - 48;
    });
    return board;
}

function movesAsSet(board, player) {
    return new Set(legalMoves(board, player).map((m) => `${m.x},${m.y}`));
}

// --- Веса и оценка

test('веса: углы дороги, X- и C-клетки в минусе', () => {
    for (const [x, y] of [[0, 0], [7, 0], [0, 7], [7, 7]]) {
        assert(weightAt(x, y) > 100, `угол ${x},${y} дорог`);
    }
    for (const [x, y] of [[1, 1], [6, 1], [1, 6], [6, 6]]) {
        assert(weightAt(x, y) < 0, `X-клетка ${x},${y} в минусе`);
    }
    for (const [x, y] of [[1, 0], [0, 1], [6, 7], [7, 6]]) {
        assert(weightAt(x, y) < 0, `C-клетка ${x},${y} в минусе`);
    }
});

test('оценка симметрична: позиция глазами соперника — с обратным знаком', () => {
    const board = createGame().board;
    applyMoveAt(board, BLACK, 3, 2);
    assert(Math.abs(evaluate(board, BLACK) + evaluate(board, WHITE)) < 1e-9, 'оценки противоположны');
});

test('в дебюте больше фишек ≠ лучше', () => {
    // Ход в (3,2) переворачивает одну фишку, ход в (2,3) — тоже одну, но нас интересует
    // другое: стартовая позиция симметрична, и оценка после любого первого хода не должна
    // сводиться к «у меня фишек больше».
    const greedy = createGame().board;
    applyMoveAt(greedy, BLACK, 3, 2);
    const counts = score(greedy);
    assertEqual(counts.black - counts.white, 3, 'фишек у чёрных больше на три');
    assert(evaluate(greedy, BLACK) < 100, 'перевес в фишках сам по себе оценку не задирает');
});

// --- Выбор хода

test('ходить нечем — null, а не исключение', () => {
    // Только чёрные фишки: переворачивать белым некого.
    const board = new Int8Array(SIZE * SIZE);
    board[idx(0, 0)] = BLACK;
    assertEqual(chooseMove(board, WHITE, { depth: 3 }), null, 'ходов нет');
});

test('без rng ход детерминирован на любой глубине', () => {
    const board = createGame().board;
    for (const depth of [1, 3, 5]) {
        const first = chooseMove(board, BLACK, { depth });
        const second = chooseMove(board, BLACK, { depth });
        assertEqual(`${first.x},${first.y}`, `${second.x},${second.y}`, `глубина ${depth}: тот же ход`);
    }
});

test('ИИ забирает свободный угол', () => {
    const board = fromRows([
        '02100000',
        '00000000',
        '00000000',
        '00021000',
        '00012000',
        '00000000',
        '00000000',
        '00000000',
    ]);

    const moves = movesAsSet(board, BLACK);
    assert(moves.has('0,0'), 'угол доступен');
    assert(moves.size > 1, 'угол — не единственный ход');

    for (const depth of [1, 3, 5]) {
        const move = chooseMove(board, BLACK, { depth });
        assertEqual(`${move.x},${move.y}`, '0,0', `глубина ${depth}: взят угол`);
    }
});

test('ИИ не лезет в X-клетку, когда есть альтернатива', () => {
    const board = fromRows([
        '00000000',
        '00000000',
        '00200000',
        '00010000',
        '00000200',
        '00000010',
        '00000000',
        '00000000',
    ]);

    const moves = movesAsSet(board, BLACK);
    assert(moves.has('1,1'), 'X-клетка рядом с углом легальна');
    assert(moves.size > 1, 'есть и другие ходы');

    for (const depth of [1, 3, 5]) {
        const move = chooseMove(board, BLACK, { depth });
        assert(`${move.x},${move.y}` !== '1,1', `глубина ${depth}: X-клетка не выбрана`);
    }
});

test('концовка досчитывается точно: ход совпадает с перебором до конца', () => {
    // Восемь пустых клеток — меньше порога точного досчёта. Ответ проверяем независимым
    // полным перебором по функциям движка: он медленный, но здесь дешёвый и заведомо
    // не повторяет оптимизаций ai.js.
    const board = fromRows([
        '11111100',
        '11111120',
        '11111220',
        '11122220',
        '11222220',
        '12222220',
        '22222222',
        '22222220',
    ]);

    const empties = score(board).empty;
    assertEqual(empties, 8, 'пустых клеток в позиции');

    const best = perfectMoves(board, BLACK);
    assert(best.moves.length > 0, 'ходы у чёрных есть');
    assert(legalMoves(board, BLACK).length > best.moves.length, 'не все ходы одинаково хороши');

    // Глубина заказана лёгкая — досчёт концовки обязан её перебить.
    const move = chooseMove(board, BLACK, { depth: LEVEL_DEPTH.easy });
    assert(
        best.moves.includes(`${move.x},${move.y}`),
        `ход ${move.x},${move.y} оптимален (перебор: ${best.moves.join(' ')}, разрыв ${best.value})`,
    );
});

// --- Лёгкий уровень

test('лёгкий уровень с rng не повторяет одну и ту же партию', () => {
    const board = createGame().board;
    const picks = new Set();
    for (let seed = 0; seed < 40; seed++) {
        const move = chooseMove(board, BLACK, { depth: LEVEL_DEPTH.easy, rng: mulberry32(seed) });
        picks.add(`${move.x},${move.y}`);
    }
    assert(picks.size > 1, `из стартовой позиции выбирался не один ход: ${[...picks].join(' ')}`);
});

test('rng у лёгкого уровня не делает ходы случайными: угол берётся всё равно', () => {
    const board = fromRows([
        '02100000',
        '00000000',
        '00000000',
        '00021000',
        '00012000',
        '00000000',
        '00000000',
        '00000000',
    ]);

    for (let seed = 0; seed < 20; seed++) {
        const move = chooseMove(board, BLACK, { depth: LEVEL_DEPTH.easy, rng: mulberry32(seed) });
        assertEqual(`${move.x},${move.y}`, '0,0', `seed ${seed}: взят угол`);
    }
});

test('уровни отображаются в глубину, неизвестный — в средний', () => {
    assertEqual(depthForLevel('easy'), 1, 'лёгкий');
    assertEqual(depthForLevel('medium'), 3, 'средний');
    assertEqual(depthForLevel('hard'), 5, 'сложный');
    assertEqual(depthForLevel('нечто'), LEVEL_DEPTH.medium, 'неизвестный уровень — средний');
});

// --- Партия целиком: сила и время

test('сложный уровень обыгрывает лёгкий обоими цветами', () => {
    const results = [];
    for (const hardColor of [BLACK, WHITE]) {
        const game = playOut(hardColor);
        results.push(game);
        console.log(
            `      сложный ${hardColor === BLACK ? 'чёрными' : 'белыми'}: ` +
            `${game.discs.hard}:${game.discs.easy}, ходов ${game.moves}, ` +
            `ср. ${game.avg.toFixed(1)} мс, макс ${game.max.toFixed(1)} мс`,
        );
    }

    for (const game of results) {
        assert(game.won, `сложный выиграл (${game.discs.hard}:${game.discs.easy})`);
        assert(
            game.max < TIME_BUDGET_MS,
            `макс. время хода ${game.max.toFixed(1)} мс не превышает ${TIME_BUDGET_MS} мс`,
        );
    }
});

// --- Вспомогательное

function applyMoveAt(board, player, x, y) {
    const state = { board, turn: player, human: player, passed: false, over: false };
    const res = applyMove(state, x, y);
    assert(res.ok, `ход ${x},${y} легален`);
}

// Партия «сложный против лёгкого» до конца. Лёгкий играет без rng — партия должна быть
// воспроизводимой, иначе тест начнёт мигать.
function playOut(hardColor) {
    const state = createGame({ human: opponent(hardColor) });
    const times = [];
    let moves = 0;

    while (!state.over && moves < 100) {
        const depth = state.turn === hardColor ? LEVEL_DEPTH.hard : LEVEL_DEPTH.easy;
        const started = performance.now();
        const move = chooseMove(state.board, state.turn, { depth });
        const elapsed = performance.now() - started;
        if (state.turn === hardColor) times.push(elapsed);

        assert(move !== null, 'у игрока, чья очередь, ход есть');
        const res = applyMove(state, move.x, move.y);
        assert(res.ok, `ход ИИ ${move.x},${move.y} легален`);
        moves++;
    }

    assert(state.over && isOver(state.board), 'партия доиграна до конца');

    const counts = score(state.board);
    const hard = hardColor === BLACK ? counts.black : counts.white;
    const easy = hardColor === BLACK ? counts.white : counts.black;

    return {
        won: winner(state.board) === hardColor,
        discs: { hard, easy },
        moves,
        avg: times.reduce((a, b) => a + b, 0) / times.length,
        max: Math.max(...times),
    };
}

// Независимый оракул для концовки: полный перебор без отсечений и без оценки позиции —
// только итоговый разрыв в фишках. Возвращает лучший разрыв и все ходы, которые его дают.
function perfectMoves(board, player) {
    const moves = legalMoves(board, player);
    let value = -Infinity;
    const best = [];

    for (const move of moves) {
        const next = board.slice();
        next[move.idx] = player;
        for (const cell of move.flips) next[cell] = player;

        const outcome = -perfectValue(next, opponent(player));
        if (outcome > value) {
            value = outcome;
            best.length = 0;
        }
        if (outcome === value) best.push(`${move.x},${move.y}`);
    }

    return { value, moves: best };
}

function perfectValue(board, player) {
    const moves = legalMoves(board, player);

    if (!moves.length) {
        if (!legalMoves(board, opponent(player)).length) {
            let diff = 0;
            for (let i = 0; i < board.length; i++) {
                if (board[i] === player) diff++;
                else if (board[i] !== EMPTY) diff--;
            }
            return diff;
        }
        return -perfectValue(board, opponent(player));
    }

    let value = -Infinity;
    for (const move of moves) {
        const next = board.slice();
        next[move.idx] = player;
        for (const cell of move.flips) next[cell] = player;
        value = Math.max(value, -perfectValue(next, opponent(player)));
    }
    return value;
}

report('reversi ai');
