// Тесты движка змейки и её статистики (Фаза 5). Чистое ядро, зависимостей нет.
// Запуск: node tests/snake/engine.test.mjs

import {
    COLS, MIN_MS, ROWS, SPEEDUP_MS, START_MS,
    createSnake, mulberry32, placeFood, setDirection, speedMs, step,
} from '../../src/games/snake/core/engine.js';
import {
    EMPTY_ENTRY, readStats, recordPlayed, recordResult, resetStats,
} from '../../src/games/snake/core/stats.js';
import { assert, assertEqual, report, test } from '../_harness.mjs';

console.log('snake engine');

test('движение на клетку в сторону dir', () => {
    const state = createSnake({ cols: 7, rows: 7, rng: mulberry32(1) });
    state.food = { x: 0, y: 0 }; // далеко от головы и вне траектории
    const head = state.snake[0];
    const res = step(state, mulberry32(2));

    assertEqual(state.snake[0].x, head.x + 1, 'голова сдвинулась вправо');
    assertEqual(state.snake[0].y, head.y, 'y не изменился');
    assertEqual(state.snake.length, 3, 'длина без еды не растёт');
    assert(res.moved && !res.ate && !res.dead && !res.won, 'флаги хода');
    assertEqual(state.score, 0, 'счёт не меняется');
});

test('поедание удлиняет и увеличивает счёт по формуле', () => {
    const state = createSnake({ cols: 21, rows: 21, rng: mulberry32(3) });
    for (let i = 0; i < 6; i++) {
        const head = state.snake[0];
        state.food = { x: head.x + 1, y: head.y };
        const res = step(state, mulberry32(4 + i));
        assert(res.ate, `съел ${i + 1}-ю еду`);
    }

    // Очки: eaten=6 даёт 1+1+1+1+1 за первые пять и 1+floor(5/5)=2 за шестую.
    assertEqual(state.snake.length, 9, 'длина выросла на 6');
    assertEqual(state.eaten, 6, 'съедено');
    assertEqual(state.score, 7, 'счёт по формуле 1 + floor((eaten-1)/5)');
});

test('стена убивает', () => {
    const state = createSnake({ cols: 5, rows: 5, rng: mulberry32(5) });
    state.food = { x: 0, y: 0 };
    state.snake = [{ x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }];
    state.dir = { x: 1, y: 0 };

    const res = step(state, mulberry32(6));
    assert(res.dead, 'удар в стену');
    assertEqual(state.alive, false, 'alive=false');
    assertEqual(state.snake[0].x, 4, 'голова не сдвинулась');
    assert(!res.won, 'не победа');
});

test('наезд на собственное тело убивает', () => {
    const state = createSnake({ cols: 5, rows: 5, rng: mulberry32(7) });
    state.food = { x: 0, y: 0 };
    // Впереди по ходу — собственная шея (3,2).
    state.snake = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }];
    state.dir = { x: 1, y: 0 };

    const res = step(state, mulberry32(8));
    assert(res.dead, 'врезался в себя');
    assertEqual(state.alive, false, 'alive=false');
});

test('движение в клетку уходящего хвоста не убивает', () => {
    const state = createSnake({ cols: 5, rows: 5, rng: mulberry32(9) });
    state.food = { x: 0, y: 0 };
    // Голова (2,2) шагает на хвост (1,2): клетка освобождается в этом же тике.
    state.snake = [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }];
    state.dir = { x: -1, y: 0 };

    const res = step(state, mulberry32(10));
    assert(!res.dead, 'хвост ушёл — манёвр законен');
    assertEqual(state.snake[0].x, 1, 'голова встала на место хвоста');
    assertEqual(state.snake[0].y, 2, 'y');
    assertEqual(state.snake.length, 4, 'длина та же');
});

test('разворот на 180° игнорируется', () => {
    const state = createSnake({ cols: 7, rows: 7, rng: mulberry32(11) });
    setDirection(state, { x: -1, y: 0 }); // назад, dir сейчас {x:1,y:0}
    assertEqual(state.queue.length, 0, 'разворот не попал в очередь');
});

test('разворот игнорируется относительно последнего направления в очереди', () => {
    const state = createSnake({ cols: 7, rows: 7, rng: mulberry32(12) });
    setDirection(state, { x: 0, y: -1 }); // вверх — в очередь
    setDirection(state, { x: 0, y: 1 }); // вниз — разворот от «вверх», хотя не от dir
    assertEqual(state.queue.length, 1, 'разворот отброшен');
    assertEqual(state.queue[0].x, 0, 'в очереди только вверх');
    assertEqual(state.queue[0].y, -1, '…вверх');
});

