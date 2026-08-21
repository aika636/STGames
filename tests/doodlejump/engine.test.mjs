// Тесты движка «Дудл Джампа» и его статистики (Фаза 1). Чистое ядро, зависимостей нет.
// Запуск: node tests/doodlejump/engine.test.mjs

import {
    BOOST, CAMERA_ANCHOR, DIFFICULTY, GRAVITY, JUMP_VELOCITY, MAX_GAP, MAX_JUMP_HEIGHT,
    MOVE_SPEED, PICKUP_H, PICKUP_W, PLAYER_H, PLAYER_W, SPRING_GAP_BONUS, SPRING_MULT,
    STEP_MS, WORLD_W,
    advance, createGame, ensurePlatformsAbove, setBoosters, setDifficulty, setInput,
    setMovingPlatforms, stepOnce,
} from '../../src/games/doodlejump/core/engine.js';
import { mulberry32 } from '../../src/games/doodlejump/core/rng.js';
import {
    EMPTY_ENTRY, readStats, recordPlayed, recordResult, resetStats,
} from '../../src/games/doodlejump/core/stats.js';
import {
    DEFAULT_SKIN, addCoins, readSkins, readWallet,
} from '../../src/games/doodlejump/core/wallet.js';
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

// Свип по горизонтали (docs/plan-doodlejump-fixes.md §C). Отдельный подшаг с огромной vx —
// не имитация игры, а способ развести начало и конец подшага дальше ширины платформы:
// на боевых MOVE_SPEED окно промаха всего 3.5 wu, и в тесте оно тонуло бы в допуске.
test('свип по x ловит платформу, мимо которой фигурка проехала за один подшаг', () => {
    const state = bareState();
    state.platforms = [{ id: 1, x: 200, y: 300, w: 20, kind: 'normal' }];
    state.player.x = 150;
    state.player.y = 300 - PLAYER_H;
    state.player.vy = 100;
    state.player.vx = 10000;
    setInput(state, 1);

    const beforeX = state.player.x;
    const res = stepOnce(state);
    assert(beforeX + PLAYER_W < 200, 'до подшага фигурка была целиком левее платформы');
    assert(state.player.x > 220, 'после подшага — целиком правее');
    assert(res.landed, 'отрезок траектории пересёк платформу — приземление засчитано');
    assertEqual(state.player.y, 300 - PLAYER_H, 'фигурку прижало к платформе');
});

test('свип по x работает через wrap', () => {
    const state = bareState();
    state.platforms = [{ id: 1, x: 5, y: 300, w: 40, kind: 'normal' }];
    state.player.x = 350;
    state.player.y = 300 - PLAYER_H;
    state.player.vy = 100;
    state.player.vx = 20000;
    setInput(state, 1);

    const res = stepOnce(state);
    assert(state.player.x > 100, 'фигурка вышла слева и уехала правее платформы');
    assert(res.landed, 'платформа найдена в копии, сдвинутой на WORLD_W');
});

test('приземление на движущуюся платформу даёт фигурке её скорость', () => {
    const state = bareState();
    state.platforms = [{ id: 1, x: 100, y: 300, w: 120, kind: 'moving', vx: 60 }];
    state.player.x = 140;
    state.player.y = 300 - PLAYER_H;
    state.player.vy = 100;
    state.player.vx = 0;
    setInput(state, 0);

    const res = stepOnce(state);
    assert(res.landed, 'приземление засчитано');
    assertClose(state.player.vx, 60, 1e-9, 'платформа подтолкнула фигурку');
});

test('допуск по краю не превращает платформу в магнит', () => {
    const state = bareState();
    state.platforms = [{ id: 1, x: 100, y: 300, w: 60, kind: 'normal' }];
    state.player.x = 180; // левый край фигурки в 20 wu правее правого края платформы
    state.player.y = 300 - PLAYER_H;
    state.player.vy = 100;
    setInput(state, 0);

    const res = stepOnce(state);
    assert(!res.landed, 'до платформы явно не долетели — приземления нет');
    assertEqual(state.landings, 0, 'счётчик платформ не тронут');
});

