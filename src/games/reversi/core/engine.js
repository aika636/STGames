// Правила реверси: чистая логика над состоянием — ни DOM, ни таймеров, ни SillyTavern.
// Модуль детерминирован: случайности в правилах нет вовсе (она появится только в ai.js,
// у лёгкого уровня). Состояние мутируется на месте — так же, как в движке змейки, чтобы
// ядра игр не расходились в стиле.

export const SIZE = 8;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

// Доска — Int8Array(64), индекс y * SIZE + x. Плоский типизированный массив, а не
// массив массивов: ai.js будет копировать позицию на каждом узле перебора, и slice()
// по 64 байтам заметно дешевле вложенных структур.
export function idx(x, y) {
    return y * SIZE + x;
}

export function opponent(player) {
    return player === BLACK ? WHITE : BLACK;
}

// Восемь направлений. Ход по dx/dy в координатах, а не по смещению индекса: смещение
// на ±1 переползает через край доски на соседнюю строку, и переворот «заворачивался» бы
// с правого края на левый.
const DIRECTIONS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
];

export function createBoard() {
    const board = new Int8Array(SIZE * SIZE);
    board[idx(3, 3)] = WHITE;
    board[idx(4, 4)] = WHITE;
    board[idx(3, 4)] = BLACK;
    board[idx(4, 3)] = BLACK;
    return board;
}

// human — цвет игрока; чёрные ходят первыми по правилам, поэтому игра белыми означает
// лишь, что первый ход делает соперник. Счёт в состоянии не хранится: он однозначно
// выводится из доски (score()), а продублированное поле разъезжается с реальностью.
export function createGame({ human = BLACK } = {}) {
    return {
        board: createBoard(),
        turn: BLACK,
        human,
        passed: false,
        over: false,
    };
}

// Переворачиваемые фишки для хода player в клетку (x, y). Пустой массив — ход нелегален:
// в реверси ход обязан перевернуть хотя бы одну фишку.
export function flipsFor(board, player, x, y) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return [];
    if (board[idx(x, y)] !== EMPTY) return [];

    const foe = opponent(player);
    const flips = [];

    for (const [dx, dy] of DIRECTIONS) {
        let cx = x + dx;
        let cy = y + dy;
        const line = [];

        while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[idx(cx, cy)] === foe) {
            line.push(idx(cx, cy));
            cx += dx;
            cy += dy;
        }

        // Цепочка чужих фишек считается только если она замкнута своей фишкой, и только
        // если она непустая: соседняя своя фишка сама по себе ничего не переворачивает.
        if (line.length && cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[idx(cx, cy)] === player) {
            flips.push(...line);
        }
    }

    return flips;
}

// Все ходы игрока вместе с их переворотами: UI подсвечивает ходы тем же списком, которым
// потом делает ход, и правила не пересчитываются второй раз.
export function legalMoves(board, player) {
    const moves = [];
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const flips = flipsFor(board, player, x, y);
            if (flips.length) moves.push({ x, y, idx: idx(x, y), flips });
        }
    }
    return moves;
}

// Ранний выход на первом же найденном ходе: пас и конец партии проверяются после каждого
// хода, а перебору в ai.js это ещё и на каждом узле.
export function hasMoves(board, player) {
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (flipsFor(board, player, x, y).length) return true;
        }
    }
    return false;
}

// Кладёт фишку и переворачивает захваченные — только доска, без очереди хода и без
// состояния партии. Общая точка для applyMove() и для перебора в ai.js.
export function applyToBoard(board, player, move) {
    board[move.idx ?? idx(move.x, move.y)] = player;
    for (const cell of move.flips) board[cell] = player;
    return board;
}

export function score(board) {
    let black = 0;
    let white = 0;
    let empty = 0;
    for (let i = 0; i < board.length; i++) {
        if (board[i] === BLACK) black++;
        else if (board[i] === WHITE) white++;
        else empty++;
    }
    return { black, white, empty };
}

export function isOver(board) {
    return !hasMoves(board, BLACK) && !hasMoves(board, WHITE);
}

// BLACK / WHITE / EMPTY, где EMPTY означает ничью.
export function winner(board) {
    const { black, white } = score(board);
    if (black > white) return BLACK;
    if (white > black) return WHITE;
    return EMPTY;
}

// Ход игрока, чья очередь. Возвращает { ok, flips, passed, over }:
//   ok     — ход был легален (иначе состояние не тронуто);
//   flips  — перевёрнутые клетки, для анимации;
//   passed — у соперника не оказалось ходов и очередь вернулась к ходившему;
//   over   — ходов нет ни у кого, партия окончена.
// Пас в реверси автоматический: игрок не «пропускает ход» решением, он просто не может
// ходить. Поэтому очередь двигает движок, а UI только сообщает об этом игроку — иначе
// ход «сам собой» возвращается назад и выглядит как баг.
export function applyMove(state, x, y) {
    if (state.over) return { ok: false, flips: [], passed: false, over: true };

    const flips = flipsFor(state.board, state.turn, x, y);
    if (!flips.length) return { ok: false, flips: [], passed: false, over: false };

    applyToBoard(state.board, state.turn, { x, y, idx: idx(x, y), flips });

    const foe = opponent(state.turn);
    if (hasMoves(state.board, foe)) {
        state.turn = foe;
        state.passed = false;
    } else if (hasMoves(state.board, state.turn)) {
        state.passed = true;
    } else {
        state.passed = false;
        state.over = true;
    }

    return { ok: true, flips, passed: state.passed, over: state.over };
}

// --- Сохранение партии
//
// Доска — строкой из 64 символов: в settings.json она читаема глазами и не раздувается
// массивом из 64 чисел.

export function serialize(state) {
    return {
        board: Array.from(state.board).join(''),
        turn: state.turn,
        human: state.human,
    };
}

// Возвращает null на любом мусоре, а не бросает: settings.json правят руками, и битая
// сохранённая партия должна означать «начать новую», а не падение экрана.
export function deserialize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.board !== 'string' || raw.board.length !== SIZE * SIZE) return null;
    if (raw.turn !== BLACK && raw.turn !== WHITE) return null;
    if (raw.human !== BLACK && raw.human !== WHITE) return null;

    const board = new Int8Array(SIZE * SIZE);
    for (let i = 0; i < board.length; i++) {
        const cell = raw.board.charCodeAt(i) - 48;
        if (cell !== EMPTY && cell !== BLACK && cell !== WHITE) return null;
        board[i] = cell;
    }

    const state = { board, turn: raw.turn, human: raw.human, passed: false, over: false };

    // Очередь хода чиним по доске, а не доверяем сохранённой: после ручной правки файла
    // ход может стоять за игроком, у которого ходов нет, и экран встал бы намертво.
    if (!hasMoves(board, state.turn)) {
        if (hasMoves(board, opponent(state.turn))) {
            state.turn = opponent(state.turn);
        } else {
            state.over = true;
        }
    }

    return state;
}
