// Движок змейки: чистая логика над состоянием — ни DOM, ни таймеров, ни SillyTavern.
// Модуль детерминирован при переданном rng: тесты гоняют партии с фиксированным сидом,
// чтобы падение можно было повторить. В браузере игра создаёт rng от Math.random.

// mulberry32 скопирован из src/games/sudoku/core/rng.js, а не импортирован: кросс-игровая
// зависимость между core-модулями мешала бы добавлять третью игру одним файлом.
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

// Нечётные размеры — старт ровно по центру клетки; при ширине окна ~340 px клетка
// получается ~16 px: попадать пальцем в еду не нужно, важно лишь видеть её.
export const COLS = 21;
export const ROWS = 21;

// Интервал между тиками: каждая съеденная еда ускоряет игру, потолок скорости — на 17-й
// еде (170 − 6·17 = 68 < 70, дальше скорость уже не меняется).
export const START_MS = 170;
export const MIN_MS = 70;
export const SPEEDUP_MS = 6;

export function speedMs(state) {
    return Math.max(MIN_MS, START_MS - state.eaten * SPEEDUP_MS);
}

// Очки намеренно не равны длине: иначе «лучший счёт» и «лучшая длина» в статистике
// дублировали бы друг друга. Бонус за каждую пятую еду награждает за игру на высокой
// скорости, где дольше продержаться труднее.
export function createSnake({ cols = COLS, rows = ROWS, rng = Math.random } = {}) {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    const state = {
        cols,
        rows,
        snake: [
            { x: cx, y: cy },
            { x: cx - 1, y: cy },
            { x: cx - 2, y: cy },
        ],
        dir: { x: 1, y: 0 },
        queue: [],
        food: null,
        score: 0,
        eaten: 0,
        alive: true,
        won: false,
    };
    state.food = placeFood(state, rng);
    return state;
}

// Разворот на 180° запрещён относительно последнего направления в очереди, а не текущего
// dir: при двух поворотах за один тик (вверх, затем вниз) проверка по dir пропустила бы
// разворот в собственную шею. Очередь максимум 2 — второй поворот до следующего тика не
// теряется, но и не копится: на полной очереди новый поворот игнорируется, иначе быстрые
// тройные повороты могли бы заменить второй на противоположный первому и убить змейку.
export function setDirection(state, dir) {
    if (state.queue.length >= 2) return;
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (dir.x === -last.x && dir.y === -last.y) return;
    state.queue.push(dir);
}

// Список свободных клеток, а не «бросай пока не попадёшь»: на почти заполненном поле
// случайные броски крутились бы очень долго. Возвращает null, если свободных клеток нет.
export function placeFood(state, rng) {
    const occupied = new Set(state.snake.map((cell) => cell.y * state.cols + cell.x));
    const free = [];
    for (let y = 0; y < state.rows; y++) {
        for (let x = 0; x < state.cols; x++) {
            if (!occupied.has(y * state.cols + x)) free.push({ x, y });
        }
    }
    if (free.length === 0) return null;
    return free[Math.floor(rng() * free.length)];
}

// Один тик игры. Возвращает { moved, ate, dead, won } — флаги для озвучки и оверлея.
export function step(state, rng) {
    const dir = state.queue.length ? state.queue.shift() : state.dir;
    state.dir = dir;

    const head = state.snake[0];
    const newHead = { x: head.x + dir.x, y: head.y + dir.y };

    if (newHead.x < 0 || newHead.x >= state.cols || newHead.y < 0 || newHead.y >= state.rows) {
        state.alive = false;
        return { moved: false, ate: false, dead: true, won: state.won };
    }

    // Хвост остаётся на месте, только если змейка в этот тик ест: при поедании он
    // препятствие, в честном манёвре вдоль тела последняя клетка уже освободилась.
    const eating = state.food !== null && newHead.x === state.food.x && newHead.y === state.food.y;
    const body = eating ? state.snake : state.snake.slice(0, -1);
    if (body.some((cell) => cell.x === newHead.x && cell.y === newHead.y)) {
        state.alive = false;
        return { moved: false, ate: false, dead: true, won: state.won };
    }

    state.snake.unshift(newHead);

    if (eating) {
        state.eaten += 1;
        state.score += 1 + Math.floor((state.eaten - 1) / 5);
        const next = placeFood(state, rng);
        if (next === null) {
            state.food = null;
            state.won = true;
            state.alive = false;
            return { moved: true, ate: true, dead: false, won: true };
        }
        state.food = next;
        return { moved: true, ate: true, dead: false, won: state.won };
    }

    state.snake.pop();
    return { moved: true, ate: false, dead: false, won: state.won };
}
