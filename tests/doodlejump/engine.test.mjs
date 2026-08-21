// Тесты движка «Дудл Джампа» и его статистики (Фаза 1). Чистое ядро, зависимостей нет.
// Запуск: node tests/doodlejump/engine.test.mjs

import {
    CAMERA_ANCHOR, DIFFICULTY, GRAVITY, JUMP_VELOCITY, MAX_GAP, MAX_JUMP_HEIGHT, MOVE_SPEED,
    PLAYER_H, PLAYER_W, SPRING_GAP_BONUS, SPRING_MULT, STEP_MS, WORLD_W,
    advance, createGame, ensurePlatformsAbove, setDifficulty, setInput, setMovingPlatforms,
    stepOnce,
} from '../../src/games/doodlejump/core/engine.js';
import { mulberry32 } from '../../src/games/doodlejump/core/rng.js';
import {
    EMPTY_ENTRY, readStats, recordPlayed, recordResult, resetStats,
} from '../../src/games/doodlejump/core/stats.js';
import { assert, assertEqual, report, test } from '../_harness.mjs';

console.log('doodlejump engine');

const DT = STEP_MS / 1000;

function assertClose(actual, expected, eps, message) {
    if (!(Math.abs(actual - expected) <= eps)) {
        throw new Error(`${message || 'значения не совпали'}: получено ${actual}, ожидалось ~${expected}`);
    }
}

// Голое состояние для тестов физики: платформ нет, камера уже стоит ровно в своей опорной
// точке — значит, падение вниз её не двигает и генератор молчит.
function bareState({ worldH = 640 } = {}) {
    const state = createGame({ rng: mulberry32(7), worldH });
    state.platforms = [];
    state.cameraY = state.player.y - worldH * CAMERA_ANCHOR;
    state.player.vx = 0;
    state.player.vy = 0;
    return state;
}

test('партия начинается стоя на стартовой платформе под фигуркой', () => {
    const state = createGame({ rng: mulberry32(1) });
    const start = state.platforms.find((p) => p.y === state.world.h - 120);
    assert(start, 'стартовая платформа на месте');
    assertEqual(state.player.y, start.y - PLAYER_H, 'фигурка стоит вплотную над ней');
    assert(state.player.x + PLAYER_W > start.x && state.player.x < start.x + start.w, 'по горизонтали над платформой');
    assertEqual(state.alive, true, 'партия жива');
    assertEqual(state.score, 0, 'счёт с нуля');
    assert(state.platforms.length > 3, 'экран уже застелен платформами');
});

test('свободное падение: vy растёт на GRAVITY*dt каждый подшаг', () => {
    const state = bareState();
    for (let i = 1; i <= 10; i++) {
        const res = stepOnce(state);
        assert(!res.landed && !res.fell, 'в пустоте не за что зацепиться');
        assertClose(state.player.vy, GRAVITY * DT * i, 1e-9, `vy после ${i} подшагов`);
    }
});

test('приземление на normal мгновенно даёт JUMP_VELOCITY', () => {
    const state = bareState();
    state.platforms = [{ id: 1, x: 100, y: 500, w: 80, kind: 'normal' }];
    state.player.x = 120;
    state.player.y = 500 - PLAYER_H - 2;
    state.player.vy = 300;

    const res = stepOnce(state);
    assert(res.landed && !res.brokePlatform, 'флаг приземления');
    assertEqual(state.player.y, 500 - PLAYER_H, 'фигурка встала на верхнюю грань');
    assertEqual(state.player.vy, JUMP_VELOCITY, 'отскок обычной силы');
    assertEqual(state.landings, 1, 'приземление засчитано в счётчик платформ');
});

test('spring даёт прыжок в SPRING_MULT раз сильнее', () => {
    const state = bareState();
    state.platforms = [{ id: 1, x: 100, y: 500, w: 80, kind: 'spring' }];
    state.player.x = 120;
    state.player.y = 500 - PLAYER_H - 2;
    state.player.vy = 300;

    assert(stepOnce(state).landed, 'приземление');
    assertEqual(state.player.vy, JUMP_VELOCITY * SPRING_MULT, 'усиленный отскок');
});

