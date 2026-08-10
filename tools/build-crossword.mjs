#!/usr/bin/env node
// Сборка пула головоломок кроссворда-скелета (src/games/crossword/data/puzzles.js).
//
// ОФЛАЙН-ИНСТРУМЕНТ. Браузер его не грузит, расширение от него не зависит,
// npm-пакетов он не требует. Запускается руками при перегенерации пула; результат
// коммитится готовым, поэтому «no build step» не нарушается. Тот же уговор, что
// с tools/build-dictionary.mjs.
//
// Почему пул офлайн, а не генерация в игре: укладка банка в сетку — это CSP
// с бэктрекингом плюс полный подсчёт раскладок ради единственности. На слабом
// телефоне это секунды, а «генератор не сошёлся» посреди партии недопустим
// (решение Фазы 12, docs/roadmap.md).
//
// --- ЧТО ЗДЕСЬ ДЕЛАЕТСЯ ------------------------------------------------------
//
//   1. Сетка. Блоки расставляются случайно с поворотной симметрией на 180°
//      (как в судоку и в классических кроссвордах: симметричная сетка выглядит
//      сделанной, а не насыпанной). Потом сетка «чинится»: открытые клетки, не
//      попавшие ни в один слот, затираются блоками — вместе с симметричными.
//      Сетка принимается, только если слотов нужное количество, у каждого слота
//      есть хотя бы одно пересечение, граф слотов связен и на каждую длину слота
//      в словаре есть слова.
//
//      Слот без пересечений — главный враг единственности: два свободных слота
//      одной длины меняются словами, и раскладок сразу две.
//
//   2. Укладка. Бэктрекинг по слотам с выбором самого стеснённого (MRV) и
//      обратным индексом «длина + позиция + буква → слова». Списки кандидатов
//      усекаются (CANDIDATE_LIMIT) и берутся со случайного места: точный размер
//      списка эвристике MRV не нужен, а копировать стотысячный словарь на каждом
//      узле — нет.
//
//   3. Единственность. При готовом банке пересчитываются ВСЕ раскладки этого
//      банка в эту сетку (countArrangements, с ранним выходом на второй).
//      Годится только результат «ровно одна». Иначе — новая укладка той же сетки
//      (дешёвая починка), а после нескольких неудач — новая сетка.
//
// --- УРОВНИ ------------------------------------------------------------------
//
// Три уровня, как у сапёра и нонограммы. Размер выбран из двух ограничений:
// сетка должна читаться на телефоне в модалке поверх чата, а банк — помещаться
// в список, который не надо листать полдня.
//
//   easy   7×7,   9–14 слов — партия на пару минут, весь банк видно разом
//   medium 9×9,  15–22 слова — рабочий размер, банк в один экран
//   hard   11×11, 20–28 слов — потолок читаемости на телефоне
//
// Плотность блоков подобрана так, чтобы длины слов шли вразнобой (3–7): банк из
// одних пятибуквенных и разложить труднее, и единственность у него хуже.
//
// --- ЗАПУСК ------------------------------------------------------------------
//
//   node tools/build-crossword.mjs --dict src/games/crossword/data/words.js
//   node tools/build-crossword.mjs --dict a.txt,b.txt --count 40 --seed 7
//
//   --dict     словари через запятую. Понимает:
//              *.txt/*.lst  — по слову в строке;
//              *.js/*.mjs   — ES-модуль с default:
//                             массив слов | объект { длина: слова } (строкой без
//                             разделителей или массивом) | одна строка без
//                             разделителей (тогда нужен --length).
//   --length   длина слова для словаря-строки без разделителей (по умолчанию 5).
//   --levels   какие уровни собирать (по умолчанию easy,medium,hard).
//   --count    головоломок на уровень (по умолчанию 30).
//   --seed     семя ГПСЧ, чтобы прогон повторялся (по умолчанию 1).
//   --out      куда писать (по умолчанию src/games/crossword/data/puzzles.js).
//
// --- ЛИЦЕНЗИЯ ----------------------------------------------------------------
//
// Пул содержит слова словаря, поэтому наследует его лицензию. Словарь по длинам —
// производное от OpenCorpora (CC BY-SA 4.0), см. src/games/crossword/data/NOTICE.
// Соответствующая пометка ставится в шапку сгенерированного файла.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BLOCK, MIN_WORD, OPEN, cellSlotsFrom, slotsFromGrid } from '../src/games/crossword/core/puzzles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// --- ГПСЧ --------------------------------------------------------------------