test('два поворота в очереди применяются по порядку', () => {
    const state = createSnake({ cols: 7, rows: 7, rng: mulberry32(13) });
    state.food = { x: 0, y: 0 };
    // За один «тик» игрок успел нажать вверх, затем влево.
    setDirection(state, { x: 0, y: -1 });
    setDirection(state, { x: -1, y: 0 });
    const head = state.snake[0];

    step(state, mulberry32(14));
    assertEqual(state.snake[0].x, head.x, 'первый ход: x');
    assertEqual(state.snake[0].y, head.y - 1, 'первый ход — вверх');

    step(state, mulberry32(15));
    assertEqual(state.snake[0].x, head.x - 1, 'второй ход — влево');
    assertEqual(state.snake[0].y, head.y - 1, 'второй ход: y');
});

test('очередь не растёт выше двух поворотов', () => {
    const state = createSnake({ cols: 7, rows: 7, rng: mulberry32(16) });
    setDirection(state, { x: 0, y: -1 }); // вверх
    setDirection(state, { x: -1, y: 0 }); // влево
    setDirection(state, { x: 0, y: 1 }); // вниз — при полной очереди игнорируется
    assertEqual(state.queue.length, 2, 'очередь не выросла');
    assertEqual(state.queue[0].x, 0, 'первый поворот сохранился');
    assertEqual(state.queue[0].y, -1, '…на вверх');
    assertEqual(state.queue[1].x, -1, 'второй поворот сохранился');
    assertEqual(state.queue[1].y, 0, '…на влево');
});

test('быстрые тройные повороты не вводят разворот на 180° в очередь', () => {
    const state = createSnake({ cols: 7, rows: 7, rng: mulberry32(16) });
    state.dir = { x: 1, y: 0 };
    setDirection(state, { x: 0, y: -1 }); // вверх
    setDirection(state, { x: -1, y: 0 }); // влево
    setDirection(state, { x: 0, y: 1 }); // вниз — игнорируется
    setDirection(state, { x: 0, y: 1 }); // вниз — всё ещё игнорируется
    assertEqual(state.queue.length, 2, 'очередь не выросла');
    const second = state.queue[1];
    assert(second.x !== 0 || second.y !== 1, 'второй поворот не стал противоположным первому');
});

test('speedMs монотонно падает и упирается в MIN_MS', () => {
    let prev = START_MS;
    for (let eaten = 0; eaten < 40; eaten++) {
        const s = speedMs({ eaten });
        assert(s <= prev, 'скорость не растёт');
        assert(s >= MIN_MS, 'не быстрее потолка');
        prev = s;
    }
    assertEqual(speedMs({ eaten: 0 }), START_MS, 'стартовая скорость');
    assertEqual(speedMs({ eaten: 16 }), 74, 'до потолка');
    assertEqual(speedMs({ eaten: 17 }), MIN_MS, 'потолок с 17-й еды');
    assertEqual(speedMs({ eaten: 100 }), MIN_MS, 'потолок держится');
});

test('placeFood не ставит еду в клетку змейки', () => {
    const rng = mulberry32(42);
    const state = createSnake({ cols: 5, rows: 5, rng });
    const all = [];
    for (let y = 0; y < state.rows; y++) {
        for (let x = 0; x < state.cols; x++) all.push({ x, y });
    }
    // Поле зажато: змейка занимает 20 из 25 клеток (порядок тела для placeFood не важен).
    state.snake = all.slice(0, 20);
    const free = all.slice(20);

    for (let i = 0; i < 50; i++) {
        const food = placeFood(state, rng);
        assert(food, 'свободная клетка есть');
        assert(free.some((c) => c.x === food.x && c.y === food.y), 'еда среди свободных');
    }
});

test('placeFood возвращает null на заполненном поле', () => {
    const rng = mulberry32(43);
    const state = createSnake({ cols: 3, rows: 3, rng });
    const all = [];
    for (let y = 0; y < state.rows; y++) {
        for (let x = 0; x < state.cols; x++) all.push({ x, y });
    }
    state.snake = all;
    assertEqual(placeFood(state, rng), null, 'свободных клеток нет');
});

