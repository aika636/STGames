// Решатель нонограммы по линиям. Чистый модуль без DOM: на вход — подсказки и то, что
// уже известно про клетки, на выходе — то, что из этого следует однозначно.
//
// Ключевая функция — solveLine: она перебирает все раскладки блоков, укладывающиеся в
// линию с учётом уже известных клеток, и оставляет клетке значение, только если оно
// одинаково во всех раскладках. Перебор идёт не в лоб (раскладок бывают тысячи), а
// динамикой по состояниям «клетка i, блок j»:
//   can[j][i]   — хвост подсказок j… помещается в хвост линии i…;
//   reach[j][i] — состояние достижимо из начала линии.
// Переход участвует хотя бы в одном полном решении тогда и только тогда, когда исходное
// состояние достижимо, а целевое — заполнимо до конца. Отсюда и берутся «может быть
// закрашена» / «может быть пуста» для каждой клетки.
//
// Такой решатель важен не только для подсказок в игре: генератор принимает картинку,
// только если она берётся этими же выводами. Нонограмма, требующая перебора с возвратом,
// человеку не решается — она угадывается.

export const UNKNOWN = 0;
export const FILLED = 1;
export const EMPTY = 2;

// Подсказки одной линии по её клеткам: длины подряд идущих закрашенных участков.
// Пустая линия даёт [0] — так её подпись читается как «ноль», а не как пустое место.
export function lineClues(cells) {
    const out = [];
    let run = 0;
    for (const cell of cells) {
        if (cell === FILLED) {
            run++;
        } else if (run > 0) {
            out.push(run);
            run = 0;
        }
    }
    if (run > 0) out.push(run);
    return out.length ? out : [0];
}

// Подсказки всей картинки: solution — плоский массив 0/1 длины cols*rows.
export function cluesFromGrid(solution, cols, rows) {
    const rowClues = [];
    for (let y = 0; y < rows; y++) {
        const line = [];
        for (let x = 0; x < cols; x++) line.push(solution[y * cols + x] ? FILLED : EMPTY);
        rowClues.push(lineClues(line));
    }

    const colClues = [];
    for (let x = 0; x < cols; x++) {
        const line = [];
        for (let y = 0; y < rows; y++) line.push(solution[y * cols + x] ? FILLED : EMPTY);
        colClues.push(lineClues(line));
    }

    return { rowClues, colClues };
}

// Нормализованные подсказки для перебора: [0] означает «блоков нет».
function blocksOf(clues) {
    return clues.length === 1 && clues[0] === 0 ? [] : clues;
}

// Возвращает новый массив клеток линии или null, если подсказки противоречат уже
// известному. Вход не мутируется: решатель сравнивает «было» и «стало», чтобы понять,
// был ли прогресс.
export function solveLine(clues, cells) {
    const blocks = blocksOf(clues);
    const n = cells.length;
    const k = blocks.length;

    // can[j][i] — блоки j… укладываются в клетки i…
    const can = [];
    for (let j = 0; j <= k; j++) can.push(new Uint8Array(n + 1));

    // Все блоки расставлены: хвост линии обязан быть свободен от закрашенных клеток.
    can[k][n] = 1;
    for (let i = n - 1; i >= 0; i--) {
        can[k][i] = cells[i] === FILLED ? 0 : can[k][i + 1];
    }

    for (let j = k - 1; j >= 0; j--) {
        const len = blocks[j];
        for (let i = n; i >= 0; i--) {
            let ok = 0;
            // Клетка i пуста, блок j начинается позже.
            if (i < n && cells[i] !== FILLED && can[j][i + 1]) ok = 1;
            // Блок j стоит на i.
            if (!ok && fits(cells, i, len) && can[j + 1][Math.min(n, i + len + 1)]) {
                // После блока обязателен разделитель — клетка i+len не должна быть
                // закрашена (за краем линии разделитель не нужен).
                if (i + len >= n || cells[i + len] !== FILLED) ok = 1;
            }
            can[j][i] = ok;
        }
    }

    if (!can[0][0]) return null;

    // Прямой проход: отмечаем, какие значения клетка может принимать в раскладках,
    // которые доживают до конца линии.
    const reach = [];
    for (let j = 0; j <= k; j++) reach.push(new Uint8Array(n + 1));
    reach[0][0] = 1;

    const canFill = new Uint8Array(n);
    const canEmpty = new Uint8Array(n);

    for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= k; j++) {
            if (!reach[j][i]) continue;
            if (i === n) continue;

            // Клетка пуста.
            if (cells[i] !== FILLED && can[j][i + 1]) {
                canEmpty[i] = 1;
                reach[j][i + 1] = 1;
            }

            // На клетке начинается блок j.
            if (j < k) {
                const len = blocks[j];
                const after = i + len;
                const gapOk = after >= n || cells[after] !== FILLED;
                const next = Math.min(n, after + 1);
                if (fits(cells, i, len) && gapOk && can[j + 1][next]) {
                    for (let c = i; c < after; c++) canFill[c] = 1;
                    if (after < n) canEmpty[after] = 1;
                    reach[j + 1][next] = 1;
                }
            }
        }
    }

    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (canFill[i] && canEmpty[i]) out[i] = UNKNOWN;
        else if (canFill[i]) out[i] = FILLED;
        else if (canEmpty[i]) out[i] = EMPTY;
        else return null;
    }
    return out;
}

// Блок длины len помещается на позицию i: не свисает за край и не накрывает клеток,
// про которые уже известно, что они пусты.
function fits(cells, i, len) {
    if (i + len > cells.length) return false;
    for (let c = i; c < i + len; c++) {
        if (cells[c] === EMPTY) return false;
    }
    return true;
}

// Решает всю картинку, гоняя solveLine по строкам и столбцам до тех пор, пока
// появляются новые клетки. Возвращает { grid, solved, contradiction }:
//   solved === true  — картинка восстанавливается однозначно, без перебора с возвратом;
//   contradiction    — подсказки несовместимы (в игре так быть не должно, но генератор
//                      обязан это увидеть, а не зациклиться).
//
// Порядок обхода — все строки, затем все столбцы: очередь «грязных» линий на поле 15×15
// экономила бы доли миллисекунды, а стоила бы отдельного состояния.
export function solveGrid({ cols, rows, rowClues, colClues }) {
    const grid = new Uint8Array(cols * rows);

    let changed = true;
    while (changed) {
        changed = false;

        for (let y = 0; y < rows; y++) {
            const line = new Uint8Array(cols);
            for (let x = 0; x < cols; x++) line[x] = grid[y * cols + x];
            const solved = solveLine(rowClues[y], line);
            if (!solved) return { grid, solved: false, contradiction: true };
            for (let x = 0; x < cols; x++) {
                if (solved[x] !== grid[y * cols + x]) {
                    grid[y * cols + x] = solved[x];
                    changed = true;
                }
            }
        }

        for (let x = 0; x < cols; x++) {
            const line = new Uint8Array(rows);
            for (let y = 0; y < rows; y++) line[y] = grid[y * cols + x];
            const solved = solveLine(colClues[x], line);
            if (!solved) return { grid, solved: false, contradiction: true };
            for (let y = 0; y < rows; y++) {
                if (solved[y] !== grid[y * cols + x]) {
                    grid[y * cols + x] = solved[y];
                    changed = true;
                }
            }
        }
    }

    const solved = grid.every((cell) => cell !== UNKNOWN);
    return { grid, solved, contradiction: false };
}