test('crumbling подбрасывает один раз и помечается broken', () => {
    const state = bareState();
    const platform = { id: 1, x: 100, y: 500, w: 80, kind: 'crumbling' };
    state.platforms = [platform];
    state.player.x = 120;
    state.player.y = 500 - PLAYER_H - 2;
    state.player.vy = 300;

    const first = stepOnce(state);
    assert(first.landed && first.brokePlatform, 'первое приземление ломает платформу');
    assertEqual(platform.broken, true, 'флаг broken');
    assertEqual(state.player.vy, JUMP_VELOCITY, 'отскок обычной силы');

    // Второй заход: сломанная платформа в столкновениях больше не участвует.
    state.player.y = 500 - PLAYER_H - 2;
    state.player.vy = 300;
    const second = stepOnce(state);
    assert(!second.landed, 'сквозь сломанную платформу фигурка проваливается');
});

test('вверх сквозь платформу — не приземление', () => {
    const state = bareState();
    state.platforms = [{ id: 1, x: 100, y: 435, w: 120, kind: 'normal' }];
    state.player.x = 120;
    state.player.y = 400;
    state.player.vy = JUMP_VELOCITY;

    const res = stepOnce(state);
    assert(!res.landed, 'снизу вверх платформа не ловит');
    assert(state.player.vy < 0, 'фигурка продолжает лететь вверх');
    assertEqual(state.landings, 0, 'счётчик платформ не тронут');
});

test('свип ловит тонкую платформу, которую грубый шаг проскочил бы насквозь', () => {
    const state = bareState();
    state.platforms = [{ id: 1, x: 80, y: 300, w: 100, kind: 'normal' }];
    state.player.x = 100;
    state.player.y = 200;
    state.player.vy = 20000; // за один подшаг фигурка пролетает ~165 wu

    const before = state.player.y + PLAYER_H;
    const res = stepOnce(state);
    assert(before < 300, 'до шага фигурка была выше платформы');
    assert(res.landed, 'свип поймал пересечение верхней грани');
    assertEqual(state.player.y, 300 - PLAYER_H, 'фигурку прижало к платформе, а не оставило под ней');
    assertEqual(state.player.vy, JUMP_VELOCITY, 'отскок');
});

test('wrap по горизонтали в обе стороны', () => {
    const left = bareState();
    left.player.x = 1;
    left.player.vx = -MOVE_SPEED;
    setInput(left, -1);
    const yBefore = left.player.y;
    stepOnce(left);
    assertClose(left.player.x, 1 - MOVE_SPEED * DT + WORLD_W, 1e-9, 'ушёл влево — вышел справа');
    assertEqual(left.player.vx, -MOVE_SPEED, 'скорость от wrap не меняется');
    assertClose(left.player.y, yBefore + GRAVITY * DT * DT, 1e-9, 'по вертикали только гравитация');

    const right = bareState();
    right.player.x = WORLD_W - 1;
    right.player.vx = MOVE_SPEED;
    setInput(right, 1);
    stepOnce(right);
    assertClose(right.player.x, WORLD_W - 1 + MOVE_SPEED * DT - WORLD_W, 1e-9, 'ушёл вправо — вышел слева');
    assertEqual(right.player.vx, MOVE_SPEED, 'скорость от wrap не меняется');
});

test('проигрыш строго в тот подшаг, когда фигурка ушла ниже экрана', () => {
    const state = bareState();
    let steps = 0;
    while (state.alive && steps < 500) {
        stepOnce(state);
        steps++;
        const below = state.player.y - state.cameraY > state.world.h;
        assertEqual(state.alive, !below, `alive на подшаге ${steps}`);
    }
    assertEqual(state.alive, false, 'фигурка всё-таки упала');
    assert(steps > 50, 'падение заняло разумное время, а не один подшаг');
});

test('счёт монотонен: спуск после промаха его не уменьшает', () => {
    const state = createGame({ rng: mulberry32(11) });
    let previous = 0;
    let peak = 0;
    for (let i = 0; i < 4000 && state.alive; i++) {
        setInput(state, [1, 1, 0, -1, -1, 0][i % 6]);
        advance(state, 16);
        assert(state.score >= previous, `счёт не упал на кадре ${i}`);
        previous = state.score;
        peak = Math.max(peak, -state.cameraY);
    }
    assert(peak > 100, 'фигурка успела подняться, иначе тест ничего не проверяет');
    const finalScore = state.score;
    // После смерти шаги ничего не делают — счёт заморожен.
    for (let i = 0; i < 50; i++) advance(state, 16);
    assertEqual(state.score, finalScore, 'счёт после проигрыша не меняется');
});