// Аналоговое намерение (docs/plan-doodlejump-fixes.md §D.2): клавиатура и кнопки шлют ±1,
// ведение пальцем — долю. Схлопывание в знак убило бы всю тонкую подводку.
test('дробное намерение даёт долю максимальной скорости', () => {
    const state = bareState();
    setInput(state, 0.4);
    assertClose(state.input.dir, 0.4, 1e-9, 'значение сохранено как есть');

    // Разгон занимает ~0.15 с; 60 подшагов (0.5 с) — с запасом до целевой скорости.
    for (let i = 0; i < 60; i++) stepOnce(state);
    assertClose(state.player.vx, 0.4 * MOVE_SPEED, 1e-6, 'скорость — 40% от максимума');
});

test('намерение за пределами [-1, 1] кламплется', () => {
    const state = bareState();
    setInput(state, 5);
    assertEqual(state.input.dir, 1, 'сверху');
    setInput(state, -5);
    assertEqual(state.input.dir, -1, 'снизу');
});

test('мусор в намерении гасится в ноль и не ломает партию', () => {
    const state = bareState();
    setInput(state, 1);
    setInput(state, NaN);
    assertEqual(state.input.dir, 0, 'NaN — это ноль');
    setInput(state, undefined);
    assertEqual(state.input.dir, 0, 'undefined — тоже');

    stepOnce(state);
    assert(Number.isFinite(state.player.x), 'координата осталась числом');
    assert(Number.isFinite(state.player.vx), 'скорость осталась числом');
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
    // Сид подобран под этот сценарий: заезд по скрипту выше должен и подняться, и
    // кончиться падением, иначе проверять нечего.
    const state = createGame({ rng: mulberry32(14) });
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

// --- Бустеры (docs/plan-doodlejump-fixes.md §F) -------------------------------------

// Голое состояние с одним предметом под рукой: генератор в этих тестах не участвует,
// проверяется физика подбора и полёта.
function withPickup(kind, { x = 180, y = 400 } = {}) {
    const state = bareState();
    state.pickups = [{ id: 1, kind, x, y, w: PICKUP_W }];
    state.player.x = x;
    state.player.y = y;
    return state;
}

test('подбор ставит бустер и объявляется тиковым флагом', () => {
    const state = withPickup('propeller');
    assertEqual(state.player.boost, null, 'до подбора бустера нет');

    const res = stepOnce(state);
    assertEqual(res.boosted, 'propeller', 'флаг для звука и статистики');
    assert(state.player.boost, 'бустер стоит');
    assertEqual(state.player.boost.kind, 'propeller', 'облик запомнен');
    assertEqual(state.player.boost.vy, BOOST.propeller.vy, 'скорость из таблицы');
});

test('подобранный предмет больше не подбирается', () => {
    const state = withPickup('rocket');
    stepOnce(state);
    state.player.boost = null; // как будто полёт уже кончился
    const res = stepOnce(state);
    assertEqual(res.boosted, null, 'второй раз тот же предмет не срабатывает');
});

test('во время полёта платформы не ловят — фигурка идёт сквозь', () => {
    const state = withPickup('rocket');
    stepOnce(state);
    // Платформа ровно под фигуркой: без бустера это было бы приземление.
    state.platforms = [{ id: 9, x: state.player.x - 10, y: state.player.y + PLAYER_H + 1, w: 120, kind: 'normal' }];
    state.player.vy = 500; // и даже если бы она падала

    const res = stepOnce(state);
    assert(!res.landed, 'приземления во время полёта нет');
    assertEqual(state.landings, 0, 'счётчик платформ не тронут');
    assertEqual(state.player.vy, BOOST.rocket.vy, 'скорость держит бустер, а не гравитация');
});

test('полёт длится свою длительность и кончается с нулевой скоростью', () => {
    const state = withPickup('propeller');
    stepOnce(state); // подшаг подбора: остаток ставится в конце него, тратить нечего

    let steps = 0;
    while (state.player.boost && steps < 10_000) {
        stepOnce(state);
        steps += 1;
    }
    assertEqual(state.player.boost, null, 'полёт кончился');
    assertEqual(state.player.vy, 0, 'выпали из полёта без набранной скорости');
    // Остаток тает вычитанием, поэтому последний подшаг может уйти в минус на плавающую
    // погрешность — сверяем длительность с точностью до подшага, а не до миллисекунды.
    assertClose(steps * STEP_MS, BOOST.propeller.ms, STEP_MS + 1e-9, 'длительность полёта');
});

test('после полёта под фигуркой есть платформа в пределах MAX_GAP', () => {
    for (const difficulty of ['easy', 'normal', 'hard']) {
        for (const seed of [3, 11, 909]) {
            const state = createGame({ rng: mulberry32(seed), difficulty });
            // Долгий полёт вручную: генератор обязан успевать за подъёмом сам, через
            // ту же камеру, что и в обычной игре.
            state.player.boost = { kind: 'rocket', msLeft: BOOST.rocket.ms, vy: BOOST.rocket.vy };
            while (state.player.boost && state.alive) stepOnce(state);

            const bottom = state.player.y + PLAYER_H;
            const below = state.platforms
                .filter((p) => p.kind !== 'crumbling' && p.y >= bottom)
                .sort((a, b) => a.y - b.y)[0];
            assert(below, `${difficulty}/${seed}: под точкой окончания полёта есть опора`);
            // Потолок здесь — раздутый пружиной зазор, а не MAX_GAP: полёт кончается в
            // произвольной точке лестницы, в том числе над «пружинным» этажом. Это не
            // послабление — вниз фигурка падает даром, ограничение MAX_GAP про подъём.
            // Важно ровно одно: под точкой окончания полёта пусто не бывает.
            const ceiling = MAX_GAP * SPRING_GAP_BONUS;
            assert(
                below.y - bottom <= ceiling + 1e-9,
                `${difficulty}/${seed}: до опоры ${below.y - bottom} wu, потолок ${ceiling}`,
            );
        }
    }
});

// Todo предполагал, что камере во время полёта нужна своя скорость. Не нужна: она
// привязана к фигурке (CAMERA_ANCHOR) и отстать физически не может. Тест фиксирует это,
// чтобы никто не дописал лишнего.
test('во время полёта фигурка остаётся на экране — камере своей скорости не нужно', () => {
    const state = createGame({ rng: mulberry32(5) });
    state.player.boost = { kind: 'rocket', msLeft: BOOST.rocket.ms, vy: BOOST.rocket.vy };
    while (state.player.boost && state.alive) {
        stepOnce(state);
        const screenY = state.player.y - state.cameraY;
        assert(screenY >= 0, `верхний край не ушёл выше экрана: ${screenY}`);
        assert(screenY + PLAYER_H <= state.world.h, `нижний край в экране: ${screenY}`);
    }
});

// Монеты живут в том же state.pickups, что и бустеры (см. шапку «Монеты» в engine.js),
// поэтому проверки про бустеры фильтруют массив по kind.
const boostsOf = (state) => state.pickups.filter((p) => p.kind !== 'coin');
const coinsOf = (state) => state.pickups.filter((p) => p.kind === 'coin');

test('выключатель убирает бустеры из генератора, а сид держит их воспроизводимость', () => {
    const off = createGame({ rng: mulberry32(42), boosters: false });
    ensurePlatformsAbove(off, -20000);
    assertEqual(boostsOf(off).length, 0, 'выключено — бустеров нет');

    const on = createGame({ rng: mulberry32(42), boosters: true });
    ensurePlatformsAbove(on, -20000);
    assert(boostsOf(on).length > 5, `включено — бустеры генерируются: ${boostsOf(on).length}`);
    assert(on.pickups.some((p) => p.kind === 'rocket'), 'ракеты встречаются');
    assert(on.pickups.some((p) => p.kind === 'propeller'), 'пропеллеры встречаются');

    // Тот же сид — та же партия: предметы идут через тот же rng, что и платформы.
    const again = createGame({ rng: mulberry32(42), boosters: true });
    ensurePlatformsAbove(again, -20000);
    assertEqual(
        JSON.stringify(again.pickups),
        JSON.stringify(on.pickups),
        'партия по сиду воспроизводится',
    );

    // Живой выключатель действует на новое поле, уже настеленное не переписывает.
    const wasThere = boostsOf(on).length;
    setBoosters(on, false);
    ensurePlatformsAbove(on, -40000);
    assertEqual(boostsOf(on).length, wasThere, 'после выключения новых бустеров не прибавилось');
});

test('бустер лежит на обычной платформе, а не в пустоте', () => {
    const state = createGame({ rng: mulberry32(7) });
    ensurePlatformsAbove(state, -20000);
    assert(boostsOf(state).length > 5, 'бустеры есть');

    for (const pickup of boostsOf(state)) {
        assert(pickup.x >= 0 && pickup.x + PICKUP_W <= WORLD_W, 'предмет внутри экрана');
        const under = state.platforms.find((p) => Math.abs(p.y - (pickup.y + PICKUP_H + 2)) < 1e-6);
        assert(under, `под предметом на y=${pickup.y} есть платформа`);
        assertEqual(under.kind, 'normal', 'и она обычная — движущаяся уехала бы из-под предмета');
    }
});

// --- Монеты (docs/plan-doodlejump-fixes.md §G.2) ------------------------------------

// Монеты кладём вручную: генератор в этих тестах не участвует, проверяется подбор.
function withCoins(positions) {
    const state = bareState();
    state.pickups = positions.map((pos, i) => ({
        id: 100 + i, kind: 'coin', x: pos.x, y: pos.y, w: PICKUP_W,
    }));
    state.player.x = positions[0].x;
    state.player.y = positions[0].y;
    return state;
}

test('монета подбирается ровно один раз', () => {
    const state = withCoins([{ x: 180, y: 400 }]);
    assertEqual(state.coins, 0, 'до подбора счётчик пуст');

    const first = stepOnce(state);
    assertEqual(first.coins, 1, 'тиковый счётчик за подшаг');
    assertEqual(state.coins, 1, 'счётчик заезда вырос');

    const second = stepOnce(state);
    assertEqual(second.coins, 0, 'второй раз та же монета не считается');
    assertEqual(state.coins, 1, 'счётчик заезда не вырос');
});

test('монета не даёт буста и не трогает физику', () => {
    const withCoin = withCoins([{ x: 180, y: 400 }]);
    const without = bareState();
    without.player.x = 180;
    without.player.y = 400;

    const res = stepOnce(withCoin);
    stepOnce(without);
    assertEqual(res.coins, 1, 'монета подобрана');
    assertEqual(withCoin.player.boost, null, 'буста монета не даёт');
    assertEqual(withCoin.player.vy, without.player.vy, 'скорость та же, что без монеты');
    assertEqual(withCoin.player.y, without.player.y, 'и позиция та же');
    assertEqual(withCoin.landings, 0, 'монета не платформа — приземления нет');
});

test('несколько монет за подшаг считаются все', () => {
    const state = withCoins([{ x: 180, y: 400 }, { x: 190, y: 400 }, { x: 170, y: 400 }]);
    const res = stepOnce(state);
    assertEqual(res.coins, 3, 'три монеты за один подшаг');
    assertEqual(state.coins, 3, 'все три в счётчике заезда');
});

test('advance суммирует монеты за все подшаги кадра', () => {
    // Столбик монет вдоль быстрого падения: за подшаг фигурка проходит меньше, чем
    // расстояние между монетами, значит они достаются из разных подшагов.
    const drop = [];
    for (let i = 0; i < 12; i++) drop.push({ x: 180, y: 400 + i * 60 });
    const state = withCoins(drop);
    state.player.vy = 3000;

    const res = advance(state, 33);
    assert(res.steps >= 3, `подшагов за кадр: ${res.steps}`);
    assert(res.coins >= 2, `монеты за кадр: ${res.coins}`);
    assertEqual(res.coins, state.coins, 'сумма кадра совпала со счётчиком заезда');
});

test('генератор кладёт монеты рядом с платформами, а сид их воспроизводит', () => {
    const state = createGame({ rng: mulberry32(21) });
    ensurePlatformsAbove(state, -20000);
    const coins = coinsOf(state);
    assert(coins.length > 5, `монеты генерируются: ${coins.length}`);

    for (const coin of coins) {
        assert(coin.x >= 0 && coin.x + PICKUP_W <= WORLD_W, 'монета внутри экрана');
        const under = state.platforms.find((p) => Math.abs(p.y - (coin.y + PICKUP_H + 2)) < 1e-6);
        assert(under, `под монетой на y=${coin.y} есть платформа`);
        assert(under.kind !== 'spring', 'на пружине монеты нет — там зигзаг');
    }

    // Монеты идут через тот же rng, что платформы и бустеры: партия по сиду совпадает
    // целиком, а не «почти».
    const again = createGame({ rng: mulberry32(21) });
    ensurePlatformsAbove(again, -20000);
    assertEqual(
        JSON.stringify(again.pickups),
        JSON.stringify(state.pickups),
        'предметы по сиду воспроизводятся',
    );
});

// --- Кошелёк (core/wallet.js) --------------------------------------------------------

test('кошелёк копится, а счётчик заезда с ним не путается', () => {
    const settings = { wallet: { coins: 0 } };
    assertEqual(readWallet(settings).coins, 0, 'пустой кошелёк');

    assertEqual(addCoins(settings, 7), 7, 'первый заезд');
    assertEqual(addCoins(settings, 5), 12, 'второй прибавился к первому');
    assertEqual(settings.wallet.coins, 12, 'записано в тот же объект настроек');
});

test('битый кошелёк из настроек нормализуется, а не роняет', () => {
    assertEqual(readWallet(undefined).coins, 0, 'настроек нет вовсе');
    assertEqual(readWallet({}).coins, 0, 'ключа нет');
    assertEqual(readWallet({ wallet: 'нет' }).coins, 0, 'скаляр вместо объекта');
    assertEqual(readWallet({ wallet: { coins: 'много' } }).coins, 0, 'строка вместо числа');
    assertEqual(readWallet({ wallet: { coins: -5 } }).coins, 0, 'отрицательное');
    assertEqual(readWallet({ wallet: { coins: 3.7 } }).coins, 3, 'дробное усекается');

    const broken = { wallet: [1, 2, 3] };
    assertEqual(addCoins(broken, 4), 4, 'массив заменён свежим кошельком');
    assertEqual(broken.wallet.coins, 4, 'и он на месте настроек');

    const junk = { wallet: { coins: null } };
    assertEqual(addCoins(junk, 'пять'), 0, 'мусорная прибавка — ноль');
});

test('скины нормализуются: default не теряется, current только из купленных', () => {
    assertEqual(readSkins(undefined).current, DEFAULT_SKIN, 'настроек нет');
    assertEqual(JSON.stringify(readSkins({}).owned), JSON.stringify([DEFAULT_SKIN]), 'ключа нет');
    assertEqual(
        JSON.stringify(readSkins({ skins: { owned: 'ninja', current: 5 } }).owned),
        JSON.stringify([DEFAULT_SKIN]),
        'мусор вместо списка',
    );
    assertEqual(readSkins({ skins: { owned: [DEFAULT_SKIN], current: 'ninja' } }).current, DEFAULT_SKIN,
        'некупленный скин не выбран');
    const ok = readSkins({ skins: { owned: ['ninja', 'ninja', '', 7], current: 'ninja' } });
    assertEqual(JSON.stringify(ok.owned), JSON.stringify([DEFAULT_SKIN, 'ninja']), 'повторы и мусор убраны');
    assertEqual(ok.current, 'ninja', 'купленный скин выбран');
});

test('сброс статистики кошелёк не трогает', () => {
    const settings = { stats: { played: 3, bestScore: 500 }, wallet: { coins: 42 } };
    resetStats(settings.stats);
    assertEqual(readStats(settings.stats).played, 0, 'статистика обнулена');
    assertEqual(readWallet(settings).coins, 42, 'монеты на месте');
});

report('doodlejump engine');
