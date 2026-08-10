// Партия кроссворда-скелета: сетка, банк слов и то, что игрок в неё разложил.
// Чистый модуль без DOM и без SillyTavern.
//
// Ход — это «слово из банка в слот»: игрок тапает слот, потом слово. Поэтому
// состояние партии — не буквы в клетках, а одно число на слот: индекс слова банка
// или -1. Буквы всегда пересчитываются из раскладки, разъехаться им негде.
//
// Валидность постановки проверяется по трём условиям: длина слова равна длине слота,
// слово ещё не лежит в другом слоте, и на всех пересечениях буквы сходятся с уже
// стоящими словами. Первые две проверки — правила игры, третья — то, ради чего
// кроссворд собирают.
//
// Ошибки игроку не подсвечиваются автоматически (`wrongCells` зовётся из настройки,
// по умолчанию выключенной): красная клетка выдала бы вывод, до которого игрок ещё
// не дошёл. Тот же уговор, что в судоку и нонограмме.

import { BLOCK, OPEN, parsePuzzle, serializePuzzle } from './puzzles.js';

export const EMPTY = -1;

export function createGame(puzzle, level = null) {
    return {
        puzzle,
        level: typeof level === 'string' ? level : null,
        placed: new Int32Array(puzzle.slots.length).fill(EMPTY),
        elapsed: 0,
        over: false,
        won: false,
    };
}

// --- чтение поля

export function isBlock(state, cell) {
    return state.puzzle.grid[cell] === BLOCK;
}

// Буква в клетке или '' — клетка пустая либо это блок.
export function letterAt(state, cell) {
    for (const ref of state.puzzle.cellSlots[cell] ?? []) {
        const word = state.placed[ref.slot];
        if (word !== EMPTY) return state.puzzle.bank[word][ref.pos];
    }
    return '';
}

// Всё поле строкой: '#' на блоках, буква или ' ' на клетках. Удобно и UI, и тестам.
export function lettersOf(state) {
    let out = '';
    for (let cell = 0; cell < state.puzzle.grid.length; cell++) {
        if (state.puzzle.grid[cell] === BLOCK) out += BLOCK;
        else out += letterAt(state, cell) || ' ';
    }
    return out;
}

// Слот, в котором лежит слово, или -1.
export function slotOfWord(state, wordIndex) {
    for (let slot = 0; slot < state.placed.length; slot++) {
        if (state.placed[slot] === wordIndex) return slot;
    }
    return EMPTY;
}

export function isWordUsed(state, wordIndex) {
    return slotOfWord(state, wordIndex) !== EMPTY;
}

// Индексы слов, оставшихся в банке.
export function availableWords(state) {
    const out = [];
    for (let word = 0; word < state.puzzle.bank.length; word++) {
        if (!isWordUsed(state, word)) out.push(word);
    }
    return out;
}

// Сколько слотов ещё пусто.
export function remaining(state) {
    let count = 0;
    for (const word of state.placed) {
        if (word === EMPTY) count++;
    }
    return count;
}

// --- ход
//
// Возвращает { ok, reason }. reason — почему нельзя, чтобы UI мог сказать это
// словами: 'over' | 'slot' | 'word' | 'length' | 'used' | 'conflict'.
export function canPlace(state, slotIndex, wordIndex) {
    if (state.over) return fail('over');
    const slot = state.puzzle.slots[slotIndex];
    if (!slot) return fail('slot');
    const word = state.puzzle.bank[wordIndex];
    if (word === undefined) return fail('word');
    if (word.length !== slot.length) return fail('length');

    const holder = slotOfWord(state, wordIndex);
    if (holder !== EMPTY && holder !== slotIndex) return fail('used');

    for (let pos = 0; pos < slot.length; pos++) {
        for (const ref of state.puzzle.cellSlots[slot.cells[pos]]) {
            if (ref.slot === slotIndex) continue;
            const other = state.placed[ref.slot];
            if (other === EMPTY) continue;
            if (state.puzzle.bank[other][ref.pos] !== word[pos]) return fail('conflict');
        }
    }

    return { ok: true, reason: '' };
}

function fail(reason) {
    return { ok: false, reason };
}