// Свой генератор случайных чисел, как в остальных играх: нужен для воспроизводимых
// прогонов и тестов.
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

// --- уровни ------------------------------------------------------------------

export const LEVELS = Object.freeze({
    easy: Object.freeze({ cols: 7, rows: 7, blockChance: 0.28, minSlots: 9, maxSlots: 14, budget: 4000 }),
    medium: Object.freeze({ cols: 9, rows: 9, blockChance: 0.30, minSlots: 15, maxSlots: 22, budget: 10000 }),
    hard: Object.freeze({ cols: 11, rows: 11, blockChance: 0.32, minSlots: 20, maxSlots: 28, budget: 20000 }),
});

export function levelFor(level) {
    return LEVELS[level] ?? LEVELS.easy;
}

const GRID_TRIES = 400;     // сколько сеток пробуем, прежде чем сдаться
const FILL_TRIES = 6;       // сколько укладок пробуем на одной сетке
const CANDIDATE_LIMIT = 300;

// --- словарь -----------------------------------------------------------------

// Та же нормализация, что во всём проекте: верхний регистр и ё→е.
export const normalize = (word) => String(word).trim().toUpperCase().replace(/Ё/g, 'Е');
const WORD_RE = /^[А-Я]+$/;

// Индекс по длине и по паре «позиция + буква». Строится один раз на прогон.
export function buildDictionary(words) {
    const byLength = new Map();
    const seen = new Set();
    for (const raw of words) {
        const word = normalize(raw);
        if (word.length < MIN_WORD || !WORD_RE.test(word) || seen.has(word)) continue;
        seen.add(word);
        if (!byLength.has(word.length)) byLength.set(word.length, []);
        byLength.get(word.length).push(word);
    }

    const index = new Map();
    const all = new Map();
    for (const [len, list] of byLength) {
        list.sort();
        const positions = Array.from({ length: len }, () => new Map());
        for (let i = 0; i < list.length; i++) {
            for (let pos = 0; pos < len; pos++) {
                const ch = list[i][pos];
                if (!positions[pos].has(ch)) positions[pos].set(ch, []);
                positions[pos].get(ch).push(i);
            }
        }
        index.set(len, positions);
        all.set(len, Array.from({ length: list.length }, (_, i) => i));
    }

    return { byLength, index, all, size: seen.size };
}

// Кандидаты в слот: слова нужной длины, совпадающие с уже стоящими буквами и не
// занятые. Список усечён и начинается со случайного места — это и рандомизация
// укладки, и потолок стоимости одного узла перебора.
function candidateWords(dict, len, pattern, used, rng, limit = CANDIDATE_LIMIT) {
    const list = dict.byLength.get(len);
    if (!list) return [];

    let source = null;
    for (let pos = 0; pos < len; pos++) {
        const ch = pattern[pos];
        if (!ch) continue;
        const bucket = dict.index.get(len)[pos].get(ch);
        if (!bucket) return [];
        if (source === null || bucket.length < source.length) source = bucket;
    }
    if (source === null) source = dict.all.get(len);

    const out = [];
    const start = Math.floor(rng() * source.length) % source.length;
    for (let k = 0; k < source.length && out.length < limit; k++) {
        const word = list[source[(start + k) % source.length]];
        if (used.has(word)) continue;
        let ok = true;
        for (let pos = 0; pos < len; pos++) {
            if (pattern[pos] && word[pos] !== pattern[pos]) { ok = false; break; }
        }
        if (ok) out.push(word);
    }
    return out;
}

// --- сетка -------------------------------------------------------------------

function mirrorOf(cell, cols, rows) {
    const x = cell % cols;
    const y = (cell - x) / cols;
    return (rows - 1 - y) * cols + (cols - 1 - x);
}

