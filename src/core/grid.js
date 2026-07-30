// Базовые операции над сеткой судоку. Чистый модуль: ни DOM, ни SillyTavern.
//
// Сетка — плоский массив из 81 числа, индекс = row * 9 + col, значение 0 = пусто.
// Плоский массив выбран сознательно: он же уходит в extensionSettings без конвертации
// (Фаза 4) и дёшево клонируется через slice().

export const SIZE = 9;
export const BOX = 3;
export const CELLS = SIZE * SIZE;
export const DIGITS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

// Маска всех девяти цифр: бит (d - 1) соответствует цифре d.
export const ALL_DIGITS_MASK = 0b111111111;

export const bitOf = (digit) => 1 << (digit - 1);

// --- Предвычисленные таблицы. Считаются один раз при загрузке модуля: солвер ходит по
// --- ним в горячем цикле, и пересчитывать row/col/box делением на каждом шаге накладно.

export const ROW_OF = new Uint8Array(CELLS);
export const COL_OF = new Uint8Array(CELLS);
export const BOX_OF = new Uint8Array(CELLS);

for (let idx = 0; idx < CELLS; idx++) {
    const row = Math.floor(idx / SIZE);
    const col = idx % SIZE;
    ROW_OF[idx] = row;
    COL_OF[idx] = col;
    BOX_OF[idx] = Math.floor(row / BOX) * BOX + Math.floor(col / BOX);
}

// 27 юнитов: 9 строк, 9 столбцов, 9 боксов. Каждый — массив из 9 индексов клеток.
export const ROW_UNITS = [];
export const COL_UNITS = [];
export const BOX_UNITS = [];

for (let i = 0; i < SIZE; i++) {
    ROW_UNITS.push([]);
    COL_UNITS.push([]);
    BOX_UNITS.push([]);
}
for (let idx = 0; idx < CELLS; idx++) {
    ROW_UNITS[ROW_OF[idx]].push(idx);
    COL_UNITS[COL_OF[idx]].push(idx);
    BOX_UNITS[BOX_OF[idx]].push(idx);
}

export const UNITS = Object.freeze([...ROW_UNITS, ...COL_UNITS, ...BOX_UNITS]);

// PEERS[idx] — 20 клеток, делящих с idx строку, столбец или бокс (без самой клетки).
export const PEERS = [];
for (let idx = 0; idx < CELLS; idx++) {
    const peers = new Set();
    for (const cell of ROW_UNITS[ROW_OF[idx]]) peers.add(cell);
    for (const cell of COL_UNITS[COL_OF[idx]]) peers.add(cell);
    for (const cell of BOX_UNITS[BOX_OF[idx]]) peers.add(cell);
    peers.delete(idx);
    PEERS.push(Array.from(peers));
}

// Число единичных битов в 9-битной маске кандидатов — тоже в таблицу: солвер зовёт это
// для каждой пустой клетки на каждом шаге рекурсии.
export const POPCOUNT = new Uint8Array(ALL_DIGITS_MASK + 1);
for (let mask = 1; mask <= ALL_DIGITS_MASK; mask++) {
    POPCOUNT[mask] = POPCOUNT[mask >> 1] + (mask & 1);
}

// Цифры, соответствующие битам маски, по возрастанию.
export function digitsOfMask(mask) {
    const out = [];
    for (let digit = 1; digit <= SIZE; digit++) {
        if (mask & bitOf(digit)) out.push(digit);
    }
    return out;
}

// --- Сетки

export function emptyGrid() {
    return new Array(CELLS).fill(0);
}

export function cloneGrid(grid) {
    return grid.slice();
}

export function countGivens(grid) {
    let n = 0;
    for (let idx = 0; idx < CELLS; idx++) if (grid[idx]) n++;
    return n;
}

export function isComplete(grid) {
    for (let idx = 0; idx < CELLS; idx++) if (!grid[idx]) return false;
    return true;
}

// Можно ли поставить value в клетку idx, не создав дубликата в её юнитах. Значение
// самой клетки игнорируется — проверяются только соседи.
export function isValidPlacement(grid, idx, value) {
    if (!value) return true;
    for (const peer of PEERS[idx]) {
        if (grid[peer] === value) return false;
    }
    return true;
}

// Индексы клеток, участвующих в конфликте (дубликат цифры в строке, столбце или боксе).
// Возвращается Set, потому что одна клетка может конфликтовать сразу по нескольким юнитам.
export function findConflicts(grid) {
    const conflicts = new Set();
    for (const unit of UNITS) {
        // seen[digit] — индекс первой встреченной клетки с этой цифрой в юните.
        const seen = new Map();
        for (const idx of unit) {
            const value = grid[idx];
            if (!value) continue;
            if (seen.has(value)) {
                conflicts.add(idx);
                conflicts.add(seen.get(value));
            } else {
                seen.set(value, idx);
            }
        }
    }
    return conflicts;
}

// Сетка заполнена целиком и без конфликтов.
export function isSolved(grid) {
    return isComplete(grid) && findConflicts(grid).size === 0;
}

// --- Сериализация: 81 символ, '.' или '0' = пустая клетка. Формат удобен для тестов,
// --- фикстур и отладочного вывода в консоль.

export function formatGrid(grid, emptyChar = '.') {
    let out = '';
    for (let idx = 0; idx < CELLS; idx++) {
        out += grid[idx] ? String(grid[idx]) : emptyChar;
    }
    return out;
}

export function parseGrid(text) {
    const chars = String(text).replace(/\s/g, '');
    if (chars.length !== CELLS) {
        throw new Error(`parseGrid: ожидалась 81 клетка, получено ${chars.length}`);
    }
    const grid = emptyGrid();
    for (let idx = 0; idx < CELLS; idx++) {
        const ch = chars[idx];
        if (ch === '.' || ch === '0' || ch === '-') {
            grid[idx] = 0;
            continue;
        }
        const digit = Number(ch);
        if (!Number.isInteger(digit) || digit < 1 || digit > SIZE) {
            throw new Error(`parseGrid: недопустимый символ '${ch}' в позиции ${idx}`);
        }
        grid[idx] = digit;
    }
    return grid;
}

// Читаемая раскладка 9×9 для отладки: боксы разделены пробелами и пустыми строками.
export function debugGrid(grid) {
    const lines = [];
    for (let row = 0; row < SIZE; row++) {
        const cells = [];
        for (let col = 0; col < SIZE; col++) {
            const value = grid[row * SIZE + col];
            cells.push(value ? String(value) : '.');
            if (col % BOX === BOX - 1 && col !== SIZE - 1) cells.push('|');
        }
        lines.push(cells.join(' '));
        if (row % BOX === BOX - 1 && row !== SIZE - 1) lines.push('------+-------+------');
    }
    return lines.join('\n');
}
