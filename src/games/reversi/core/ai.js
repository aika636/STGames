// Соперник в реверси: негамакс с альфа-бета-отсечением. Как и engine.js — чистая логика,
// ни DOM, ни таймеров: паузу «соперник думает» ставит UI, расчёт здесь синхронный.
//
// Модуль намеренно не переиспользует legalMoves()/applyMove() из engine.js внутри перебора:
// те возвращают списки перевёрнутых клеток, а перебору нужны десятки тысяч узлов, и на
// каждом узле аллокация массива на ход — это и есть разница между 30 мс и секундой.
// Правила при этом одни и те же, поэтому здесь они продублированы ровно в двух местах
// (canPlay/playFast) и покрыты собственными тестами.

import { BLACK, EMPTY, SIZE, WHITE, idx, opponent } from './engine.js';

// mulberry32 скопирован из src/games/sudoku/core/rng.js (то же решение, что в змейке):
// кросс-игровая зависимость между core-модулями мешала бы добавлять игру одной папкой.
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Уровень — это только глубина перебора: одна ручка вместо трёх разных ИИ.
export const LEVEL_DEPTH = Object.freeze({ easy: 1, medium: 3, hard: 5 });
export const LEVELS = Object.freeze(Object.keys(LEVEL_DEPTH));

export function depthForLevel(level) {
    return LEVEL_DEPTH[level] ?? LEVEL_DEPTH.medium;
}

// Позиционные веса. Углы забрать нельзя обратно — они дороги; X-клетки (по диагонали от
// угла) и C-клетки (рядом с углом по краю) отдают угол сопернику и потому в минусе.
const WEIGHTS = Int16Array.from([
    120, -20, 20, 5, 5, 20, -20, 120,
    -20, -40, -5, -5, -5, -5, -40, -20,
    20, -5, 15, 3, 3, 15, -5, 20,
    5, -5, 3, 3, 3, 3, -5, 5,
    5, -5, 3, 3, 3, 3, -5, 5,
    20, -5, 15, 3, 3, 15, -5, 20,
    -20, -40, -5, -5, -5, -5, -40, -20,
    120, -20, 20, 5, 5, 20, -20, 120,
]);

const DIRECTIONS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
];

// Пустых клеток, начиная с которых считаем партию точно до конца: перебор там уже дешёвый
// (ветвление падает вместе с числом пустых), а концовку ИИ доигрывает безошибочно.
const EXACT_ENDGAME = 10;

// Победа весит больше любой позиционной оценки, но не бесконечность: к ней прибавляется
// разрыв в фишках, чтобы из двух выигранных партий выбиралась выигранная крупнее.
const WIN = 1000000;

// Разброс оценки, внутри которого лёгкий уровень выбирает ход случайно.
const EASY_SLACK = 15;

const START_EMPTY = SIZE * SIZE - 4;

// Легален ли ход, без аллокаций: перебору важно только «да/нет», а списки перевёрнутых
// клеток нужны одному лишь UI.
function canPlay(board, player, x, y) {
    if (board[y * SIZE + x] !== EMPTY) return false;
    const foe = opponent(player);

    for (let d = 0; d < DIRECTIONS.length; d++) {
        const dx = DIRECTIONS[d][0];
        const dy = DIRECTIONS[d][1];
        let cx = x + dx;
        let cy = y + dy;
        let seen = 0;

        while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy * SIZE + cx] === foe) {
            seen++;
            cx += dx;
            cy += dy;
        }

        if (seen && cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy * SIZE + cx] === player) {
            return true;
        }
    }

    return false;
}

// Ход прямо на доске: копия позиции делается один раз на узел, а переворот пишется в неё
// на месте — промежуточный массив flips перебору не нужен.
function playFast(board, player, x, y) {
    const foe = opponent(player);
    board[y * SIZE + x] = player;

    for (let d = 0; d < DIRECTIONS.length; d++) {
        const dx = DIRECTIONS[d][0];
        const dy = DIRECTIONS[d][1];
        let cx = x + dx;
        let cy = y + dy;

        while (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy * SIZE + cx] === foe) {
            cx += dx;
            cy += dy;
        }

        if (cx >= 0 && cx < SIZE && cy >= 0 && cy < SIZE && board[cy * SIZE + cx] === player) {
            let bx = x + dx;
            let by = y + dy;
            while (bx !== cx || by !== cy) {
                board[by * SIZE + bx] = player;
                bx += dx;
                by += dy;
            }
        }
    }
}

// Ходы одним плоским списком индексов, сразу отсортированные по позиционному весу:
// без упорядочивания альфа-бета почти не отсекает и глубина 5 не укладывается в бюджет.
function genMoves(board, player) {
    const moves = [];
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (canPlay(board, player, x, y)) moves.push(y * SIZE + x);
        }
    }
    moves.sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
    return moves;
}

function countMoves(board, player) {
    let count = 0;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (canPlay(board, player, x, y)) count++;
        }
    }
    return count;
}