// Случайная симметричная сетка, вычищенная от клеток, в которые нечего писать.
// Возвращает строку сетки или null, если сетка не прошла проверки.
export function generateGrid({ cols, rows, blockChance, minSlots, maxSlots, dict, rng }) {
    const size = cols * rows;
    const grid = new Array(size).fill(OPEN);
    for (let cell = 0; cell < size; cell++) {
        const twin = mirrorOf(cell, cols, rows);
        if (twin < cell) continue;
        const value = rng() < blockChance ? BLOCK : OPEN;
        grid[cell] = value;
        grid[twin] = value;
    }

    // Починка: открытая клетка, не накрытая ни одним слотом, — дыра, писать в неё
    // нечего. Затираем блоком вместе с симметричной и пересчитываем: новый блок
    // мог укоротить соседний ряд ниже MIN_WORD и создать новые дыры.
    let slots = [];
    for (;;) {
        slots = slotsFromGrid(grid.join(''), cols, rows);
        const cover = cellSlotsFrom(slots, size);
        let changed = false;
        for (let cell = 0; cell < size; cell++) {
            if (grid[cell] !== OPEN || cover[cell].length > 0) continue;
            grid[cell] = BLOCK;
            grid[mirrorOf(cell, cols, rows)] = BLOCK;
            changed = true;
        }
        if (!changed) break;
    }

    if (slots.length < minSlots || slots.length > maxSlots) return null;

    const cover = cellSlotsFrom(slots, size);

    // Слот без пересечений разложить нечем: он свободно меняется словами с любым
    // другим слотом своей длины, и раскладок становится больше одной.
    const crossings = slots.map(() => []);
    for (const refs of cover) {
        for (let i = 0; i < refs.length; i++) {
            for (let j = i + 1; j < refs.length; j++) {
                crossings[refs[i].slot].push(refs[j].slot);
                crossings[refs[j].slot].push(refs[i].slot);
            }
        }
    }
    for (const list of crossings) {
        if (list.length === 0) return null;
    }

    // Связность: кроссворд из двух не соприкасающихся половин — две отдельные
    // головоломки, и каждая слабее целой.
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
        for (const next of crossings[queue.pop()]) {
            if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
    }
    if (seen.size !== slots.length) return null;

    // Длина, которой нет в словаре, обрубит укладку на первом же слоте.
    for (const slot of slots) {
        const list = dict.byLength.get(slot.length);
        if (!list || list.length === 0) return null;
    }

    return grid.join('');
}

// --- укладка -----------------------------------------------------------------

// Раскладывает слова словаря по слотам. Возвращает массив слов (слово на слот)
// или null, если не сошлось за отведённый бюджет узлов.
export function fillSlots({ slots, size, dict, rng, budget = 50000 }) {
    const letters = new Array(size).fill('');
    const chosen = new Array(slots.length).fill(null);
    const used = new Set();
    let nodes = 0;
    let filled = 0;

    const patternOf = (slot) => slot.cells.map((cell) => letters[cell]);

    const put = (slot, word) => {
        for (let pos = 0; pos < slot.length; pos++) letters[slot.cells[pos]] = word[pos];
    };
    const drop = (slot, before) => {
        for (let pos = 0; pos < slot.length; pos++) letters[slot.cells[pos]] = before[pos];
    };

    function step() {
        if (filled === slots.length) return true;
        if (++nodes > budget) return false;

        // MRV: самый стеснённый слот. Пустой список кандидатов — тупик, дальше
        // перебирать бессмысленно.
        let target = null;
        let best = null;
        for (const slot of slots) {
            if (chosen[slot.index] !== null) continue;
            const list = candidateWords(dict, slot.length, patternOf(slot), used, rng);
            if (list.length === 0) return false;
            if (best === null || list.length < best.length) {
                target = slot;
                best = list;
                if (list.length === 1) break;
            }
        }

        const before = patternOf(target);
        for (const word of best) {
            chosen[target.index] = word;
            used.add(word);
            put(target, word);
            filled++;
            if (step()) return true;
            filled--;
            drop(target, before);
            used.delete(word);
            chosen[target.index] = null;
            if (nodes > budget) return false;
        }
        return false;
    }

    return step() ? chosen : null;
}

// --- единственность ----------------------------------------------------------