test('заполненное поле: step() ставит won и не зацикливается', () => {
    const state = {
        cols: 3, rows: 3,
        // Змейка занимает 8 из 9 клеток, еда — последняя свободная, голова у еды.
        snake: [
            { x: 1, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1 }, { x: 0, y: 0 },
            { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 },
        ],
        dir: { x: 1, y: 0 },
        queue: [],
        food: { x: 2, y: 2 },
        score: 0, eaten: 0, alive: true, won: false,
    };

    const res = step(state, mulberry32(20));
    assert(res.ate, 'съел последнюю еду');
    assert(res.won && !res.dead, 'флаги победы');
    assertEqual(state.won, true, 'state.won');
    assertEqual(state.alive, false, 'alive=false');
    assertEqual(state.food, null, 'еды на поле больше нет');
    assertEqual(state.score, 1, 'счёт за последнюю еду');
});

test('одинаковый seed даёт одинаковые партии', () => {
    const play = (seed) => {
        const rng = mulberry32(seed);
        const state = createSnake({ rng });
        const history = [];
        const turns = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, null];
        for (let i = 0; i < 500 && state.alive; i++) {
            const pick = turns[Math.floor(rng() * turns.length)];
            if (pick) setDirection(state, pick);
            const res = step(state, rng);
            history.push(res.dead, res.won, res.ate, state.snake.length, state.score);
        }
        return history;
    };

    const first = play(2024);
    const second = play(2024);
    assertEqual(first.length, second.length, 'одинаковая длина партии');
    assertEqual(JSON.stringify(first), JSON.stringify(second), 'ходы идентичны');
    assert(JSON.stringify(first) !== JSON.stringify(play(1)), 'другой сид — другая партия');
});

test('статистика: пустая читается нулями', () => {
    const s = readStats({});
    assertEqual(s.played, 0, 'сыграно');
    assertEqual(s.bestScore, 0, 'лучший счёт');
    assertEqual(s.bestLength, 0, 'лучшая длина');
    assertEqual(EMPTY_ENTRY.played, 0, 'пустая запись');
});

test('статистика: readStats не создаёт запись в объекте', () => {
    const stats = {};
    readStats(stats);
    // Панель настроек отрисовывается при каждой загрузке ST; чтение не должно копить
    // пустые записи в settings.json.
    assertEqual(Object.keys(stats).length, 0, 'ключей после чтения');
});

test('статистика: recordPlayed считает заезды', () => {
    const stats = {};
    recordPlayed(stats);
    recordPlayed(stats);
    assertEqual(readStats(stats).played, 2, 'сыграно');
    assertEqual(readStats(stats).bestScore, 0, 'рекорд не вырос сам');
});

test('статистика: рекорды обновляются только при улучшении', () => {
    const stats = {};
    let r = recordResult(stats, { score: 10, length: 8 });
    assert(r.bestScore && r.bestLength, 'первый результат — рекорд');
    assertEqual(readStats(stats).bestScore, 10, 'лучший счёт');
    assertEqual(readStats(stats).bestLength, 8, 'лучшая длина');

    r = recordResult(stats, { score: 5, length: 9 });
    assert(!r.bestScore, 'хуже счёт — не рекорд');
    assert(r.bestLength, 'длина улучшилась');
    assertEqual(readStats(stats).bestScore, 10, 'счёт не испортился');
    assertEqual(readStats(stats).bestLength, 9, 'длина обновилась');
});

test('статистика: битые значения нормализуются, а не роняют чтение', () => {
    const stats = { played: 'много', bestScore: -5, bestLength: 2.7 };
    assertEqual(readStats(stats).played, 0, 'строка вместо числа');
    assertEqual(readStats(stats).bestScore, 0, 'отрицательное значение');
    assertEqual(readStats(stats).bestLength, 2, 'дробное округляется вниз');

    recordResult(stats, { score: 3, length: 4 });
    assertEqual(readStats(stats).bestScore, 3, 'запись починена на месте');
    assertEqual(readStats(stats).bestLength, 4, 'рекорд длины встал с нуля');
});

test('статистика: resetStats чистит объект на месте', () => {
    const stats = {};
    recordPlayed(stats);
    recordResult(stats, { score: 20, length: 15 });

    const same = resetStats(stats);
    // Ссылку на этот объект держит extensionSettings — подменять его новым нельзя.
    assert(same === stats, 'вернулся тот же объект');
    assertEqual(Object.keys(stats).length, 0, 'ключей после сброса');
    assertEqual(readStats(stats).played, 0, 'счётчики обнулены');
});

report('snake engine');
