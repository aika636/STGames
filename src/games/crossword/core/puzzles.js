// Формат головоломки кроссворда-скелета и разбор пула. Чистый модуль: ни DOM,
// ни SillyTavern, ни импортов из data/ — пул приходит параметром, чтобы ядро
// тестировалось без сгенерированных данных, а UI грузил их динамическим import().
//
// --- ФОРМАТ ------------------------------------------------------------------
//
// Головоломка хранится «как у нонограммы и сапёра» — строками, без вложенных
// массивов объектов. Одна головоломка в пуле:
//
//     {
//         cols: 7,
//         rows: 7,
//         grid: '..#....###.#...' + …,   // ровно cols*rows символов
//         words: 'АИСТ БАНК ВОДА',       // банк слов через пробел, отсортирован
//         solution: '2,0,1',             // для слота i — индекс слова в банке
//     }
//
// `grid` — сама сетка: '.' — клетка под букву, '#' — блок. Символы идут построчно,
// индекс клетки = y * cols + x.
//
// Списка слотов в файле НЕТ: он однозначно выводится из сетки (`slotsFromGrid`)
// точно так же, как подсказки нонограммы выводятся из картинки. Дублирующее поле
// после ручной правки settings.json разъехалось бы с сеткой.
//
// Слот — максимальный ряд открытых клеток длиной от MIN_WORD, по горизонтали
// (`across`) или по вертикали (`down`). Порядок слотов — построчный обход сетки,
// в каждой стартовой клетке сначала горизонтальный слот, потом вертикальный.
// Этот порядок и есть нумерация, на которую ссылается `solution`.
//
// `words` — банк: столько же слов, сколько слотов, все разные. Игрок раскладывает
// банк целиком, каждое слово ровно в один слот. `solution` — перестановка индексов
// банка: solution[i] — слово, которое стоит в слоте i.
//
// Пул целиком:
//
//     { version: 1, levels: { easy: [головоломка, …], medium: […], hard: […] } }
//
// Гарантия, которую даёт офлайн-генератор (tools/build-crossword.mjs): при данной
// сетке и данном банке раскладка ЕДИНСТВЕННА. Без неё игрок вправе разложить слова
// иначе, все пересечения сойдутся, а победа не засчитается.

export const OPEN = '.';
export const BLOCK = '#';

// Минимальная длина слова. Ряды из одной-двух клеток слотами не считаются:
// двухбуквенные слова в кроссвордах не используются.
export const MIN_WORD = 3;
export const MAX_SIDE = 25;

export const ACROSS = 'across';
export const DOWN = 'down';

export const LEVELS = Object.freeze(['easy', 'medium', 'hard']);

const WORD_RE = /^[А-Я]+$/;

function makeSlot(index, x, y, dir, length, cols) {
    const cells = [];
    for (let i = 0; i < length; i++) {
        cells.push(dir === ACROSS ? y * cols + x + i : (y + i) * cols + x);
    }
    return { index, x, y, dir, length, cells };
}

// Слоты по сетке. Единственный источник правды о нумерации слотов — и в генераторе,
// и в ядре, и в UI.
export function slotsFromGrid(grid, cols, rows) {
    const slots = [];
    const at = (x, y) => grid[y * cols + x];

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (at(x, y) !== OPEN) continue;

            if (x === 0 || at(x - 1, y) !== OPEN) {
                let len = 0;
                while (x + len < cols && at(x + len, y) === OPEN) len++;
                if (len >= MIN_WORD) slots.push(makeSlot(slots.length, x, y, ACROSS, len, cols));
            }

            if (y === 0 || at(x, y - 1) !== OPEN) {
                let len = 0;
                while (y + len < rows && at(x, y + len) === OPEN) len++;
                if (len >= MIN_WORD) slots.push(makeSlot(slots.length, x, y, DOWN, len, cols));
            }
        }
    }
    return slots;
}

// Обратная карта: клетка -> список { slot, pos } слотов, которые её накрывают.
// Клетка на пересечении попадает в два слота, обычная — в один.
export function cellSlotsFrom(slots, size) {
    const map = Array.from({ length: size }, () => []);
    for (const slot of slots) {
        for (let pos = 0; pos < slot.cells.length; pos++) {
            map[slot.cells[pos]].push({ slot: slot.index, pos });
        }
    }
    return map;
}

