// Правила балды: чистая логика над состоянием — ни DOM, ни таймеров, ни SillyTavern.
// Случайности в правилах нет вовсе (она появится только в ai.js, у слабых уровней).
// Состояние мутируется на месте — так же, как в реверси и в змейке, чтобы ядра игр
// не расходились в стиле.
//
// Правила. Поле — квадрат нечётного размера (обычно 5×5), в средний ряд вписано
// загаданное существительное. Ход: поставить одну букву в пустую клетку, смежную по
// стороне с занятой, и составить слово — связный путь по соседним клеткам без
// повторного использования клетки, обязательно проходящий через только что
// поставленную букву. Слово должно быть в словаре и не должно повторять уже собранные
// в этой партии (загаданное слово тоже считается собранным). Очки = длина слова.
// Ходов нет — пас; партия кончается, когда поле заполнено или оба спасовали подряд.
//
// --- Контракт словаря -------------------------------------------------------
//
// Словарь ядром НЕ импортируется: его подсовывает вызывающая сторона (так же, как в
// «Словах»). Двести килобайт данных грузятся динамическим import() только когда игрок
// реально открыл игру, а ядро остаётся тестируемым под node.
//
// Движку от словаря нужен ровно один метод:
//
//   has(word: string): boolean   — есть ли слово в словаре. Вход — уже нормализованная
//                                  строка заглавных русских букв без «ё» (normalize()
//                                  ниже), но реализация вправе нормализовать ещё раз.
//
// Сопернику (ai.js) нужен ещё перебор по префиксам — см. шапку ai.js.

export const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

export const DEFAULT_SIZE = 5;

/** Одна буква словом не считается: путь длиной 1 — это просто поставленная буква. */
export const MIN_WORD_LENGTH = 2;

/** Пустая клетка. Занятая хранит код буквы (charCodeAt) — см. createBoard(). */
export const EMPTY = 0;

/** Стороны. Первым по правилам ходит FIRST; играть за SECOND — значит уступить первый ход. */
export const FIRST = 0;
export const SECOND = 1;

// Причины отказа. Текст собирает UI: ядро про язык интерфейса не знает — тот же приём,
// что в src/games/words/core/engine.js.
export const GAME_OVER = 'gameOver';               // партия уже окончена
export const BAD_CELL = 'badCell';                 // индекс вне поля / не целое число
export const CELL_TAKEN = 'cellTaken';             // клетка занята
export const NOT_ADJACENT = 'notAdjacent';         // клетка не смежна ни с одной занятой
export const BAD_LETTER = 'badLetter';             // не одна русская буква
export const TOO_SHORT = 'tooShort';               // путь короче MIN_WORD_LENGTH
export const BAD_PATH = 'badPath';                 // путь рваный, с повтором или по пустым
export const PATH_MISSES_LETTER = 'pathMissesLetter'; // путь не проходит через новую букву
export const NOT_IN_DICTIONARY = 'notInDictionary';
export const WORD_USED = 'wordUsed';               // слово уже собрано в этой партии

/**
 * Единственная нормализация во всей игре: верхний регистр и «ё» → «е».
 * Ровно та же, что в «Словах»: игрок в общем случае не знает, пишется ли слово через
 * «ё», и словари собираются без неё.
 */
export function normalize(word) {
    return String(word ?? '').trim().toUpperCase().replace(/Ё/g, 'Е');
}

export function isLetter(ch) {
    return typeof ch === 'string' && ch.length === 1 && LETTERS.includes(ch);
}

/** Все символы строки — русские буквы, и строка непустая. */
export function isWordShaped(word) {
    if (typeof word !== 'string' || word.length === 0) return false;
    for (const ch of word) if (!LETTERS.includes(ch)) return false;
    return true;
}

export function idx(size, x, y) {
    return y * size + x;
}

export function xOf(size, index) {
    return index % size;
}

export function yOf(size, index) {
    return (index / size) | 0;
}

// Таблица соседей по стороне, по одной на размер поля. Считается один раз и живёт в
// модуле: перебор в ai.js ходит по ней миллионы раз за ход, и пересчитывать соседей
// координатами на каждом шаге — самый дорогой из возможных способов.
const NEIGHBOURS = new Map();

export function neighbourTable(size) {
    const cached = NEIGHBOURS.get(size);
    if (cached) return cached;

    const table = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const list = [];
            if (y > 0) list.push(idx(size, x, y - 1));
            if (y < size - 1) list.push(idx(size, x, y + 1));
            if (x > 0) list.push(idx(size, x - 1, y));
            if (x < size - 1) list.push(idx(size, x + 1, y));
            table.push(list);
        }
    }

    NEIGHBOURS.set(size, table);
    return table;
}