test('камера не откатывается вниз', () => {
    const state = createGame({ rng: mulberry32(12) });
    let lowest = state.cameraY;
    for (let i = 0; i < 3000 && state.alive; i++) {
        advance(state, 16);
        assert(state.cameraY <= lowest, `камера поехала вниз на кадре ${i}`);
        lowest = state.cameraY;
    }
});

const KINDS = ['normal', 'moving', 'crumbling', 'spring'];

// Лестница снизу вверх, а не по индексу: «предыдущая» платформа — та, что ниже по высоте,
// кем бы она ни была сгенерирована.
function ladderOf(state) {
    return [...state.platforms].sort((a, b) => b.y - a.y);
}

// Единственная проверка достижимости: каждый следующий шаг лестницы не дальше, чем можно
// прыгнуть с предыдущего. С пружины прыгают выше — там и потолок другой.
function assertReachable(ladder, label) {
    for (let i = 1; i < ladder.length; i++) {
        const below = ladder[i - 1];
        const gap = below.y - ladder[i].y;
        const limit = below.kind === 'spring' ? MAX_GAP * SPRING_GAP_BONUS : MAX_GAP;
        assert(gap > 0, `${label}: платформы не слипаются в одну высоту`);
        assert(gap <= limit + 1e-9, `${label}: зазор ${gap} выше потолка ${limit}`);
    }
}

test('генератор строит только достижимые платформы на всех сложностях', () => {
    assert(MAX_GAP < MAX_JUMP_HEIGHT, 'рабочий зазор строго ниже физического потолка прыжка');
    // Даже раздутый пружиной зазор остаётся ниже физического потолка прыжка с пружины.
    assert(MAX_GAP * SPRING_GAP_BONUS < MAX_JUMP_HEIGHT * SPRING_MULT * SPRING_MULT, 'клапан пружины с запасом');

    for (const difficulty of ['easy', 'normal', 'hard']) {
        for (const seed of [1, 42, 2024]) {
            const state = createGame({ rng: mulberry32(seed), difficulty });
            ensurePlatformsAbove(state, -20000);
            const ladder = ladderOf(state);
            assert(ladder.length > 150, `${difficulty}/${seed}: платформ настелено достаточно`);
            assertReachable(ladder, `${difficulty}/${seed}`);
            for (const platform of ladder) {
                assert(platform.x >= 0 && platform.x + platform.w <= WORLD_W, `${difficulty}: платформа внутри экрана`);
                assert(KINDS.includes(platform.kind), `известный тип платформы: ${platform.kind}`);
            }
        }
    }
});

// Главный тест-регрессия Фазы 4. Рассыпающаяся платформа исчезает навсегда, и если бы она
// была единственной опорой этажа, неудачный заход обрывал бы лестницу насовсем: игра
// осталась бы «живой», но непроходимой — это ощущается как баг, а не как проигрыш.
test('лестница проходима, даже если все рассыпающиеся платформы уже рассыпались', () => {
    for (const difficulty of ['easy', 'normal', 'hard']) {
        for (const seed of [1, 42, 2024, 77]) {
            const state = createGame({ rng: mulberry32(seed), difficulty });
            ensurePlatformsAbove(state, -20000);

            const ladder = ladderOf(state);
            const crumbling = ladder.filter((p) => p.kind === 'crumbling');
            assert(crumbling.length > 5, `${difficulty}/${seed}: рассыпающиеся вообще генерируются`);

            // Худший случай: игрок наступил на каждую хрупкую платформу и все они пропали.
            const survivors = ladder.filter((p) => p.kind !== 'crumbling');
            assertReachable(survivors, `${difficulty}/${seed} без хрупких`);

            // И ни одна из них не была единственной платформой своего «этажа»: под каждой
            // есть живая опора не дальше MAX_GAP, и над ней — тоже.
            for (const broken of crumbling) {
                const below = survivors.filter((p) => p.y > broken.y).sort((a, b) => a.y - b.y)[0];
                const above = survivors.filter((p) => p.y < broken.y).sort((a, b) => b.y - a.y)[0];
                assert(below && below.y - broken.y <= MAX_GAP + 1e-9, `${difficulty}/${seed}: живая опора под хрупкой`);
                assert(above && broken.y - above.y <= MAX_GAP + 1e-9, `${difficulty}/${seed}: живая опора над хрупкой`);
            }
        }
    }
});

