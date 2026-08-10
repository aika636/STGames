// Генерация нонограммы. Картинка рисуется случайно, подсказки считаются по ней, а
// принимается она только если решатель (core/solver.js) восстанавливает её однозначно,
// одними линейными выводами. Это и есть определение честной нонограммы: у неё ровно
// одно решение, и оно берётся без перебора с возвратом.
//
// Случайный шум таким свойством почти не обладает, поэтому картинка не бросается целиком
// при неудаче, а чинится: клетки, которые решатель не смог определить, перекрашиваются —
// разобранная часть картинки при этом сохраняется. Приём тот же, что в генераторе сапёра.

import { cluesFromGrid, solveGrid, UNKNOWN } from './solver.js';

// Свой генератор случайных чисел в каждой игре — правило проекта: игры не импортируют
// друг у друга ничего, даже мелочь. Нужен для воспроизводимости в тестах.
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

export const BOARDS = Object.freeze({
    easy: Object.freeze({ cols: 5, rows: 5, density: 0.6 }),
    medium: Object.freeze({ cols: 10, rows: 10, density: 0.58 }),
    hard: Object.freeze({ cols: 15, rows: 15, density: 0.55 }),
});

export function boardFor(level) {
    return BOARDS[level] ?? BOARDS.easy;
}

const REPAIRS = 40;
const RESTARTS = 12;

// Картинка из отдельных случайных клеток даёт «снег»: подсказки вида 1 1 1 1, читать
// их скучно и решать тяжело. Поэтому клетка склонна повторять соседей слева и сверху —
// получаются пятна, у которых блоки длиннее, а подсказки осмысленнее.
function paint({ cols, rows, density, rng }) {
    const grid = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const left = x > 0 ? grid[y * cols + x - 1] : 0;
            const up = y > 0 ? grid[(y - 1) * cols + x] : 0;
            const neighbours = left + up;
            // База — заказанная плотность, соседи тянут её к себе: одна закрашенная
            // соседка добавляет ~12%, две — ~24%.
            const chance = density + (neighbours - 1) * 0.12;
            grid[y * cols + x] = rng() < chance ? 1 : 0;
        }
    }
    return grid;
}

// Полностью пустая или полностью закрашенная строка или столбец — не ошибка, но такая
// картинка выглядит как сбой. Совсем пустую картинку отбрасываем сразу.
function isDegenerate(grid) {
    let filled = 0;
    for (const cell of grid) filled += cell;
    return filled === 0 || filled === grid.length;
}

// Возвращает { grid, rowClues, colClues, unique, attempts }. unique === false означает,
// что потолок попыток исчерпан и отдана последняя картинка: отказать в партии нельзя —
// игрок нажал «Новая» и ждёт поле, а не сообщение об ошибке.
export function generatePuzzle({ cols, rows, density = 0.55, rng = Math.random }) {
    let attempts = 0;
    let grid = null;
    let clues = null;

    for (let restart = 0; restart < RESTARTS; restart++) {
        grid = paint({ cols, rows, density, rng });
        if (isDegenerate(grid)) continue;

        for (let repair = 0; repair <= REPAIRS; repair++) {
            attempts++;
            clues = cluesFromGrid(grid, cols, rows);
            const result = solveGrid({ cols, rows, ...clues });
            if (result.solved && !result.contradiction) {
                return { grid, ...clues, unique: true, attempts };
            }

            // Чинка: перекрашиваем одну из клеток, которые решатель не определил.
            // Именно они — источник неоднозначности, и менять что-то ещё бессмысленно.
            const stuck = [];
            for (let i = 0; i < grid.length; i++) {
                if (result.grid[i] === UNKNOWN) stuck.push(i);
            }
            if (stuck.length === 0) break;
            const target = stuck[Math.floor(rng() * stuck.length)];
            grid[target] = grid[target] ? 0 : 1;
            if (isDegenerate(grid)) break;
        }
    }

    return { grid, ...(clues ?? cluesFromGrid(grid, cols, rows)), unique: false, attempts };
}