// Слот заданного направления, накрывающий клетку, или null. Нужен UI: тап по клетке
// должен выбрать слово, а не клетку.
export function slotAt(puzzle, cell, dir) {
    for (const ref of puzzle.cellSlots[cell] ?? []) {
        if (puzzle.slots[ref.slot].dir === dir) return puzzle.slots[ref.slot];
    }
    return null;
}

function toWords(raw) {
    if (typeof raw === 'string') return raw.split(' ').filter(Boolean);
    if (Array.isArray(raw)) return raw.map((w) => String(w));
    return null;
}

function toIndices(raw) {
    if (typeof raw === 'string') return raw.split(',').filter((s) => s !== '').map(Number);
    if (Array.isArray(raw)) return raw.map(Number);
    return null;
}

// Разбор и полная проверка головоломки. Возвращает разобранный объект или null:
// битые данные (ручная правка settings.json, полудописанный пул) не должны бросать.
export function parsePuzzle(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const cols = Number(raw.cols);
    const rows = Number(raw.rows);
    if (!isSide(cols) || !isSide(rows)) return null;

    const grid = raw.grid;
    if (typeof grid !== 'string' || grid.length !== cols * rows) return null;
    for (const ch of grid) {
        if (ch !== OPEN && ch !== BLOCK) return null;
    }

    const slots = slotsFromGrid(grid, cols, rows);
    if (slots.length === 0) return null;

    const cellSlots = cellSlotsFrom(slots, cols * rows);
    // Открытая клетка вне всех слотов — сетка, в которую нечего писать. Генератор
    // такие затирает блоками; если такая пришла — данные битые.
    for (let cell = 0; cell < grid.length; cell++) {
        if (grid[cell] === OPEN && cellSlots[cell].length === 0) return null;
    }

    const bank = toWords(raw.words);
    if (!bank || bank.length !== slots.length) return null;
    const seen = new Set();
    for (const word of bank) {
        if (!WORD_RE.test(word) || word.length < MIN_WORD) return null;
        // Повторы в банке запрещены: два одинаковых слова дают две «разные»
        // раскладки на пустом месте и ломают проверку единственности.
        if (seen.has(word)) return null;
        seen.add(word);
    }

    const order = toIndices(raw.solution);
    if (!order || order.length !== slots.length) return null;
    const used = new Set();
    for (const idx of order) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= bank.length || used.has(idx)) return null;
        used.add(idx);
    }

    // Решение обязано лечь в сетку: длины совпадают, пересечения сходятся.
    const letters = grid.split('').map((ch) => (ch === OPEN ? '' : BLOCK));
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const word = bank[order[i]];
        if (word.length !== slot.length) return null;
        for (let pos = 0; pos < slot.length; pos++) {
            const cell = slot.cells[pos];
            if (letters[cell] !== '' && letters[cell] !== word[pos]) return null;
            letters[cell] = word[pos];
        }
    }

    return {
        cols,
        rows,
        grid,
        slots,
        cellSlots,
        bank,
        solution: Int32Array.from(order),
        letters: letters.join(''),
    };
}

// Обратно в компактный вид — для записи пула и для сохранения партии.
export function serializePuzzle(puzzle) {
    return {
        cols: puzzle.cols,
        rows: puzzle.rows,
        grid: puzzle.grid,
        words: puzzle.bank.join(' '),
        solution: Array.from(puzzle.solution).join(','),
    };
}

export function levelPuzzles(pool, level) {
    const list = pool?.levels?.[level];
    return Array.isArray(list) ? list : [];
}

export function countPuzzles(pool, level) {
    return levelPuzzles(pool, level).length;
}

// Случайная головоломка уровня. Битые записи пропускаются, а не роняют партию;
// если уровня нет вовсе — фолбэк на первый непустой, как boardFor у нонограммы.
export function pickPuzzle(pool, level, rng = Math.random) {
    let list = levelPuzzles(pool, level);
    if (list.length === 0) {
        for (const other of LEVELS) {
            list = levelPuzzles(pool, other);
            if (list.length) break;
        }
    }
    if (list.length === 0) return null;

    const start = Math.floor(rng() * list.length) % list.length;
    for (let i = 0; i < list.length; i++) {
        const puzzle = parsePuzzle(list[(start + i) % list.length]);
        if (puzzle) return puzzle;
    }
    return null;
}

function isSide(value) {
    return Number.isInteger(value) && value >= MIN_WORD && value <= MAX_SIDE;
}
