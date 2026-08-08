// Разметка догадки и состояние букв. Чистые функции: ни DOM, ни SillyTavern.
//
// Единственное место игры, где ошибаются все реализации, — повторяющиеся буквы.
// Правило: цвета распределяются как МУЛЬТИМНОЖЕСТВО, а не «есть ли буква в слове».
// Каждая буква получает ровно min(сколько её в догадке, сколько её в загаданном)
// цветных ячеек, и зелёные разбираются раньше жёлтых.

/** Буква стоит на своём месте. */
export const CORRECT = 'correct';
/** Буква в слове есть, но не здесь. */
export const PRESENT = 'present';
/** Буквы в слове нет — или все её вхождения уже разобраны другими ячейками. */
export const ABSENT = 'absent';
/** Буква ещё не встречалась ни в одной догадке (только для клавиатуры). */
export const UNKNOWN = 'unknown';

// Чем больше индекс, тем «сильнее» состояние. Клавиатура агрегирует по максимуму:
// буква, ставшая зелёной, не должна откатываться в жёлтую после следующей догадки,
// где она стоит не на месте.
const RANK = { [UNKNOWN]: 0, [ABSENT]: 1, [PRESENT]: 2, [CORRECT]: 3 };

/**
 * Размечает догадку относительно загаданного слова.
 *
 * @param {string} secret загаданное слово (нормализованное)
 * @param {string} guess  догадка той же длины
 * @returns {string[]} по статусу на каждую букву догадки
 */
export function markGuess(secret, guess) {
    const length = guess.length;
    const result = new Array(length).fill(ABSENT);
    const remaining = new Map();

    // Проход 1 — точные совпадения. В остаток попадают ТОЛЬКО буквы с несовпавших
    // позиций: положить туда весь секрет сразу — и есть та самая ошибка.
    // Проход обязан пройти строку до конца прежде, чем начнётся второй: иначе
    // «КУБОК» против «ЗАМОК» покрасит первую К жёлтым, не зная, что она уже
    // израсходована зелёной правее.
    for (let i = 0; i < length; i++) {
        if (guess[i] === secret[i]) {
            result[i] = CORRECT;
        } else {
            remaining.set(secret[i], (remaining.get(secret[i]) ?? 0) + 1);
        }
    }

    // Проход 2 — присутствие по остатку. Каждое попадание СПИСЫВАЕТ букву,
    // иначе одна буква секрета раскрасит сколько угодно ячеек догадки.
    for (let i = 0; i < length; i++) {
        if (result[i] === CORRECT) continue;
        const left = remaining.get(guess[i]) ?? 0;
        if (left > 0) {
            result[i] = PRESENT;
            remaining.set(guess[i], left - 1);
        }
    }

    return result;
}

/**
 * Состояние букв для экранной клавиатуры: агрегат по всем догадкам.
 *
 * @returns {Map<string, string>} буква → CORRECT | PRESENT | ABSENT
 *          (буквы без записи считаются UNKNOWN)
 */
export function keyboardState(secret, guesses) {
    const state = new Map();
    for (const guess of guesses) {
        const marks = markGuess(secret, guess);
        for (let i = 0; i < guess.length; i++) {
            const letter = guess[i];
            const current = state.get(letter) ?? UNKNOWN;
            if (RANK[marks[i]] > RANK[current]) state.set(letter, marks[i]);
        }
    }
    return state;
}

/** Состояние одной буквы на клавиатуре. */
export function letterState(state, letter) {
    return state.get(letter) ?? UNKNOWN;
}

/**
 * Подсказки, раскрытые историей догадок, — сырьё для жёсткого режима.
 *
 * @returns {{ fixed: (string|null)[], minCounts: Map<string, number> }}
 *   fixed[i]   — буква, обязанная стоять на позиции i (или null)
 *   minCounts  — сколько раз буква обязана встретиться в догадке
 */
export function revealedHints(secret, guesses, length) {
    const fixed = new Array(length).fill(null);
    const minCounts = new Map();

    for (const guess of guesses) {
        const marks = markGuess(secret, guess);
        // Считаем по одной догадке, а не по всем сразу: «раскрыто две А» означает,
        // что две А подсветились в ОДНОЙ строке. Суммировать по строкам нельзя —
        // одна и та же А, найденная трижды, потребовала бы трёх А в догадке.
        const counts = new Map();
        for (let i = 0; i < guess.length; i++) {
            if (marks[i] === CORRECT) fixed[i] = guess[i];
            if (marks[i] === CORRECT || marks[i] === PRESENT) {
                counts.set(guess[i], (counts.get(guess[i]) ?? 0) + 1);
            }
        }
        for (const [letter, count] of counts) {
            if (count > (minCounts.get(letter) ?? 0)) minCounts.set(letter, count);
        }
    }

    return { fixed, minCounts };
}