// Поле — Uint16Array(size²), индекс y * size + x, значение — код буквы или EMPTY.
// Плоский типизированный массив, а не массив массивов: перебор в ai.js читает поле
// на каждом шаге пути, и коды букв прямо в буфере избавляют от таблицы перекодировки.
export function createBoard(size, startWord) {
    const board = new Uint16Array(size * size);
    const middle = (size - 1) / 2;
    for (let x = 0; x < size; x++) board[idx(size, x, middle)] = startWord.charCodeAt(x);
    return board;
}

/**
 * Новая партия.
 *
 * Бросает Error на негодных параметрах: размер поля и загаданное слово приходят из
 * настроек и словаря, а не от игрока, поэтому это ошибка программиста — её надо увидеть
 * сразу, а не глушить fail-soft'ом (так же ведёт себя createGame() в «Словах»).
 *
 * Размер обязан быть нечётным: загаданное слово вписывается в средний ряд, у чётного
 * поля среднего ряда нет.
 *
 * Очки в состоянии НЕ хранятся: они однозначно выводятся из списка собранных слов
 * (scoreOf), а продублированное поле разъезжается с реальностью — урок реверси.
 */
export function createGame({ size = DEFAULT_SIZE, startWord, human = FIRST } = {}) {
    if (!Number.isInteger(size) || size < 3 || size % 2 === 0) {
        throw new Error(`балда: негодный размер поля ${size}`);
    }

    const start = normalize(startWord);
    if (!isWordShaped(start) || start.length !== size) {
        throw new Error(`балда: нельзя загадать «${startWord}» на поле ${size}×${size}`);
    }

    return {
        size,
        board: createBoard(size, start),
        start,
        turn: FIRST,
        human: human === SECOND ? SECOND : FIRST,
        // Собранные слова по сторонам: [слова FIRST, слова SECOND].
        words: [[], []],
        // Запрет повтора. Загаданное слово тоже занято: собрать его ещё раз нельзя.
        used: new Set([start]),
        passes: 0,
        over: false,
    };
}

export function letterAt(state, index) {
    const code = state.board[index];
    return code === EMPTY ? '' : String.fromCharCode(code);
}

export function isBoardFull(board) {
    for (let i = 0; i < board.length; i++) if (board[i] === EMPTY) return false;
    return true;
}

/** Смежна ли клетка хотя бы с одной занятой. Только для пустых клеток осмысленно. */
export function isPlayable(board, size, index) {
    if (board[index] !== EMPTY) return false;
    for (const n of neighbourTable(size)[index]) {
        if (board[n] !== EMPTY) return true;
    }
    return false;
}

/** Индексы пустых клеток, смежных с занятыми, — куда вообще разрешено ставить букву. */
export function playableCells(state) {
    const cells = [];
    for (let i = 0; i < state.board.length; i++) {
        if (isPlayable(state.board, state.size, i)) cells.push(i);
    }
    return cells;
}

/** Очки стороны — сумма длин её слов. Производная величина, в состоянии не хранится. */
export function scoreOf(state, player) {
    let sum = 0;
    for (const word of state.words[player]) sum += word.length;
    return sum;
}

export function scores(state) {
    return [scoreOf(state, FIRST), scoreOf(state, SECOND)];
}

/** FIRST / SECOND, либо null при ничьей. */
export function winner(state) {
    const [first, second] = scores(state);
    if (first > second) return FIRST;
    if (second > first) return SECOND;
    return null;
}

export function other(player) {
    return player === FIRST ? SECOND : FIRST;
}

/**
 * Проверка хода без изменения состояния.
 *
 * @param {object} state
 * @param {{index: number, letter: string, path: number[]}} move
 * @param {{has(word: string): boolean}} dictionary
 * @returns {{ok: boolean, reason?: string, word?: string, score?: number}}
 *
 * Поле при проверке не мутируется даже временно: буква новой клетки подставляется
 * при чтении (codeAt ниже). Мутация с откатом развалилась бы при первом же исключении
 * посреди проверки и оставила бы на поле призрак.
 */
export function checkMove(state, move, dictionary) {
    if (state.over) return { ok: false, reason: GAME_OVER };

    const { index, letter, path } = move ?? {};
    const size = state.size;
    const cells = size * size;

    if (!Number.isInteger(index) || index < 0 || index >= cells) {
        return { ok: false, reason: BAD_CELL };
    }
    if (state.board[index] !== EMPTY) return { ok: false, reason: CELL_TAKEN };

    const ch = normalize(letter);
    if (!isLetter(ch)) return { ok: false, reason: BAD_LETTER };

    if (!isPlayable(state.board, size, index)) return { ok: false, reason: NOT_ADJACENT };

    if (!Array.isArray(path) || path.length < MIN_WORD_LENGTH) {
        return { ok: false, reason: TOO_SHORT };
    }
    if (path.length > cells) return { ok: false, reason: BAD_PATH };

    const code = ch.charCodeAt(0);
    const codeAt = (i) => (i === index ? code : state.board[i]);

    const neighbours = neighbourTable(size);
    const seen = new Set();
    let through = false;
    let word = '';

    for (let step = 0; step < path.length; step++) {
        const cell = path[step];

        if (!Number.isInteger(cell) || cell < 0 || cell >= cells) {
            return { ok: false, reason: BAD_PATH };
        }
        // Повтор клетки, разрыв пути и заход на пустую клетку — одна причина отказа:
        // для игрока это всё «такого слова здесь не набирается», а различать их в UI
        // незачем.
        if (seen.has(cell)) return { ok: false, reason: BAD_PATH };
        if (codeAt(cell) === EMPTY) return { ok: false, reason: BAD_PATH };
        if (step > 0 && !neighbours[path[step - 1]].includes(cell)) {
            return { ok: false, reason: BAD_PATH };
        }

        seen.add(cell);
        if (cell === index) through = true;
        word += String.fromCharCode(codeAt(cell));
    }

    if (!through) return { ok: false, reason: PATH_MISSES_LETTER };
    if (!dictionary.has(word)) return { ok: false, reason: NOT_IN_DICTIONARY };
    if (state.used.has(word)) return { ok: false, reason: WORD_USED };

    return { ok: true, word, score: word.length };
}

