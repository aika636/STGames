// Генератор псевдослучайных чисел. Отдельный модуль нужен ради воспроизводимости:
// тесты гоняют генератор с фиксированным сидом, чтобы падение можно было повторить.
// В браузере игра создаёт rng от Math.random.

// mulberry32 — 32-битный PRNG: короткий, без зависимостей, достаточного качества для
// перемешивания кандидатов и порядка выкалывания клеток.
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

export function defaultRng() {
    return Math.random;
}

// Перемешивание на месте (Fisher–Yates). Возвращает тот же массив для удобства цепочек.
export function shuffle(arr, rng = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}
