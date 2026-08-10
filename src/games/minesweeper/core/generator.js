// Генерация поля сапёра. Мины расставляются не при создании партии, а при первом
// открытии: только тогда известна клетка, вокруг которой поле обязано быть безопасным.
//
// Два режима:
//   * обычный — случайная расстановка мимо безопасной зоны;
//   * «без угадывания» — та же расстановка, но поле принимается, только если решатель
//     (core/solver.js) берёт его целиком, без единой развилки «пятьдесят на пятьдесят».
//
// Слепой перебор в режиме «без угадывания» стоил бы сотни попыток: случайное поле
// среднего уровня решается логикой заметно реже, чем через раз. Поэтому неудачная
// расстановка не выбрасывается целиком, а чинится — мина переставляется внутри той
// области, где решатель встал; уже разобранная часть поля при этом сохраняется, и
// сходится это на порядок быстрее полного перезапуска.

import { neighbors } from './engine.js';
import { solveFrom } from './solver.js';

// Свой генератор случайных чисел в каждой игре — правило проекта: игры не импортируют
// друг у друга ничего, даже мелочь. Сюда он нужен ради воспроизводимости в тестах.
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

// Сколько раз чинить одну расстановку и сколько раз начинать с нуля. Числа подобраны
// замером (таблица в docs/roadmap.md, фаза 10): на «сложном» до успеха доходит десяток
// починок, потолок стоит на случай патологии, а не как рабочий режим.
const REPAIRS = 60;
const RESTARTS = 12;

// Безопасная зона первого клика — сама клетка и её соседи: первый ход должен открывать
// область, а не одинокую цифру, иначе партия начинается с угадывания. На тесном поле
// (мин больше, чем свободных клеток вне зоны) зона сжимается до одной клетки: гарантия
// «первый клик не мина» важнее, чем гарантия «первый клик — пустое место».
export function safeZone(cols, rows, safeIndex, mines) {
    const full = [safeIndex, ...neighbors(cols, rows, safeIndex)];
    const free = cols * rows - full.length;
    return free >= mines ? full : [safeIndex];
}

// Случайная расстановка мимо запретных клеток: частичный Фишер—Йейтс по списку
// разрешённых индексов — нужны только первые mines элементов.
function scatter({ cols, rows, mines, forbidden, rng }) {
    const banned = new Set(forbidden);
    const pool = [];
    for (let i = 0; i < cols * rows; i++) {
        if (!banned.has(i)) pool.push(i);
    }
    for (let i = 0; i < mines; i++) {
        const j = i + Math.floor(rng() * (pool.length - i));
        const tmp = pool[i];
        pool[i] = pool[j];
        pool[j] = tmp;
    }
    return pool.slice(0, mines);
}

function buildField(cols, rows, mines, mineIndices) {
    const size = cols * rows;
    const mine = new Uint8Array(size);
    for (const index of mineIndices) mine[index] = 1;
    const count = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        let n = 0;
        for (const j of neighbors(cols, rows, i)) n += mine[j];
        count[i] = n;
    }
    return { cols, rows, mines, mine, count };
}

// Возвращает { mines: [idx…], guessFree, attempts }. guessFree === false в обычном
// режиме и в редком случае, когда потолок попыток исчерпан: тогда отдаётся последняя
// расстановка. Отказать в партии из-за неудачной генерации нельзя — игрок нажал
// «Новая игра» и ждёт поле, а не сообщение об ошибке.
export function generateField({ cols, rows, mines, safeIndex, rng = Math.random, noGuess = true }) {
    const forbidden = safeZone(cols, rows, safeIndex, mines);

    if (!noGuess) {
        return { mines: scatter({ cols, rows, mines, forbidden, rng }), guessFree: false, attempts: 1 };
    }

    const banned = new Set(forbidden);
    let attempts = 0;
    let placed = null;

    for (let restart = 0; restart < RESTARTS; restart++) {
        placed = scatter({ cols, rows, mines, forbidden, rng });

        for (let repair = 0; repair <= REPAIRS; repair++) {
            attempts++;
            const field = buildField(cols, rows, mines, placed);
            const { solved, known } = solveFrom(field, safeIndex);
            if (solved) return { mines: placed, guessFree: true, attempts };

            // Починка: мина уезжает из области, где решатель встал, в свободную клетку
            // той же области. Разобранная часть поля от этого не меняется, а развилка,
            // на которой всё остановилось, — меняется.
            const stuckMines = [];
            const stuckFree = [];
            for (let i = 0; i < field.mine.length; i++) {
                if (known[i] !== 0 || banned.has(i)) continue;
                if (field.mine[i]) stuckMines.push(i);
                else stuckFree.push(i);
            }
            if (stuckMines.length === 0 || stuckFree.length === 0) break;

            const from = stuckMines[Math.floor(rng() * stuckMines.length)];
            const to = stuckFree[Math.floor(rng() * stuckFree.length)];
            placed = placed.map((index) => (index === from ? to : index));
        }
    }

    return { mines: placed, guessFree: false, attempts };
}
