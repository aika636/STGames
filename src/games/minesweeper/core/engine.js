// Правила сапёра: открытие клетки, флажки, аккорд и конец партии. Чистый модуль без DOM
// и без SillyTavern — состояние мутируется на месте, как в змейке и реверси.
//
// Мины движок сам не расставляет: их приносит generator.js через plant(). Разделение не
// косметическое — расстановка зависит от первого клика (первый клик безопасен) и от
// режима «без угадывания», то есть от решателя; правилам игры про это знать нечего.
//
// Поле хранится плоскими типизированными массивами длины cols*rows, индекс — y*cols+x:
// такое состояние дёшево копировать и легко сериализовать в settings.json.

// Уровни живут в ядре, а не в settings.js: размер поля нужен и генератору, и решателю,
// а подписи для панели — уже в settings.js.
export const BOARDS = Object.freeze({
    easy: Object.freeze({ cols: 9, rows: 9, mines: 10 }),
    medium: Object.freeze({ cols: 12, rows: 12, mines: 20 }),
    hard: Object.freeze({ cols: 16, rows: 16, mines: 40 }),
});

export function boardFor(level) {
    return BOARDS[level] ?? BOARDS.easy;
}

export function idx(cols, x, y) {
    return y * cols + x;
}

// Соседи клетки (до восьми). Считаются на каждый запрос, а не кэшируются таблицей:
// поле максимум 256 клеток, а таблица соседей — ещё одно состояние, которое надо
// сериализовать и чинить после ручной правки settings.json.
export function neighbors(cols, rows, index) {
    const x = index % cols;
    const y = (index / cols) | 0;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            out.push(ny * cols + nx);
        }
    }
    return out;
}

export function createGame({ cols, rows, mines }) {
    const size = cols * rows;
    return {
        cols,
        rows,
        mines,
        mine: new Uint8Array(size),
        count: new Uint8Array(size),
        open: new Uint8Array(size),
        flag: new Uint8Array(size),
        // started — мины расставлены. До первого открытия поле пустое: игрок ещё не
        // выбрал клетку, вокруг которой оно строится.
        started: false,
        over: false,
        won: false,
        // Клетка, на которой партия взорвалась: экран подсвечивает именно её, а не все
        // мины разом.
        exploded: null,
        openedCount: 0,
        // Секунды. Таймер ведёт экран, но хранится время здесь: партия сериализуется
        // целиком, и время не должно жить отдельным ключом настроек.
        elapsed: 0,
    };
}

// Расставляет мины и считает числа. Зовётся ровно один раз за партию — из первого
// открытия, когда уже известна безопасная клетка.
export function plant(state, mineIndices) {
    state.mine.fill(0);
    state.count.fill(0);
    for (const index of mineIndices) state.mine[index] = 1;

    for (let i = 0; i < state.count.length; i++) {
        let n = 0;
        for (const j of neighbors(state.cols, state.rows, i)) n += state.mine[j];
        state.count[i] = n;
    }
    state.started = true;
    return state;
}

export function remainingMines(state) {
    let flags = 0;
    for (let i = 0; i < state.flag.length; i++) flags += state.flag[i];
    return state.mines - flags;
}

// Открывает клетку. Возвращает { ok, opened: [idx…], exploded, won }: список открытых
// клеток нужен экрану, чтобы перерисовать только их, а не всё поле.
//
// Мины к этому моменту должны быть расставлены: движок не решает, каким быть полю.
export function openCell(state, index) {
    const result = { ok: false, opened: [], exploded: false, won: false };
    if (state.over || !state.started) return result;
    if (index < 0 || index >= state.mine.length) return result;
    // Флажок — защита от промаха, и она обязана работать: клик по помеченной клетке
    // не открывает её. Иначе один неверный тап стоит партии.
    if (state.open[index] || state.flag[index]) return result;

    result.ok = true;

    if (state.mine[index]) {
        state.open[index] = 1;
        state.over = true;
        state.won = false;
        state.exploded = index;
        result.opened.push(index);
        result.exploded = true;
        return result;
    }

    flood(state, index, result.opened);
    checkWin(state);
    result.won = state.won;
    return result;
}

// Разлив по нулям — итеративно, стеком. Рекурсия на поле 16×16 не переполнит стек, но
// поле — единственное место, где размер задаётся настройками, и упереться в предел
// из-за настройки было бы обидно.
function flood(state, from, opened) {
    const stack = [from];
    while (stack.length) {
        const current = stack.pop();
        if (state.open[current] || state.flag[current]) continue;
        state.open[current] = 1;
        state.openedCount++;
        opened.push(current);
        if (state.count[current] !== 0) continue;
        for (const next of neighbors(state.cols, state.rows, current)) {
            if (!state.open[next] && !state.flag[next]) stack.push(next);
        }
    }
}

// Победа — когда открыты все клетки без мин. Флажки в условие не входят: расставлять их
// все ради победы игрока никто не заставляет.
function checkWin(state) {
    if (state.openedCount === state.mine.length - state.mines) {
        state.over = true;
        state.won = true;
        // Оставшиеся мины помечаются сами: счётчик мин на победе должен показывать ноль.
        for (let i = 0; i < state.mine.length; i++) {
            if (state.mine[i]) state.flag[i] = 1;
        }
    }
}