test('пружина появляется и раздувает зазор над собой, но только над собой', () => {
    const state = createGame({ rng: mulberry32(4), difficulty: 'hard' });
    ensurePlatformsAbove(state, -40000);
    const ladder = ladderOf(state);
    const springs = ladder.filter((p) => p.kind === 'spring');
    assert(springs.length > 10, `пружины генерируются: ${springs.length}`);

    let stretched = 0;
    for (let i = 1; i < ladder.length; i++) {
        const gap = ladder[i - 1].y - ladder[i].y;
        if (gap > MAX_GAP + 1e-9) {
            assertEqual(ladder[i - 1].kind, 'spring', 'зазор шире обычного бывает только над пружиной');
            stretched += 1;
        }
    }
    assert(stretched > 0, 'клапан давления действительно срабатывает, а не простаивает');
});

test('доли типов платформ растут со сложностью', () => {
    assert(DIFFICULTY.hard.crumblingChance > DIFFICULTY.normal.crumblingChance, 'на сложной хрупких больше');
    assert(DIFFICULTY.normal.crumblingChance > DIFFICULTY.easy.crumblingChance, 'на лёгкой хрупких меньше');
    for (const key of ['easy', 'normal', 'hard']) {
        const rules = DIFFICULTY[key];
        const sum = rules.movingChance + rules.crumblingChance + rules.springChance;
        assert(sum < 0.8, `${key}: обычным платформам остаётся большая часть этажей (сумма ${sum})`);
    }

    // Доли — не декларация, а факт: считаем по настеленному полю.
    const share = (difficulty, kind) => {
        const state = createGame({ rng: mulberry32(99), difficulty });
        ensurePlatformsAbove(state, -60000);
        const all = state.platforms;
        return all.filter((p) => p.kind === kind).length / all.length;
    };
    assert(share('hard', 'crumbling') > share('easy', 'crumbling'), 'хрупких на сложной фактически больше');
    assert(share('easy', 'crumbling') > 0, 'на лёгкой они всё же встречаются');
});

test('сложность — живая настройка: читается на каждом ensurePlatformsAbove', () => {
    const state = createGame({ rng: mulberry32(5), difficulty: 'easy' });
    ensurePlatformsAbove(state, -3000);
    const easyWidth = state.platforms[state.platforms.length - 1].w;

    const boundary = state.nextPlatformY;
    setDifficulty(state, 'hard');
    ensurePlatformsAbove(state, -6000);
    const hardWidth = state.platforms[state.platforms.length - 1].w;

    assert(hardWidth < easyWidth, 'новые платформы стали уже');
    // Уже настеленное поле не переписывается — сменилось только то, что выше границы.
    const oldOnes = state.platforms.filter((p) => p.y >= boundary);
    assert(oldOnes.every((p) => p.w === easyWidth), 'старые платформы остались прежними');
});

test('movingPlatforms=false убирает движущиеся платформы из генератора', () => {
    const off = createGame({ rng: mulberry32(3), difficulty: 'hard', movingPlatforms: false });
    ensurePlatformsAbove(off, -8000);
    // Выключен ровно один тип: хрупкие и пружины настройка не трогает — она про
    // движущиеся платформы, а не про «только обычные».
    assert(off.platforms.every((p) => p.kind !== 'moving'), 'ни одной moving');

    setMovingPlatforms(off, true);
    ensurePlatformsAbove(off, -16000);
    assert(off.platforms.some((p) => p.kind === 'moving'), 'после включения moving появились');
});

