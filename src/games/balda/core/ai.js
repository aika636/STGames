// Соперник в балде: полный перебор ходов с отсечением по префиксному дереву.
// Как и engine.js — чистая логика, ни DOM, ни таймеров: паузу «соперник думает»
// ставит UI, расчёт здесь синхронный.
//
// --- Что перебирается --------------------------------------------------------
//
// Ход — это (пустая клетка, смежная с занятой) × (буква) × (путь через эту клетку).
// Наивно это 32 полных обхода поля на каждую клетку. Здесь 32 схлопнуты в один обход:
// клетка-кандидат считается «дыркой», и когда путь в неё заходит, перебираются не все
// 32 буквы, а только те, у которых в боре есть продолжение от текущего узла. Пути,
// не заходящие в дырку, при этом обходятся один раз, а не 32 — это и есть основная
// экономия. Второе отсечение — сам бор: путь, у которого нет продолжения ни в одном
// слове, обрывается на первом же шаге.
//
// --- Контракт словаря --------------------------------------------------------
//
// Словарь сюда передаётся параметром, как и в движок (см. шапку engine.js).
// Сопернику нужен перебор по префиксам, и он умеет работать двумя способами.
//
// 1. Быстрый (рекомендуемый) — обход бора по узлам, без склейки строк:
//
//      root(): Node                        — корень бора; Node — что угодно, кроме
//                                            null/undefined (число, объект, строка)
//      child(node: Node, letter: string): Node | null
//                                          — переход по одной заглавной русской букве;
//                                            null/undefined, если продолжения нет
//      isWord(node: Node): boolean         — оканчивается ли на этом узле слово
//
// 2. Медленный фолбэк — по строкам, если методов бора нет:
//
//      has(word: string): boolean          — есть ли слово (нужен и движку)
//      hasPrefix(prefix: string): boolean  — есть ли хоть одно слово с таким началом
//
// Необязательное поле:
//
//      maxLength: number                   — длина самого длинного слова в словаре;
//                                            перебор не строит путей длиннее. Без него
//                                            потолок — число клеток поля.
//
// Достаточно любого одного из двух наборов; при наличии обоих берётся бор.

import {
    FIRST, LETTERS, MIN_WORD_LENGTH, SECOND,
    neighbourTable, playableCells,
} from './engine.js';

// mulberry32 скопирован из src/games/reversi/core/ai.js (то же решение, что в змейке
// и в судоку): кросс-игровая зависимость между core-модулями мешала бы добавлять игру
// одной папкой.
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

// Уровень — это выбор из найденных слов, а не глубина перебора: перебор всегда полный
// (иначе «сложный» просто не найдёт длинное слово), а уровни отличаются тем, какое из
// найденных слов берётся. Слабый соперник играет не хуже, а иначе — как в реверси.
export const LEVELS = Object.freeze(['easy', 'medium', 'hard']);
export const DEFAULT_LEVEL = 'medium';

// Код буквы → сама буква, без аллокации на каждом шаге пути. Индексируется кодом:
// русские заглавные — 1040…1071, «ё» в игре не существует.
const CHAR_OF = [];
for (const ch of LETTERS) CHAR_OF[ch.charCodeAt(0)] = ch;

/**
 * Приводит любой из двух наборов методов словаря к одному интерфейсу обхода.
 * Один код перебора вместо двух: разница между бором и строками — три строчки здесь.
 */
export function walkerFor(dictionary) {
    if (
        typeof dictionary?.root === 'function'
        && typeof dictionary?.child === 'function'
        && typeof dictionary?.isWord === 'function'
    ) {
        return {
            root: dictionary.root(),
            // Именно `== null`, а не `!child`: узлом бора вправе быть число, и корень
            // с номером 0 иначе выглядел бы как «продолжения нет».
            child: (node, ch) => {
                const next = dictionary.child(node, ch);
                return next == null ? null : next;
            },
            isWord: (node) => dictionary.isWord(node),
        };
    }

    if (typeof dictionary?.hasPrefix !== 'function' || typeof dictionary?.has !== 'function') {
        throw new Error('балда: словарь без бора обязан иметь has() и hasPrefix()');
    }

    // Узел — сам префикс. Медленнее бора (склейка строк на каждом шаге), зато словарь
    // может быть простым Set'ом.
    return {
        root: '',
        child: (prefix, ch) => (dictionary.hasPrefix(prefix + ch) ? prefix + ch : null),
        isWord: (prefix) => dictionary.has(prefix),
    };
}

/**
 * Все ходы, доступные сейчас, — по одному на каждое слово.
 *
 * Одно и то же слово часто набирается несколькими способами (разные клетки, разные
 * пути); в списке остаётся первый найденный, потому что дважды за партию слово всё
 * равно не собрать, а выбирать между способами набора не из чего.
 *
 * @param {object} state              состояние из engine.createGame()
 * @param {object} dictionary         см. контракт в шапке
 * @param {{limit?: number}} options  остановиться, набрав limit ходов (для «есть ли ход»)
 * @returns {Array<{index: number, letter: string, path: number[], word: string, score: number}>}
 */
