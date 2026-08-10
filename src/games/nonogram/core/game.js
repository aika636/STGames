// Партия нонограммы: картинка, подсказки и то, что игрок отметил на поле. Чистый модуль
// без DOM и без SillyTavern.
//
// Метка клетки — одно из трёх: пусто, закрашено, крестик. Крестик — рабочая пометка
// игрока «здесь точно ничего нет»; на победу он не влияет никак, поэтому и проверять
// его не с чем: сравнивается только множество закрашенных клеток с картинкой.
//
// Ошибки игроку не подсвечиваются автоматически: нонограмма решается рассуждением, и
// «неверная клетка» подсказала бы вывод, который игрок ещё не сделал. Проверка есть, но
// вызывается она из настройки — так же, как подсветка ошибок в судоку.

import { cluesFromGrid, lineClues } from './solver.js';

export const EMPTY = 0;
export const FILLED = 1;
export const CROSS = 2;

export function createGame({ cols, rows, grid, rowClues, colClues }) {
    return {
        cols,
        rows,
        solution: Uint8Array.from(grid),
        rowClues,
        colClues,
        marks: new Uint8Array(cols * rows),
        elapsed: 0,
        over: false,
        won: false,
    };
}

export function setMark(state, index, mark) {
    if (state.over) return false;
    if (index < 0 || index >= state.marks.length) return false;
    if (state.marks[index] === mark) return false;
    state.marks[index] = mark;
    return true;
}

// Победа — когда закрашено ровно то, что нарисовано. Крестики и пустые клетки
// равноправны: игрок не обязан отмечать пустоту, чтобы закончить картинку.
export function isSolved(state) {
    for (let i = 0; i < state.marks.length; i++) {
        const filled = state.marks[i] === FILLED ? 1 : 0;
        if (filled !== state.solution[i]) return false;
    }
    return true;
}

export function checkWin(state) {
    if (state.over) return state.won;
    if (!isSolved(state)) return false;
    state.over = true;
    state.won = true;
    return true;
}

// Клетки, закрашенные не там, где надо. Для подсветки ошибок по настройке; в остальное
// время не зовётся.
export function wrongMarks(state) {
    const wrong = [];
    for (let i = 0; i < state.marks.length; i++) {
        if (state.marks[i] === FILLED && !state.solution[i]) wrong.push(i);
    }
    return wrong;
}

// Подсказки строки/столбца считаются выполненными, когда закрашенное игроком даёт ровно
// ту же последовательность блоков. Это не проверка правильности (совпасть может и
// сдвинутая линия), а гашение уже отработавших подсказок: приём из классических
// нонограмм, без него взгляд каждый раз перечитывает всю колонку чисел.
export function rowDone(state, y) {
    const line = [];
    for (let x = 0; x < state.cols; x++) line.push(state.marks[y * state.cols + x] === FILLED ? 1 : 2);
    return sameClues(lineClues(line), state.rowClues[y]);
}

export function colDone(state, x) {
    const line = [];
    for (let y = 0; y < state.rows; y++) line.push(state.marks[y * state.cols + x] === FILLED ? 1 : 2);
    return sameClues(lineClues(line), state.colClues[x]);
}

function sameClues(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// Сколько клеток осталось закрасить: подпись под полем. Отрицательным не бывает —
// лишние закрашенные клетки считаются как «осталось столько же».
export function remaining(state) {
    let need = 0;
    let done = 0;
    for (let i = 0; i < state.marks.length; i++) {
        need += state.solution[i];
        if (state.solution[i] && state.marks[i] === FILLED) done++;
    }
    return need - done;
}

// --- Сохранение партии
//
// Картинка хранится строкой из '0'/'1', метки — строкой из '0'/'1'/'2'. Подсказки не
// сохраняются: они однозначно выводятся из картинки, а дублирующее поле разъехалось бы
// с ней после ручной правки settings.json.

export function serialize(state) {
    return {
        cols: state.cols,
        rows: state.rows,
        solution: Array.from(state.solution).join(''),
        marks: Array.from(state.marks).join(''),
        elapsed: Math.max(0, Math.round(state.elapsed)),
        over: state.over,
        won: state.won,
    };
}

export function deserialize(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const cols = Number(raw.cols);
    const rows = Number(raw.rows);
    if (!isSize(cols) || !isSize(rows)) return null;
    const size = cols * rows;

    if (typeof raw.solution !== 'string' || raw.solution.length !== size) return null;
    if (typeof raw.marks !== 'string' || raw.marks.length !== size) return null;

    const solution = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        const ch = raw.solution[i];
        if (ch !== '0' && ch !== '1') return null;
        solution[i] = ch === '1' ? 1 : 0;
    }

    const marks = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        const ch = raw.marks[i];
        if (ch !== '0' && ch !== '1' && ch !== '2') return null;
        marks[i] = Number(ch);
    }

    const { rowClues, colClues } = cluesFromGrid(solution, cols, rows);
    const state = createGame({ cols, rows, grid: solution, rowClues, colClues });
    state.marks = marks;
    state.elapsed = Number.isFinite(raw.elapsed) && raw.elapsed > 0 ? Math.floor(raw.elapsed) : 0;
    state.over = Boolean(raw.over);
    state.won = state.over && Boolean(raw.won);
    // Состояние из файла могло оказаться уже собранным — досчитываем честно, чтобы экран
    // не показывал «партия идёт» на готовой картинке.
    if (!state.over) checkWin(state);
    return state;
}

function isSize(value) {
    return Number.isInteger(value) && value >= 2 && value <= 30;
}
