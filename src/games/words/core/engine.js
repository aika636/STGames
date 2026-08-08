// Партия «Слов»: состояние, подача догадки, жёсткий режим, сериализация.
// Чистые функции над данными — ни DOM, ни SillyTavern, ни словарей внутри.

import { WORD_LENGTH, isWord, normalize } from './dictionary.js';
import { CORRECT, PRESENT, markGuess, revealedHints } from './mark.js';

export { WORD_LENGTH };

/** Сколько попыток даётся на слово. */
export const MAX_ATTEMPTS = 6;

export const PLAYING = 'playing';
export const WON = 'won';
export const LOST = 'lost';

// Причины отказа. Текст собирает UI: ядро про язык интерфейса не знает.
export const TOO_SHORT = 'tooShort';       // букв меньше нужного
export const NOT_IN_DICTIONARY = 'notInDictionary';
export const HARD_FIXED = 'hardFixed';     // { letter, position } — буква обязана стоять здесь
export const HARD_MISSING = 'hardMissing'; // { letter, count } — буква обязана встретиться
export const GAME_OVER = 'gameOver';

/**
 * Новая партия.
 *
 * `hardMode` замораживается здесь и дальше живёт в партии, а не читается из настроек:
 * переключатель посреди партии иначе ретроактивно менял бы сложность внутри одной
 * строки статистики. Тот же приём, что у уровня в реверси.
 */
export function createGame({ secret, hardMode = false } = {}) {
    const word = normalize(secret);
    if (!isWord(word)) throw new Error(`нельзя загадать «${secret}»`);
    return {
        secret: word,
        guesses: [],
        hardMode: Boolean(hardMode),
        // Длина слова и число попыток лежат в состоянии, хотя сейчас это константы:
        // так будущая настройка длины не потребует выбрасывать чужие сохранёнки.
        length: WORD_LENGTH,
        maxAttempts: MAX_ATTEMPTS,
        status: PLAYING,
    };
}

/** Сколько попыток осталось. */
export function attemptsLeft(state) {
    return Math.max(0, state.maxAttempts - state.guesses.length);
}

/** Разметка всех подтверждённых догадок. Производная — в состоянии не хранится. */
export function marks(state) {
    return state.guesses.map((guess) => markGuess(state.secret, guess));
}

/**
 * Проверка догадки по правилам жёсткого режима.
 *
 * По канону Wordle, и «интуитивные» правила тут неверны:
 *   * зелёная буква обязана стоять на своей позиции;
 *   * жёлтая обязана присутствовать в количестве не меньше раскрытого;
 *   * переставлять жёлтую на другое место НЕ обязательно;
 *   * серые буквы использовать НЕ запрещено — распространённая «доработка»,
 *     которая ломает совместимость с оригиналом и злит игрока.
 */
export function checkHard(state, guess) {
    const { fixed, minCounts } = revealedHints(state.secret, state.guesses, state.length);

    for (let i = 0; i < state.length; i++) {
        if (fixed[i] && guess[i] !== fixed[i]) {
            return { ok: false, reason: HARD_FIXED, letter: fixed[i], position: i };
        }
    }

    for (const [letter, required] of minCounts) {
        const present = [...guess].filter((ch) => ch === letter).length;
        if (present < required) {
            return { ok: false, reason: HARD_MISSING, letter, count: required };
        }
    }

    return { ok: true };
}

/**
 * Подать догадку.
 *
 * Невалидная догадка НЕ меняет состояние вообще — попытка не тратится.
 * Проверка по словарю обязательна: без неё две догадки вроде «АБВГД» и «ЕЖЗИК»
 * перебирают половину алфавита, и оставшиеся попытки становятся формальностью.
 *
 * @param {object} state
 * @param {string} word       догадка, в любом регистре
 * @param {object} dictionary объект из core/dictionary.js (нужен только has)
 */
export function submitGuess(state, word, dictionary) {
    if (state.status !== PLAYING) return { ok: false, reason: GAME_OVER };

    const guess = normalize(word);
    if (guess.length !== state.length || !isWord(guess)) {
        return { ok: false, reason: TOO_SHORT };
    }
    if (!dictionary.has(guess)) {
        return { ok: false, reason: NOT_IN_DICTIONARY };
    }
    if (state.hardMode) {
        const hard = checkHard(state, guess);
        if (!hard.ok) return hard;
    }

    state.guesses.push(guess);
    if (guess === state.secret) state.status = WON;
    else if (state.guesses.length >= state.maxAttempts) state.status = LOST;

    return { ok: true, status: state.status, marks: markGuess(state.secret, guess) };
}

/** Сдаться: слово раскрывается, партия засчитывается поражением. */
export function surrender(state) {
    if (state.status !== PLAYING) return false;
    state.status = LOST;
    return true;
}

// --- сохранение --------------------------------------------------------------

export function serialize(state) {
    return {
        secret: state.secret,
        guesses: state.guesses.slice(),
        hardMode: state.hardMode,
        length: state.length,
        maxAttempts: state.maxAttempts,
    };
}

/**
 * Восстановление партии из настроек.
 *
 * Обязана пережить руками поправленный settings.json и вернуть null, а не бросить.
 * Статус пересчитывается по загаданному слову и догадкам, а не читается из записи:
 * сохранённый статус — второй источник правды, и он разъезжается первым.
 * Раскраска и состояние клавиатуры не хранятся вовсе — они производные.
 */
export function deserialize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const secret = normalize(raw.secret);
    if (!isWord(secret)) return null;

    const length = Number.isInteger(raw.length) ? raw.length : WORD_LENGTH;
    const maxAttempts = Number.isInteger(raw.maxAttempts) ? raw.maxAttempts : MAX_ATTEMPTS;
    if (length !== secret.length || maxAttempts < 1) return null;

    if (!Array.isArray(raw.guesses)) return null;
    const guesses = [];
    for (const item of raw.guesses) {
        const guess = normalize(item);
        // Членство в словаре НЕ проверяем: словарь мог обновиться между версиями
        // расширения, и это не повод выбрасывать чужую партию.
        if (!isWord(guess) || guess.length !== length) return null;
        guesses.push(guess);
    }
    if (guesses.length > maxAttempts) return null;

    const state = {
        secret,
        guesses,
        hardMode: Boolean(raw.hardMode),
        length,
        maxAttempts,
        status: PLAYING,
    };
    if (guesses[guesses.length - 1] === secret) state.status = WON;
    else if (guesses.length >= maxAttempts) state.status = LOST;

    return state;
}

/** Строка результата для статистики: с какой попытки угадано (или null). */
export function winningAttempt(state) {
    return state.status === WON ? state.guesses.length : null;
}

export { CORRECT, PRESENT };