// Сколько РАЗНЫХ раскладок этого банка укладывается в эту сетку. Считает точно,
// с ранним выходом на `limit`-й: игре достаточно знать «одна или больше».
export function countArrangements(slots, bank, size, limit = 2) {
    const letters = new Array(size).fill('');
    const taken = new Array(bank.length).fill(false);
    const done = new Array(slots.length).fill(false);
    const byLength = new Map();
    for (let i = 0; i < bank.length; i++) {
        if (!byLength.has(bank[i].length)) byLength.set(bank[i].length, []);
        byLength.get(bank[i].length).push(i);
    }

    let count = 0;
    let filled = 0;

    const fits = (slot, word) => {
        for (let pos = 0; pos < slot.length; pos++) {
            const ch = letters[slot.cells[pos]];
            if (ch && ch !== word[pos]) return false;
        }
        return true;
    };
    const optionsOf = (slot) => (byLength.get(slot.length) ?? [])
        .filter((i) => !taken[i] && fits(slot, bank[i]));

    // Возвращает true, когда пора остановиться: раскладок уже limit.
    function step() {
        if (filled === slots.length) {
            count++;
            return count >= limit;
        }

        let target = null;
        let best = null;
        for (const slot of slots) {
            if (done[slot.index]) continue;
            const list = optionsOf(slot);
            if (list.length === 0) return false;
            if (best === null || list.length < best.length) {
                target = slot;
                best = list;
                if (list.length === 1) break;
            }
        }

        const before = target.cells.map((cell) => letters[cell]);
        for (const word of best) {
            taken[word] = true;
            done[target.index] = true;
            filled++;
            for (let pos = 0; pos < target.length; pos++) letters[target.cells[pos]] = bank[word][pos];
            const stop = step();
            filled--;
            done[target.index] = false;
            taken[word] = false;
            for (let pos = 0; pos < target.length; pos++) letters[target.cells[pos]] = before[pos];
            if (stop) return true;
        }
        return false;
    }

    step();
    return count;
}

// --- головоломка целиком -----------------------------------------------------

// Возвращает { cols, rows, grid, words, solution, slots, grids, fills } или null.
// grids/fills — счётчики попыток, их печатает тест замеров.
// `preset` перебивает уровень целиком — нужен для подбора параметров и для тестов.
export function generatePuzzle({ level = 'easy', preset = null, dict, rng = Math.random, gridTries = GRID_TRIES, fillTries = FILL_TRIES } = {}) {
    preset = preset ?? levelFor(level);
    const size = preset.cols * preset.rows;
    let grids = 0;
    let fills = 0;

    for (let attempt = 0; attempt < gridTries; attempt++) {
        grids++;
        const grid = generateGrid({ ...preset, dict, rng });
        if (!grid) continue;

        const slots = slotsFromGrid(grid, preset.cols, preset.rows);

        for (let f = 0; f < fillTries; f++) {
            fills++;
            const chosen = fillSlots({ slots, size, dict, rng, budget: preset.budget });
            // Сетка не заполняется вовсе — пробовать её же ещё раз обычно
            // бессмысленно: берём новую.
            if (!chosen) break;

            // Банк отсортирован: порядок слов в файле не должен подсказывать ответ.
            const bank = [...chosen].sort();
            const solution = chosen.map((word) => bank.indexOf(word));

            if (countArrangements(slots, bank, size, 2) !== 1) continue;

            return {
                cols: preset.cols,
                rows: preset.rows,
                grid,
                words: bank.join(' '),
                solution: solution.join(','),
                slots: slots.length,
                grids,
                fills,
            };
        }
    }

    return null;
}

// --- загрузка словарей (только CLI) ------------------------------------------

function chunk(packed, length) {
    const out = [];
    for (let i = 0; i + length <= packed.length; i += length) out.push(packed.slice(i, i + length));
    return out;
}

export async function loadDictionary(path, defaultLength = 5) {
    const ext = extname(path).toLowerCase();

    if (ext === '.js' || ext === '.mjs') {
        const module = await import(pathToFileURL(resolve(path)).href);
        const data = module.default;
        if (Array.isArray(data)) return data;
        if (typeof data === 'string') return chunk(data, defaultLength);
        if (data && typeof data === 'object') {
            const words = [];
            for (const [key, value] of Object.entries(data)) {
                const length = Number(key);
                if (Array.isArray(value)) words.push(...value);
                else if (typeof value === 'string' && Number.isInteger(length)) words.push(...chunk(value, length));
            }
            if (words.length) return words;
        }
        throw new Error(`не понимаю формат словаря ${path}: нужен массив слов, объект «длина: слова» или строка + --length`);
    }

    return readFileSync(path, 'utf8').split(/\r?\n/);
}