export function findMoves(state, dictionary, { limit = Infinity } = {}) {
    const walker = walkerFor(dictionary);
    const size = state.size;
    const board = state.board;
    const cells = size * size;
    const neighbours = neighbourTable(size);

    const dictMax = Number.isInteger(dictionary?.maxLength) && dictionary.maxLength > 0
        ? dictionary.maxLength
        : cells;
    const maxLength = Math.min(dictMax, cells);

    const moves = [];
    const found = new Set();

    const visited = new Uint8Array(cells);
    const path = new Int16Array(cells);
    const codes = new Uint16Array(cells);

    let hole = -1;
    let stop = false;

    function record(length, letter) {
        const word = String.fromCharCode.apply(null, codes.subarray(0, length));
        if (found.has(word) || state.used.has(word)) return;
        found.add(word);
        moves.push({
            index: hole,
            letter,
            path: Array.from(path.subarray(0, length)),
            word,
            score: length,
        });
        if (moves.length >= limit) stop = true;
    }

    // Путь длиной `length` заканчивается в cell, node — узел бора для этого префикса.
    // letter — буква, поставленная в дырку, или null, если путь через дырку ещё не прошёл:
    // слово засчитывается только когда прошёл.
    function walk(cell, node, length, letter) {
        if (letter && length >= MIN_WORD_LENGTH && walker.isWord(node)) {
            record(length, letter);
            if (stop) return;
        }
        if (length >= maxLength) return;

        for (const next of neighbours[cell]) {
            if (visited[next]) continue;
            if (next !== hole && board[next] === 0) continue;
            enter(next, node, length, letter);
            if (stop) return;
        }
    }

    // Шаг в клетку `cell`, которая станет позицией `length` в пути.
    function enter(cell, node, length, letter) {
        visited[cell] = 1;

        if (cell === hole) {
            // Дырка: перебираются только буквы, у которых есть продолжение в боре.
            for (let i = 0; i < LETTERS.length; i++) {
                const ch = LETTERS[i];
                const child = walker.child(node, ch);
                if (child == null) continue;
                path[length] = cell;
                codes[length] = ch.charCodeAt(0);
                walk(cell, child, length + 1, ch);
                if (stop) break;
            }
        } else {
            const code = board[cell];
            const child = walker.child(node, CHAR_OF[code]);
            if (child != null) {
                path[length] = cell;
                codes[length] = code;
                walk(cell, child, length + 1, letter);
            }
        }

        visited[cell] = 0;
    }

    for (const candidate of playableCells(state)) {
        hole = candidate;
        for (let start = 0; start < cells; start++) {
            if (board[start] === 0 && start !== hole) continue;
            enter(start, walker.root, 0, null);
            if (stop) return moves;
        }
    }

    return moves;
}

/** Есть ли у стороны хоть один ход. Перебор обрывается на первом найденном слове. */
export function hasMove(state, dictionary) {
    return findMoves(state, dictionary, { limit: 1 }).length > 0;
}

// Какую длину слова предпочитает уровень: слабый — самое короткое из найденных,
// средний — среднее по длине, сильный — самое длинное (то есть максимум очков).
// Ограничивать перебор ради слабого уровня нельзя: он тогда не «играет слабее»,
// а просто не видит части поля, и партия против него становится непредсказуемой.
function pickLength(lengths, level) {
    if (level === 'easy') return lengths[0];
    if (level === 'hard') return lengths[lengths.length - 1];
    return lengths[Math.floor((lengths.length - 1) / 2)];
}

/**
 * Ход соперника. Возвращает готовый для engine.applyMove() объект или null, если слов
 * не нашлось (пас — забота движка и UI).
 *
 * Без rng выбор детерминирован: берётся первый ход нужной длины в порядке перебора.
 * С rng слабый и средний уровни выбирают из группы случайно — иначе соперник повторяет
 * из партии в партию одну и ту же игру (та же причина, что у лёгкого уровня в реверси).
 *
 * @param {object} state
 * @param {object} dictionary
 * @param {{level?: string, rng?: (() => number) | null}} options
 */
export function chooseMove(state, dictionary, { level = DEFAULT_LEVEL, rng = null } = {}) {
    const moves = findMoves(state, dictionary);
    if (!moves.length) return null;

    const known = LEVELS.includes(level) ? level : DEFAULT_LEVEL;
    const lengths = [...new Set(moves.map((move) => move.score))].sort((a, b) => a - b);
    const target = pickLength(lengths, known);

    const group = moves.filter((move) => move.score === target);
    if (!rng) return group[0];

    return group[Math.min(group.length - 1, Math.floor(rng() * group.length))];
}

export { FIRST, SECOND };