// Ставит слово в слот. Слово, стоявшее в этом слоте раньше, возвращается в банк.
export function placeWord(state, slotIndex, wordIndex) {
    if (!canPlace(state, slotIndex, wordIndex).ok) return false;
    if (state.placed[slotIndex] === wordIndex) return false;
    state.placed[slotIndex] = wordIndex;
    return true;
}

// Снимает слово со слота обратно в банк.
export function clearSlot(state, slotIndex) {
    if (state.over) return false;
    if (slotIndex < 0 || slotIndex >= state.placed.length) return false;
    if (state.placed[slotIndex] === EMPTY) return false;
    state.placed[slotIndex] = EMPTY;
    return true;
}

// --- победа и ошибки

// Победа — когда разложенное совпадает с решением по буквам. Сравниваются именно
// буквы, а не индексы слов: генератор гарантирует единственность раскладки, но
// сверка по полю не зависит от этой гарантии и переживёт её нарушение.
export function isSolved(state) {
    for (let slot = 0; slot < state.placed.length; slot++) {
        if (state.placed[slot] === EMPTY) return false;
    }
    for (let cell = 0; cell < state.puzzle.grid.length; cell++) {
        if (state.puzzle.grid[cell] !== OPEN) continue;
        if (letterAt(state, cell) !== state.puzzle.letters[cell]) return false;
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

// Клетки, где стоящая буква расходится с решением. Для настройки «подсветка ошибок»;
// в остальное время не зовётся.
export function wrongCells(state) {
    const wrong = [];
    for (let cell = 0; cell < state.puzzle.grid.length; cell++) {
        if (state.puzzle.grid[cell] !== OPEN) continue;
        const letter = letterAt(state, cell);
        if (letter && letter !== state.puzzle.letters[cell]) wrong.push(cell);
    }
    return wrong;
}

// Слоты, слово в которых расходится с решением. Подсветка ошибок по словам — то же
// самое крупным планом.
export function wrongSlots(state) {
    const wrong = [];
    for (let slot = 0; slot < state.placed.length; slot++) {
        const word = state.placed[slot];
        if (word !== EMPTY && word !== state.puzzle.solution[slot]) wrong.push(slot);
    }
    return wrong;
}

// --- Сохранение партии
//
// Головоломка едет вместе с партией: пул на диске может поменяться (перегенерация,
// другой уровень), а начатая партия обязана открыться такой же. Формат головоломки —
// тот же компактный, что в пуле, см. core/puzzles.js.

export function serialize(state) {
    return {
        ...serializePuzzle(state.puzzle),
        level: state.level,
        placed: Array.from(state.placed).join(','),
        elapsed: Math.max(0, Math.round(state.elapsed)),
        over: state.over,
        won: state.won,
    };
}

export function deserialize(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const puzzle = parsePuzzle(raw);
    if (!puzzle) return null;

    if (typeof raw.placed !== 'string') return null;
    const parts = raw.placed.split(',');
    if (parts.length !== puzzle.slots.length) return null;

    const placed = new Int32Array(puzzle.slots.length).fill(EMPTY);
    const seen = new Set();
    for (let slot = 0; slot < parts.length; slot++) {
        const value = Number(parts[slot]);
        if (!Number.isInteger(value)) return null;
        if (value === EMPTY) continue;
        if (value < 0 || value >= puzzle.bank.length) return null;
        // Одно слово в двух слотах — состояние, которого партия достичь не может.
        if (seen.has(value)) return null;
        if (puzzle.bank[value].length !== puzzle.slots[slot].length) return null;
        seen.add(value);
        placed[slot] = value;
    }

    const state = createGame(puzzle, typeof raw.level === 'string' ? raw.level : null);
    state.placed = placed;
    state.elapsed = Number.isFinite(raw.elapsed) && raw.elapsed > 0 ? Math.floor(raw.elapsed) : 0;
    state.over = Boolean(raw.over);
    state.won = state.over && Boolean(raw.won);
    // Партия из файла могла оказаться уже собранной — досчитываем честно, чтобы экран
    // не показывал «идёт» на готовом кроссворде.
    if (!state.over) checkWin(state);
    return state;
}