// --- запись ------------------------------------------------------------------

const HEADER = `// Пул головоломок кроссворда-скелета: сетка, банк слов и решение.
//
// СГЕНЕРИРОВАНО tools/build-crossword.mjs — руками не править.
//
// Формат одной головоломки и правила разбора — src/games/crossword/core/puzzles.js.
// Коротко: grid — cols*rows символов, '.' клетка под букву и '#' блок; слоты
// выводятся из сетки, а не хранятся; words — банк через пробел; solution[i] —
// индекс слова банка, стоящего в слоте i.
//
// У каждой головоломки проверена ЕДИНСТВЕННОСТЬ раскладки: этот банк ложится
// в эту сетку ровно одним способом.
//
// Слова взяты из словаря, производного от OpenCorpora (http://opencorpora.org/),
// лицензия CC BY-SA 4.0. Как производное ЭТОТ ФАЙЛ распространяется под
// CC BY-SA 4.0, а не под лицензией остального репозитория. Подробности —
// src/games/crossword/data/NOTICE.
//
// Буквы «ё» в словаре нет: она всюду нормализована в «е».`;

export function renderPool(pool) {
    const lines = ['export default {', '    version: 1,', '    levels: {'];
    for (const [level, list] of Object.entries(pool)) {
        lines.push(`        ${level}: [`);
        for (const p of list) {
            lines.push('            {');
            lines.push(`                cols: ${p.cols}, rows: ${p.rows},`);
            lines.push(`                grid: '${p.grid}',`);
            lines.push(`                words: '${p.words}',`);
            lines.push(`                solution: '${p.solution}',`);
            lines.push('            },');
        }
        lines.push('        ],');
    }
    lines.push('    },', '};');
    return `${HEADER}\n${lines.join('\n')}\n`;
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
    const out = {
        count: 30,
        seed: 1,
        length: 5,
        levels: 'easy,medium,hard',
        out: join(ROOT, 'src/games/crossword/data/puzzles.js'),
    };
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i]?.replace(/^--/, '');
        const value = argv[i + 1];
        if (!key || value === undefined) usage(`неполный аргумент: ${argv[i]}`);
        if (key === 'count' || key === 'seed' || key === 'length') out[key] = Number(value);
        else out[key] = value;
    }
    if (!out.dict) usage('не указан --dict');
    return out;
}

function usage(message) {
    console.error(`Ошибка: ${message}\n`);
    console.error('node tools/build-crossword.mjs --dict <словарь[,словарь…]> \\');
    console.error('    [--levels easy,medium,hard] [--count 30] [--seed 1] [--length 5] [--out <файл>]');
    process.exit(1);
}

function log(message) {
    process.stdout.write(`${message}\n`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const words = [];
    for (const path of args.dict.split(',').filter(Boolean)) {
        const list = await loadDictionary(path, args.length);
        log(`Словарь ${path}: ${list.length} строк`);
        words.push(...list);
    }

    const dict = buildDictionary(words);
    log(`Слов после нормализации: ${dict.size}`);
    for (const [len, list] of [...dict.byLength].sort((a, b) => a[0] - b[0])) {
        log(`  длина ${len}: ${list.length}`);
    }

    const rng = mulberry32(args.seed);
    const pool = {};
    let failures = 0;

    for (const level of args.levels.split(',').filter(Boolean)) {
        if (!LEVELS[level]) usage(`неизвестный уровень: ${level}`);
        pool[level] = [];
        const started = Date.now();
        for (let i = 0; i < args.count; i++) {
            const puzzle = generatePuzzle({ level, dict, rng });
            if (!puzzle) { failures++; continue; }
            pool[level].push(puzzle);
        }
        const spent = (Date.now() - started) / 1000;
        const slots = pool[level].reduce((sum, p) => sum + p.slots, 0) / (pool[level].length || 1);
        log(`${level}: ${pool[level].length}/${args.count} за ${spent.toFixed(1)} с, слов в банке в среднем ${slots.toFixed(1)}`);
    }

    if (failures) log(`Не сошлось головоломок: ${failures} (мало слов нужных длин — расширьте словарь)`);

    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, renderPool(pool), 'utf8');
    log('');
    log(`Готово: ${args.out}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    await main();
}