// Счёт законченной партии глазами игрока, чья очередь: считаются только фишки, позиция
// больше не важна.
function terminalValue(board, player) {
    let mine = 0;
    let theirs = 0;
    for (let i = 0; i < board.length; i++) {
        if (board[i] === player) mine++;
        else if (board[i] !== EMPTY) theirs++;
    }
    const diff = mine - theirs;
    if (diff > 0) return WIN + diff;
    if (diff < 0) return -WIN + diff;
    return 0;
}

// Оценка позиции глазами player. Три слагаемых с разным весом по ходу партии:
// позиция (углы и подходы к ним), подвижность и разница фишек. Вес разницы фишек растёт
// к концовке: в дебюте «больше фишек» — скорее вред (меньше свободы и больше уязвимых
// краёв), и без этого «сложный» уровень играл бы жаднее и глупее «лёгкого».
export function evaluate(board, player) {
    const foe = opponent(player);
    let mine = 0;
    let theirs = 0;
    let empty = 0;
    let positional = 0;

    for (let i = 0; i < board.length; i++) {
        const cell = board[i];
        if (cell === EMPTY) {
            empty++;
        } else if (cell === player) {
            mine++;
            positional += WEIGHTS[i];
        } else {
            theirs++;
            positional -= WEIGHTS[i];
        }
    }

    // 0 в стартовой позиции, 1 на заполненной доске.
    const late = (START_EMPTY - empty) / START_EMPTY;

    const myMob = countMoves(board, player);
    const foeMob = countMoves(board, foe);
    const mobility = myMob + foeMob ? (100 * (myMob - foeMob)) / (myMob + foeMob) : 0;
    const discs = mine + theirs ? (100 * (mine - theirs)) / (mine + theirs) : 0;

    // Подвижность решает в дебюте и середине, разница фишек — в концовке (квадрат, чтобы
    // она не мешала раньше времени).
    return positional + mobility * (3 * (1 - late) + 0.5) + discs * (1 + 24 * late * late);
}

function negamax(board, player, depth, alpha, beta) {
    const moves = genMoves(board, player);

    if (!moves.length) {
        // Пас: ход переходит сопернику, но если и ему ходить нечем — партия окончена.
        // Глубина всё равно уменьшается: иначе два паса подряд зациклили бы перебор.
        if (!countMoves(board, opponent(player))) return terminalValue(board, player);
        if (depth <= 0) return evaluate(board, player);
        return -negamax(board, opponent(player), depth - 1, -beta, -alpha);
    }

    if (depth <= 0) return evaluate(board, player);

    let best = -Infinity;
    for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        const next = board.slice();
        playFast(next, player, move % SIZE, (move / SIZE) | 0);

        const value = -negamax(next, opponent(player), depth - 1, -beta, -alpha);
        if (value > best) best = value;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
    }

    return best;
}

// Ход соперника. Возвращает { x, y } или null, если ходить нечем (пас — забота движка).
// rng задействуется только на глубине 1 (лёгкий уровень): без него лёгкий соперник
// повторяет из партии в партию одну и ту же игру. Без rng выбор детерминирован.
export function chooseMove(board, player, { depth = LEVEL_DEPTH.medium, rng = null } = {}) {
    const moves = genMoves(board, player);
    if (!moves.length) return null;

    let empty = 0;
    for (let i = 0; i < board.length; i++) if (board[i] === EMPTY) empty++;

    // Концовка досчитывается точно: глубина поднимается до числа пустых клеток, если
    // заказанная меньше.
    const searchDepth = empty <= EXACT_ENDGAME ? Math.max(depth, empty) : depth;

    // Лёгкому уровню оценки нужны точные — он выбирает из нескольких ходов около лучшего,
    // а суженное окно возвращает у отсечённых ходов границу, а не оценку. Глубина 1 стоит
    // копейки, так что полное окно там ничего не стоит; на остальных уровнях окно режется
    // по текущему лучшему, и это главный источник отсечений в корне.
    const exactValues = Boolean(rng) && searchDepth <= 1;

    let best = -Infinity;
    const values = new Array(moves.length);

    for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        const next = board.slice();
        playFast(next, player, move % SIZE, (move / SIZE) | 0);

        const alpha = exactValues ? -Infinity : best;
        const value = -negamax(next, opponent(player), searchDepth - 1, -Infinity, -alpha);
        values[i] = value;
        if (value > best) best = value;
    }

    let chosen = moves[values.indexOf(best)];

    if (rng && searchDepth <= 1) {
        const good = moves.filter((_, i) => values[i] >= best - EASY_SLACK);
        chosen = good[Math.min(good.length - 1, Math.floor(rng() * good.length))];
    }

    return { x: chosen % SIZE, y: (chosen / SIZE) | 0 };
}

// Экспортируется для тестов и для возможной отладки оценки: смотреть на веса клетки
// удобнее по координатам, чем по индексу.
export function weightAt(x, y) {
    return WEIGHTS[idx(x, y)];
}

export { BLACK, WHITE };
