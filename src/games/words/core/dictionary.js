// Словарь игры «Слова»: чистые функции над упакованными списками.
//
// Про DOM и SillyTavern этот модуль не знает и сами словари НЕ импортирует — их
// подсовывает вызывающая сторона. Так ядро остаётся тестируемым под node, а
// двести килобайт данных грузятся динамическим import() только когда игрок реально
// открыл игру (src/games/words/data/*.js).

export const WORD_LENGTH = 5;

const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

/**
 * Единственная нормализация во всей игре: верхний регистр и «ё» → «е».
 *
 * Буквы «ё» в игре не существует нигде — ни в словаре, ни во вводе, ни в показе
 * ответа. Игрок в общем случае не знает, пишется ли слово через «ё», потому что
 * половина русских текстов её не ставит; различать их — раздавать поражения за
 * знание типографской традиции. Ту же нормализацию делает tools/build-dictionary.mjs
 * на этапе сборки, поэтому в словарях «ё» нет вовсе.
 */
export function normalize(word) {
    return String(word ?? '').trim().toUpperCase().replace(/Ё/g, 'Е');
}

/** Строка из ровно пяти русских букв (после normalize). */
export function isWord(word) {
    if (typeof word !== 'string' || word.length !== WORD_LENGTH) return false;
    for (const letter of word) {
        if (!LETTERS.includes(letter)) return false;
    }
    return true;
}

/** Алфавит для экранной клавиатуры и состояния букв — 32 буквы, без «ё». */
export function alphabet() {
    return LETTERS;
}

/**
 * Разворачивает упакованный список: одна отсортированная строка без разделителей,
 * слайсы по WORD_LENGTH букв.
 */
export function unpack(packed) {
    const source = typeof packed === 'string' ? packed : '';
    const words = [];
    for (let i = 0; i + WORD_LENGTH <= source.length; i += WORD_LENGTH) {
        words.push(source.slice(i, i + WORD_LENGTH));
    }
    return words;
}

/**
 * Словарь игры.
 *
 * @param {string} packedAnswers  загадываемые (узкий список)
 * @param {string} packedAllowed  допустимые догадки (широкий, включает загадываемые)
 */
export function createDictionary(packedAnswers, packedAllowed) {
    const answers = unpack(packedAnswers);
    const allowed = new Set(unpack(packedAllowed));
    // Широкий список обязан включать узкий — иначе игра загадает слово, которое сама
    // же не даст ввести. Сборка это гарантирует, но словари могут разъехаться при
    // ручной правке, а падать здесь дешевле, чем посреди партии.
    for (const word of answers) allowed.add(word);

    return {
        get size() { return answers.length; },

        /** Допустима ли догадка. Вход нормализуется — звать можно с чем угодно. */
        has(word) {
            const normalized = normalize(word);
            return isWord(normalized) && allowed.has(normalized);
        },

        /** Загадать слово. rng() → [0, 1), по умолчанию Math.random. */
        pick(rng = Math.random) {
            if (answers.length === 0) return null;
            const index = Math.floor(rng() * answers.length);
            return answers[Math.min(Math.max(index, 0), answers.length - 1)];
        },

        /** Только для тестов и проверок целостности. */
        answers() { return answers.slice(); },
    };
}
