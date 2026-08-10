// Словарь балды: чистые функции над упакованным списком плюс префиксное дерево (бор).
//
// Про DOM и SillyTavern этот модуль не знает и сам словарь НЕ импортирует — его
// подсовывает вызывающая сторона. Так ядро остаётся тестируемым под node, а триста
// килобайт данных грузятся динамическим import() только когда игрок реально открыл
// игру (src/games/balda/data/words.js).
//
// Зачем бор. Соперник за ход перебирает все пустые клетки × 32 буквы × все пути через
// новую клетку; путей по полю 5×5 экспоненциально много, и единственное, что делает
// перебор конечным, — отсечение по префиксу: как только начало пути не начинает ни
// одного слова, ветка мертва. Set<string> такого вопроса не отвечает, а бор отвечает
// за один шаг по букве. Строится он в рантайме из плоского списка: сериализованный бор
// весил бы кратно больше самих слов, а сборка занимает десяток миллисекунд один раз
// за партию (замер — в отчёте фазы 13.1).

/** Минимальная и максимальная длина слова, помещающегося на поле 5×5. */
export const MIN_LENGTH = 2;
export const MAX_LENGTH = 25;

const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
// Тот же алфавит множеством: проверка буквы зовётся на каждый символ каждого из
// двадцати тысяч слов при сборке бора, и линейный поиск по строке там заметен.
const LETTER_SET = new Set(LETTERS);

/**
 * Единственная нормализация во всей игре: верхний регистр и «ё» → «е».
 *
 * Ту же нормализацию делает tools/build-dictionary.mjs на этапе сборки, поэтому
 * в словаре «ё» нет вовсе. Различать «ё» и «е» значило бы отвергать честно
 * составленное слово за знание типографской традиции — как и в «Словах».
 */
export function normalize(word) {
    return String(word ?? '').trim().toUpperCase().replace(/Ё/g, 'Е');
}

/** Строка из русских букв длиной от MIN_LENGTH до MAX_LENGTH (после normalize). */
export function isWord(word) {
    if (typeof word !== 'string') return false;
    if (word.length < MIN_LENGTH || word.length > MAX_LENGTH) return false;
    for (const letter of word) {
        if (!LETTER_SET.has(letter)) return false;
    }
    return true;
}

/** Алфавит для перебора соперником и для клавиатуры — 32 буквы, без «ё». */
export function alphabet() {
    return LETTERS;
}

/**
 * Разворачивает упакованный список: объект «длина → одна отсортированная строка
 * без разделителей», слайсы фиксированной ширины, равной ключу.
 *
 * Мусор переживает молча: нечисловой ключ, нестроковое значение и хвост короче
 * слова просто отбрасываются.
 */
export function unpack(packedByLength) {
    const words = [];
    if (!packedByLength || typeof packedByLength !== 'object') return words;
    for (const [key, packed] of Object.entries(packedByLength)) {
        const length = Number(key);
        if (!Number.isInteger(length) || length < 1) continue;
        if (typeof packed !== 'string') continue;
        for (let i = 0; i + length <= packed.length; i += length) {
            words.push(packed.slice(i, i + length));
        }
    }
    return words;
}

// Узел бора: Map «буква → узел» плюс флаг «здесь кончается слово». Map, а не обычный
// объект: ключи — кириллица, и объект с такими ключами хуже оптимизируется движком,
// а сам поиск по Map — тот же хэш.
function createNode() {
    return { children: new Map(), terminal: false };
}

/**
 * Словарь игры.
 *
 * @param {Record<number|string, string>} packedByLength  упакованный список из
 *        src/games/balda/data/words.js (или любой объект того же вида — в тестах
 *        удобно собрать его руками).
 */
export function createDictionary(packedByLength) {
    const words = unpack(packedByLength);
    const root = createNode();
    let size = 0;
    let longest = 0;

    for (const word of words) {
        if (!isWord(word)) continue;   // мусор в данных не должен попадать в бор
        if (word.length > longest) longest = word.length;
        let node = root;
        for (const letter of word) {
            let next = node.children.get(letter);
            if (!next) {
                next = createNode();
                node.children.set(letter, next);
            }
            node = next;
        }
        if (!node.terminal) {
            node.terminal = true;
            size++;
        }
    }

    // Спуск по бору. null, если такого префикса нет ни у одного слова.
    function descend(text) {
        let node = root;
        for (const letter of text) {
            node = node.children.get(letter);
            if (!node) return null;
        }
        return node;
    }

    return {
        /** Сколько слов в словаре. */
        get size() { return size; },

        normalize,

        /** Есть ли такое слово. Вход нормализуется — звать можно с чем угодно. */
        has(word) {
            const normalized = normalize(word);
            if (!isWord(normalized)) return false;
            return descend(normalized)?.terminal === true;
        },

        /**
         * Начинает ли строка хоть одно слово словаря. Пустая строка — да (с неё
         * начинается всё), потому что это ответ на вопрос «стоит ли продолжать путь».
         * Требований к длине здесь нет: префикс короче MIN_LENGTH — нормальное
         * состояние недостроенного пути.
         */
        hasPrefix(prefix) {
            const normalized = normalize(prefix);
            if (normalized.length > MAX_LENGTH) return false;
            for (const letter of normalized) {
                if (!LETTER_SET.has(letter)) return false;
            }
            return descend(normalized) !== null;
        },

        // --- пошаговый обход бора ---
        //
        // Соперник идёт по полю по одной клетке, и пересчитывать весь префикс на каждом
        // шаге незачем: строковый hasPrefix(prefix + letter) склеивает строку на каждом
        // ветвлении перебора, а это его самая горячая точка. Набор root/child/isWord —
        // контракт, который ждёт src/games/balda/core/ai.js (там же описан и медленный
        // фолбэк на has/hasPrefix, если словарь бора не отдаёт).

        /** Корень бора. Узел — непрозрачное значение, наружу его не разбирают. */
        root() { return root; },

        /** Переход по одной букве. null, если продолжения нет. */
        child(node, letter) { return node?.children?.get(letter) ?? null; },

        /** Оканчивается ли слово на этом узле. Длину проверяет движок, не словарь. */
        isWord(node) { return node?.terminal === true; },

        /** Длина самого длинного слова: перебору незачем строить пути длиннее. */
        get maxLength() { return longest; },

        /** Только для тестов и проверок целостности. */
        words() { return words.slice(); },
    };
}
