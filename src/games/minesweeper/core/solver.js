// Детерминированный решатель сапёра: ходит по полю только теми выводами, которые
// человек делает без угадывания, и отвечает на единственный вопрос — берётся ли поле
// логикой целиком. Генератор в режиме «без угадывания» переставляет мины, пока ответ
// не станет «да».
//
// Чистый модуль без DOM. Настоящее поле решатель видит: он не играет, а проверяет —
// открывает клетку и сразу узнаёт её число, как игрок, который не ошибается.
//
// Правила вывода, ровно три:
//   1. Простое. У открытой цифры c с F известными минами и U неизвестными соседями:
//      c − F == 0 → все U безопасны; c − F == |U| → все U мины.
//   2. Подмножество. Для двух цифр A и B, у которых U(A) ⊆ U(B): в разнице U(B)\U(A)
//      ровно (need B − need A) мин. Ноль → разница безопасна, размер разницы → все мины.
//      Это тот самый вывод «1-2-1 у стенки», без которого поле почти всегда требует
//      угадывания в концовке.
//   3. Общий счёт. Если оставшихся мин ноль — безопасно всё неизвестное; если их ровно
//      столько же, сколько неизвестных клеток, — мины везде. Правило закрывает концовку,
//      где логика фронта уже молчит, а по счётчику мин всё однозначно.

import { neighbors } from './engine.js';

export const UNKNOWN = 0;
export const OPEN = 1;
export const MINE = 2;

// field — { cols, rows, mines, mine, count } (готовое поле из generator.js).
// Возвращает { solved, known }: known — карта выводов, она же удобна в тестах.
export function solveFrom(field, startIndex) {
    const { cols, rows, mines, mine, count } = field;
    const size = cols * rows;
    const known = new Uint8Array(size);

    // Соседи считаются один раз на прогон: решатель ходит по фронту десятки раз, и
    // пересчёт восьми индексов на каждый обход — заметная доля времени генерации.
    const around = new Array(size);
    for (let i = 0; i < size; i++) around[i] = neighbors(cols, rows, i);

    let openedSafe = 0;
    const safeTotal = size - mines;

    function open(index) {
        const stack = [index];
        while (stack.length) {
            const current = stack.pop();
            if (known[current] !== UNKNOWN) continue;
            // Открывать мину решателю нельзя: это уже не вывод, а проигрыш.
            if (mine[current]) return false;
            known[current] = OPEN;
            openedSafe++;
            if (count[current] !== 0) continue;
            for (const next of around[current]) {
                if (known[next] === UNKNOWN) stack.push(next);
            }
        }
        return true;
    }

    let knownMines = 0;
    function markMine(index) {
        if (known[index] !== UNKNOWN) return;
        known[index] = MINE;
        knownMines++;
    }

    if (!open(startIndex)) return { solved: false, known };

    let progress = true;
    while (progress && openedSafe < safeTotal) {
        progress = false;

        // Ограничения фронта: открытая цифра, у которой остались неизвестные соседи.
        const constraints = [];
        for (let i = 0; i < size; i++) {
            if (known[i] !== OPEN || count[i] === 0) continue;
            let need = count[i];
            const cells = [];
            for (const j of around[i]) {
                if (known[j] === MINE) need--;
                else if (known[j] === UNKNOWN) cells.push(j);
            }
            if (cells.length === 0) continue;
            constraints.push({ cells, need });
        }

        // Правило 1.
        for (const { cells, need } of constraints) {
            if (need === 0) {
                for (const j of cells) {
                    if (known[j] === UNKNOWN && !open(j)) return { solved: false, known };
                }
                progress = true;
            } else if (need === cells.length) {
                for (const j of cells) markMine(j);
                progress = true;
            }
        }
        if (progress) continue;

        // Правило 2. Пары перебираются целиком: ограничений на поле 16×16 — десятки,
        // и отбор «только соседних цифр» экономил бы меньше, чем стоил бы кодом.
        for (let a = 0; a < constraints.length && !progress; a++) {
            for (let b = 0; b < constraints.length; b++) {
                if (a === b) continue;
                const A = constraints[a];
                const B = constraints[b];
                if (A.cells.length >= B.cells.length) continue;
                if (!isSubset(A.cells, B.cells)) continue;

                const rest = B.cells.filter((j) => !A.cells.includes(j));
                const need = B.need - A.need;
                if (need === 0) {
                    for (const j of rest) {
                        if (known[j] === UNKNOWN && !open(j)) return { solved: false, known };
                    }
                    progress = true;
                } else if (need === rest.length) {
                    for (const j of rest) markMine(j);
                    progress = true;
                }
                if (progress) break;
            }
        }
        if (progress) continue;

        // Правило 3.
        const restMines = mines - knownMines;
        const unknown = [];
        for (let i = 0; i < size; i++) {
            if (known[i] === UNKNOWN) unknown.push(i);
        }
        if (unknown.length === 0) break;
        if (restMines === 0) {
            for (const j of unknown) {
                if (!open(j)) return { solved: false, known };
            }
            progress = true;
        } else if (restMines === unknown.length) {
            for (const j of unknown) markMine(j);
            progress = true;
        }
    }

    return { solved: openedSafe === safeTotal, known };
}

// Оба списка короткие (до восьми клеток), поэтому includes дешевле любого Set.
function isSubset(small, big) {
    for (const value of small) {
        if (!big.includes(value)) return false;
    }
    return true;
}