/**
 * Ход игрока, чья очередь. Негодный ход НЕ меняет состояние вообще.
 *
 * @returns {{ok: boolean, reason?: string, word?: string, score?: number, over?: boolean}}
 * `over` возвращается только у принятого хода — экрану он нужен там же, где и очки.
 */
export function applyMove(state, move, dictionary) {
    const result = checkMove(state, move, dictionary);
    if (!result.ok) return result;

    state.board[move.index] = normalize(move.letter).charCodeAt(0);
    state.words[state.turn].push(result.word);
    state.used.add(result.word);
    state.passes = 0;
    state.turn = other(state.turn);
    state.over = isBoardFull(state.board);

    return { ...result, over: state.over };
}

/**
 * Пас. Даётся безусловно: «ходов нет» словарь и перебор считают по-разному, и запрещать
 * игроку сдать ход, пока движок не докажет, что слов не осталось, — значит держать его
 * в партии перебором по 32 буквам вручную.
 *
 * Два паса подряд заканчивают партию.
 */
export function pass(state) {
    if (state.over) return { ok: false, over: true };

    state.passes += 1;
    state.turn = other(state.turn);
    state.over = state.passes >= 2 || isBoardFull(state.board);

    return { ok: true, over: state.over };
}

// --- Сохранение --------------------------------------------------------------
//
// Поле — строкой из size² символов, точка вместо пустой клетки: в settings.json оно
// читается глазами и не раздувается массивом чисел.

const EMPTY_CHAR = '.';

export function serialize(state) {
    let board = '';
    for (let i = 0; i < state.board.length; i++) {
        board += state.board[i] === EMPTY ? EMPTY_CHAR : String.fromCharCode(state.board[i]);
    }

    return {
        size: state.size,
        start: state.start,
        board,
        turn: state.turn,
        human: state.human,
        passes: state.passes,
        words: [state.words[FIRST].slice(), state.words[SECOND].slice()],
    };
}

/**
 * Восстановление партии из настроек.
 *
 * Обязана пережить руками поправленный settings.json и вернуть null, а не бросить.
 * Очки, множество занятых слов и признак конца партии пересчитываются, а не читаются
 * из записи: сохранённая производная — второй источник правды, и он разъезжается первым.
 */
export function deserialize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const size = raw.size;
    if (!Number.isInteger(size) || size < 3 || size % 2 === 0) return null;

    const start = normalize(raw.start);
    if (!isWordShaped(start) || start.length !== size) return null;

    if (typeof raw.board !== 'string' || raw.board.length !== size * size) return null;
    const board = new Uint16Array(size * size);
    for (let i = 0; i < board.length; i++) {
        const ch = raw.board[i];
        if (ch === EMPTY_CHAR) continue;
        if (!isLetter(ch)) return null;
        board[i] = ch.charCodeAt(0);
    }

    if (!Array.isArray(raw.words) || raw.words.length !== 2) return null;
    const words = [[], []];
    const used = new Set([start]);
    for (const player of [FIRST, SECOND]) {
        const list = raw.words[player];
        if (!Array.isArray(list)) return null;
        for (const item of list) {
            const word = normalize(item);
            // Членство в словаре НЕ проверяем: словарь мог обновиться между версиями
            // расширения, и это не повод выбрасывать чужую партию.
            if (!isWordShaped(word) || word.length < MIN_WORD_LENGTH) return null;
            words[player].push(word);
            used.add(word);
        }
    }

    const turn = raw.turn === SECOND ? SECOND : FIRST;
    const human = raw.human === SECOND ? SECOND : FIRST;
    const passes = Number.isInteger(raw.passes) && raw.passes > 0 ? Math.min(raw.passes, 2) : 0;

    return {
        size,
        board,
        start,
        turn,
        human,
        words,
        used,
        passes,
        over: passes >= 2 || isBoardFull(board),
    };
}