export function toggleFlag(state, index) {
    if (state.over || state.open[index]) return false;
    // Флажок до первого открытия разрешён: поля ещё нет, но игроку никто не мешает
    // пометить клетку — на расстановку мин это не влияет, она смотрит только на
    // первую открытую клетку.
    state.flag[index] = state.flag[index] ? 0 : 1;
    return true;
}

// Аккорд: клик по открытой цифре, вокруг которой уже стоит столько же флажков, открывает
// все остальные соседние клетки. Ошибочно расставленные флажки при этом взрывают партию —
// это часть механики, а не баг: аккорд стоит ровно столько, сколько стоит уверенность.
export function chord(state, index) {
    const result = { ok: false, opened: [], exploded: false, won: false };
    if (state.over || !state.started) return result;
    if (!state.open[index] || state.count[index] === 0) return result;

    const around = neighbors(state.cols, state.rows, index);
    let flags = 0;
    for (const j of around) flags += state.flag[j];
    if (flags !== state.count[index]) return result;

    for (const j of around) {
        if (state.open[j] || state.flag[j]) continue;
        const step = openCell(state, j);
        result.ok = result.ok || step.ok;
        result.opened.push(...step.opened);
        if (step.exploded) {
            result.exploded = true;
            return result;
        }
    }
    result.won = state.won;
    return result;
}

// Раскрытие поля после взрыва: мины видны, а неверные флажки помечены отдельно — без
// этого игрок не понимает, где именно ошибся. Возвращает список неверных флажков.
export function wrongFlags(state) {
    const wrong = [];
    for (let i = 0; i < state.flag.length; i++) {
        if (state.flag[i] && !state.mine[i]) wrong.push(i);
    }
    return wrong;
}

// --- Сохранение партии
//
// Пишем компактно: две строки из '0'/'1' и одна из цифр. settings.json игрок правит
// руками, поэтому deserialize обязан пережить мусор и вернуть null, а не бросить.

export function serialize(state) {
    return {
        cols: state.cols,
        rows: state.rows,
        mines: state.mines,
        started: state.started,
        over: state.over,
        won: state.won,
        exploded: state.exploded,
        elapsed: Math.max(0, Math.round(state.elapsed)),
        mine: bits(state.mine),
        open: bits(state.open),
        flag: bits(state.flag),
    };
}

function bits(array) {
    let out = '';
    for (let i = 0; i < array.length; i++) out += array[i] ? '1' : '0';
    return out;
}

function readBits(text, size, target) {
    if (typeof text !== 'string' || text.length !== size) return false;
    for (let i = 0; i < size; i++) {
        const ch = text[i];
        if (ch !== '0' && ch !== '1') return false;
        target[i] = ch === '1' ? 1 : 0;
    }
    return true;
}

export function deserialize(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const cols = Number(raw.cols);
    const rows = Number(raw.rows);
    const mines = Number(raw.mines);
    if (!isSize(cols) || !isSize(rows)) return null;
    const size = cols * rows;
    if (!Number.isInteger(mines) || mines < 1 || mines >= size) return null;

    const state = createGame({ cols, rows, mines });
    if (!readBits(raw.mine, size, state.mine)) return null;
    if (!readBits(raw.open, size, state.open)) return null;
    if (!readBits(raw.flag, size, state.flag)) return null;

    // Числа не сохраняются: они однозначно выводятся из мин, а дублирующее поле
    // разъехалось бы с ними после ручной правки файла.
    let planted = 0;
    for (let i = 0; i < size; i++) planted += state.mine[i];
    state.started = Boolean(raw.started) && planted === mines;
    if (state.started) {
        for (let i = 0; i < size; i++) {
            let n = 0;
            for (const j of neighbors(cols, rows, i)) n += state.mine[j];
            state.count[i] = n;
        }
    } else {
        // Поля ещё не было — открытых клеток тоже быть не может.
        state.mine.fill(0);
        state.open.fill(0);
    }

    let opened = 0;
    for (let i = 0; i < size; i++) {
        // Открытая мина в файле означает взрыв; открытых мин без конца партии не бывает.
        if (state.open[i] && state.mine[i] && !raw.over) state.open[i] = 0;
        if (state.open[i] && !state.mine[i]) opened++;
        // Открытая клетка не может быть помечена флажком.
        if (state.open[i]) state.flag[i] = 0;
    }
    state.openedCount = opened;

    state.elapsed = Number.isFinite(raw.elapsed) && raw.elapsed > 0 ? Math.floor(raw.elapsed) : 0;
    state.over = Boolean(raw.over);
    state.won = state.over && Boolean(raw.won);
    state.exploded = Number.isInteger(raw.exploded) && raw.exploded >= 0 && raw.exploded < size
        ? raw.exploded
        : null;

    // Состояние из файла могло оказаться уже выигранным — досчитываем честно, чтобы
    // экран не показывал «партия идёт» на полностью открытом поле.
    if (!state.over && state.started) checkWin(state);

    return state;
}

function isSize(value) {
    return Number.isInteger(value) && value >= 2 && value <= 40;
}
