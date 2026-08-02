// Модель партии: что игрок видит и меняет на доске. Чистый модуль без DOM.
//
// Состояние держится в трёх параллельных массивах по 81 элементу:
//   puzzle — исходные подсказки (0 = пусто), никогда не меняется;
//   values — то, что стоит на доске сейчас (подсказки включены);
//   notes  — 9-битные маски пометок-кандидатов, у заполненных клеток 0.
// Всё это простые массивы чисел: их можно положить в extensionSettings как есть.
//
// Каждое изменение пишется в историю целиком (какие клетки были до и после), поэтому
// undo/redo не зависят от типа операции: и «поставил цифру», и «стёр», и «авточистка
// пометок у соседей» откатываются одной и той же функцией.

import { CELLS, PEERS, bitOf, findConflicts, isSolved } from './grid.js';

export const STATE_VERSION = 1;

export function createGame({ puzzle, solution, difficulty = 'medium', level = difficulty }) {
    if (!Array.isArray(puzzle) || puzzle.length !== CELLS) {
        throw new Error('createGame: puzzle должен быть массивом из 81 клетки');
    }
    if (!Array.isArray(solution) || solution.length !== CELLS) {
        throw new Error('createGame: solution должен быть массивом из 81 клетки');
    }
    return {
        version: STATE_VERSION,
        puzzle: puzzle.slice(),
        solution: solution.slice(),
        values: puzzle.slice(),
        notes: new Array(CELLS).fill(0),
        difficulty,
        level,
        history: [],
        future: [],
        // Время партии: elapsedMs накапливается, startedAt — момент последнего запуска
        // таймера (null, когда таймер стоит: партия на паузе или уже решена).
        elapsedMs: 0,
        startedAt: null,
        completedAt: null,
    };
}

export function isGiven(state, idx) {
    return state.puzzle[idx] !== 0;
}

// --- История

function snapshot(state, indices) {
    return indices.map((idx) => ({ idx, value: state.values[idx], notes: state.notes[idx] }));
}

function applyCells(state, cells) {
    for (const cell of cells) {
        state.values[cell.idx] = cell.value;
        state.notes[cell.idx] = cell.notes;
    }
}

// Записывает в историю переход «было → стало» по перечисленным клеткам.
function commit(state, indices, mutate) {
    const before = snapshot(state, indices);
    mutate();
    const after = snapshot(state, indices);

    const changed = after.some((cell, i) => cell.value !== before[i].value || cell.notes !== before[i].notes);
    if (!changed) return false;

    state.history.push({ before, after });
    state.future.length = 0; // новая ветка действий обесценивает redo
    return true;
}

export function canUndo(state) {
    return state.history.length > 0;
}

export function canRedo(state) {
    return state.future.length > 0;
}

export function undo(state) {
    const entry = state.history.pop();
    if (!entry) return false;
    applyCells(state, entry.before);
    state.future.push(entry);
    return true;
}

export function redo(state) {
    const entry = state.future.pop();
    if (!entry) return false;
    applyCells(state, entry.after);
    state.history.push(entry);
    return true;
}

// --- Ходы. Все возвращают true, если состояние изменилось.

// Ставит цифру в клетку. Повторный ввод той же цифры стирает её — так работает
// большинство реализаций судоку, и это избавляет от отдельной кнопки «стереть».
// autoCleanNotes убирает поставленную цифру из пометок соседей.
export function setValue(state, idx, digit, { autoCleanNotes = true } = {}) {
    if (isGiven(state, idx)) return false;
    if (digit < 0 || digit > 9) return false;

    const next = state.values[idx] === digit ? 0 : digit;
    const touched = [idx];
    if (autoCleanNotes && next) {
        for (const peer of PEERS[idx]) {
            if (state.notes[peer] & bitOf(next)) touched.push(peer);
        }
    }

    return commit(state, touched, () => {
        state.values[idx] = next;
        state.notes[idx] = 0;
        if (autoCleanNotes && next) {
            const bit = bitOf(next);
            for (const peer of PEERS[idx]) state.notes[peer] &= ~bit;
        }
    });
}

