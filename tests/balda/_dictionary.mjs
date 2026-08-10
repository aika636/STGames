// Словарь для тестов балды: рукописный список слов и две обёртки над ним — по одной
// на каждый из двух наборов методов, которые понимает ai.js (см. его шапку).
// Настоящий словарь делается в 13.1; ядру и сопернику он не нужен, чтобы проверяться.

/** Строковый словарь: has() + hasPrefix(). Медленный фолбэк перебора. */
export function createStringDictionary(words) {
    const set = new Set(words);
    const prefixes = new Set();
    let maxLength = 0;

    for (const word of set) {
        maxLength = Math.max(maxLength, word.length);
        for (let i = 1; i <= word.length; i++) prefixes.add(word.slice(0, i));
    }

    return {
        maxLength,
        has: (word) => set.has(word),
        hasPrefix: (prefix) => prefixes.has(prefix),
    };
}

/**
 * Словарь-бор: root() + child() + isWord(). Узлы намеренно сделаны числами (индексами
 * в плоских массивах), чтобы проверить, что перебор не путает узел 0 с «продолжения нет».
 */
export function createTrieDictionary(words) {
    const children = [new Map()];
    const terminal = [false];
    let maxLength = 0;

    for (const word of words) {
        maxLength = Math.max(maxLength, word.length);
        let node = 0;
        for (const ch of word) {
            let next = children[node].get(ch);
            if (next === undefined) {
                next = children.length;
                children.push(new Map());
                terminal.push(false);
                children[node].set(ch, next);
            }
            node = next;
        }
        terminal[node] = true;
    }

    const set = new Set(words);

    return {
        maxLength,
        // has() нужен движку — соперник на боре обходится без него.
        has: (word) => set.has(word),
        root: () => 0,
        child: (node, ch) => {
            const next = children[node].get(ch);
            return next === undefined ? null : next;
        },
        isWord: (node) => terminal[node],
    };
}