test('движущаяся платформа отражается от краёв и не выезжает за экран', () => {
    const state = bareState();
    state.platforms = [
        { id: 1, x: 10, y: 5000, w: 60, kind: 'moving', vx: 240 },
        { id: 2, x: 330, y: 5100, w: 60, kind: 'moving', vx: -240 },
    ];
    let bounced = false;
    for (let i = 0; i < 2000; i++) {
        // Платформы стоят далеко внизу и фигурке не мешают; держим её на месте, чтобы она
        // не улетела за нижний край и не остановила симуляцию.
        state.player.y = state.cameraY + 100;
        state.player.vy = 0;
        const before = state.platforms[0].vx;
        stepOnce(state);
        if (state.platforms[0].vx !== before) bounced = true;
        for (const platform of state.platforms) {
            assert(platform.x >= -1e-9, 'левый край');
            assert(platform.x + platform.w <= WORLD_W + 1e-9, 'правый край');
        }
    }
    assert(bounced, 'платформа успела отразиться хотя бы раз');
});

test('advance не уходит в спираль смерти при огромном dtMs', () => {
    const state = createGame({ rng: mulberry32(9) });
    const res = advance(state, 600000); // вкладка была свёрнута десять минут
    assert(res.steps > 0 && res.steps <= 8, `подшагов за кадр: ${res.steps}`);
    assert(state.alive, 'фигурка не умерла от накопленного времени');
});

test('одинаковый seed даёт одинаковые партии', () => {
    const play = (seed) => {
        const state = createGame({ rng: mulberry32(seed) });
        const history = [];
        for (let i = 0; i < 2000 && state.alive; i++) {
            setInput(state, [1, 1, 0, -1, -1, 0][i % 6]);
            const res = advance(state, 16);
            history.push(
                state.player.x, state.player.y, state.player.vy,
                state.score, state.landings, state.platforms.length,
                res.landed, res.fell,
            );
        }
        return history;
    };

    const first = play(2024);
    const second = play(2024);
    assertEqual(first.length, second.length, 'одинаковая длина партии');
    assertEqual(JSON.stringify(first), JSON.stringify(second), 'кадры идентичны');
    assert(JSON.stringify(first) !== JSON.stringify(play(7)), 'другой сид — другая партия');
});

test('статистика: пустая читается нулями', () => {
    const s = readStats({});
    assertEqual(s.played, 0, 'сыграно');
    assertEqual(s.bestScore, 0, 'лучшая высота');
    assertEqual(s.bestPlatforms, 0, 'лучший заезд по платформам');
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
    let r = recordResult(stats, { score: 1200, platforms: 30 });
    assert(r.bestScore && r.bestPlatforms, 'первый результат — рекорд');
    assertEqual(readStats(stats).bestScore, 1200, 'лучшая высота');
    assertEqual(readStats(stats).bestPlatforms, 30, 'лучший заезд по платформам');

    r = recordResult(stats, { score: 900, platforms: 41 });
    assert(!r.bestScore, 'хуже высота — не рекорд');
    assert(r.bestPlatforms, 'платформы улучшились');
    assertEqual(readStats(stats).bestScore, 1200, 'высота не испортилась');
    assertEqual(readStats(stats).bestPlatforms, 41, 'платформы обновились');
});

test('статистика: битые значения нормализуются, а не роняют чтение', () => {
    const stats = { played: 'много', bestScore: -5, bestPlatforms: 2.7 };
    assertEqual(readStats(stats).played, 0, 'строка вместо числа');
    assertEqual(readStats(stats).bestScore, 0, 'отрицательное значение');
    assertEqual(readStats(stats).bestPlatforms, 2, 'дробное округляется вниз');

    recordResult(stats, { score: 3, platforms: 4 });
    assertEqual(readStats(stats).bestScore, 3, 'запись починена на месте');
    assertEqual(readStats(stats).bestPlatforms, 4, 'рекорд платформ встал с нуля');
});

test('статистика: resetStats чистит объект на месте', () => {
    const stats = {};
    recordPlayed(stats);
    recordResult(stats, { score: 2000, platforms: 55 });

    const same = resetStats(stats);
    // Ссылку на этот объект держит extensionSettings — подменять его новым нельзя.
    assert(same === stats, 'вернулся тот же объект');
    assertEqual(Object.keys(stats).length, 0, 'ключей после сброса');
    assertEqual(readStats(stats).played, 0, 'счётчики обнулены');
});

report('doodlejump engine');