export function clearCell(state, idx) {
    if (isGiven(state, idx)) return false;
    return commit(state, [idx], () => {
        state.values[idx] = 0;
        state.notes[idx] = 0;
    });
}

// Пометка-кандидат. В заполненной клетке пометок нет — сначала нужно её очистить.
export function toggleNote(state, idx, digit) {
    if (isGiven(state, idx) || state.values[idx]) return false;
    if (digit < 1 || digit > 9) return false;
    return commit(state, [idx], () => {
        state.notes[idx] ^= bitOf(digit);
    });
}

export function hasNote(state, idx, digit) {
    return (state.notes[idx] & bitOf(digit)) !== 0;
}

// --- Состояние доски

export function getConflicts(state) {
    return findConflicts(state.values);
}

// Клетки, где стоит цифра, не совпадающая с решением. Нужно для будущей кнопки
// «проверить»; подсветка конфликтов работает не через это, а через getConflicts —
// решение игроку раньше времени не показывается.
export function getMistakes(state) {
    const mistakes = new Set();
    for (let idx = 0; idx < CELLS; idx++) {
        if (state.values[idx] && state.values[idx] !== state.solution[idx]) mistakes.add(idx);
    }
    return mistakes;
}

export function isWon(state) {
    return isSolved(state.values);
}

// Сколько каждой цифры ещё не выставлено: { 1: 4, 2: 0, ... }. Для счётчика под доской.
export function remainingCounts(state) {
    const counts = {};
    for (let digit = 1; digit <= 9; digit++) counts[digit] = 9;
    for (const value of state.values) {
        if (value) counts[value]--;
    }
    return counts;
}

export function countFilled(state) {
    let filled = 0;
    for (const value of state.values) if (value) filled++;
    return filled;
}

// --- Таймер. Хранится как «накопленное время + момент старта», чтобы переживать паузы
// и перезагрузку страницы без тикающего интервала в состоянии.

export function startTimer(state, now = Date.now()) {
    if (state.startedAt === null && !state.completedAt) state.startedAt = now;
    return state;
}

export function pauseTimer(state, now = Date.now()) {
    if (state.startedAt !== null) {
        state.elapsedMs += now - state.startedAt;
        state.startedAt = null;
    }
    return state;
}

export function getElapsedMs(state, now = Date.now()) {
    return state.elapsedMs + (state.startedAt === null ? 0 : now - state.startedAt);
}

export function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Фиксирует победу: останавливает таймер и проставляет completedAt. Идемпотентна.
export function complete(state, now = Date.now()) {
    if (state.completedAt) return false;
    if (!isWon(state)) return false;
    pauseTimer(state, now);
    state.completedAt = now;
    return true;
}

// --- Сериализация для extensionSettings (Фаза 4). История в сохранение не попадает:
// undo после перезагрузки страницы всё равно был бы для игрока неожиданностью, а стек
// снапшотов заметно раздувает settings.json.

export function serializeGame(state, now = Date.now()) {
    return {
        version: STATE_VERSION,
        puzzle: state.puzzle.slice(),
        solution: state.solution.slice(),
        values: state.values.slice(),
        notes: state.notes.slice(),
        difficulty: state.difficulty,
        level: state.level,
        elapsedMs: getElapsedMs(state, now),
        completedAt: state.completedAt,
    };
}

// Возвращает null, если сохранение битое или от несовместимой версии — вызывающий код
// просто начнёт новую партию.
export function deserializeGame(data) {
    if (!data || data.version !== STATE_VERSION) return null;

    const arrays = ['puzzle', 'solution', 'values', 'notes'];
    for (const key of arrays) {
        if (!Array.isArray(data[key]) || data[key].length !== CELLS) return null;
        if (data[key].some((value) => !Number.isInteger(value) || value < 0)) return null;
    }

    const state = createGame({
        puzzle: data.puzzle,
        solution: data.solution,
        difficulty: data.difficulty,
        level: data.level,
    });
    state.values = data.values.slice();
    state.notes = data.notes.slice();
    state.elapsedMs = Number.isFinite(data.elapsedMs) ? data.elapsedMs : 0;
    state.completedAt = data.completedAt ?? null;
    return state;
}
