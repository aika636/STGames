// Движок «Дудл Джампа»: непрерывная физика прыгуна над чистым состоянием — ни DOM, ни
// таймеров, ни SillyTavern. Всё случайное идёт через переданный rng, поэтому партия
// воспроизводится по сиду: упавший тест можно повторить шаг в шаг.
//
// Мир живёт в «условных пикселях мира» (wu), а не в CSS-пикселях: экран — окно
// фиксированной логической ширины WORLD_W и высоты worldH, а масштаб под реальный
// контейнер — забота ui/view.js. Ось y растёт ВНИЗ, как в canvas; подъём — это убывание y.

// --- Геометрия и физика -----------------------------------------------------------

export const WORLD_W = 400;
export const WORLD_H = 640; // портрет ~0.625, как у телефона

// Числа подобраны эмпирически, не выведены: цель — прыжок примерно в 4.5 своих роста
// фигурки при времени полёта чуть меньше секунды. При GRAVITY=2200 и JUMP_VELOCITY=-900
// максимальная высота прыжка — 184 wu, то есть на экране 640 wu помещается около трёх
// «этажей» платформ. Правится по ощущениям при ручной проверке, а не аналитически.
export const GRAVITY = 2200; // wu/с², вниз
export const JUMP_VELOCITY = -900; // wu/с, вверх (минус — вверх)
export const PLAYER_W = 40;
export const PLAYER_H = 40;
export const PLATFORM_H = 12;

// Горизонталь: не мгновенная смена скорости, а разгон — иначе фигурка дёргается и в
// прыжке невозможно тонко подправить траекторию. MOVE_ACCEL подобран так, чтобы разгон до
// максимума занимал ~0.15 с: ощущается отзывчиво, но не как телепорт.
export const MOVE_SPEED = 420; // wu/с
export const MOVE_ACCEL = 2800; // wu/с²

// Пружина даёт прыжок в 1.6 раза сильнее обычного (высота растёт как квадрат скорости —
// это 2.56 обычных высоты).
export const SPRING_MULT = 1.6;

// Фиксированный шаг физики: 120 Гц с запасом от 60 Гц экрана, чтобы столкновения не
// зависели от частоты кадров браузера. MAX_SUBSTEPS не даёт «спирали смерти» после
// свёрнутой вкладки — лишнее накопленное время просто выбрасывается.
export const STEP_MS = 1000 / 120;
export const MAX_SUBSTEPS = 8;

// Камера цепляется за фигурку чуть выше середины экрана и НИКОГДА не едет обратно вниз:
// счёт — это пройденная камерой высота, откат сделал бы его немонотонным, а падение и так
// видно — фигурка уезжает за нижний край неподвижного экрана.
export const CAMERA_ANCHOR = 0.45;

// Физический потолок прыжка и рабочий предел зазора генератора. Запас 0.82 — под манёвр по
// горизонтали: пока фигурка летит вбок, у неё меньше времени на точное попадание, и зазор
// «впритык к потолку» на практике непроходим. Коэффициент эмпирический, тест на
// достижимость фиксирует инвариант «зазор ≤ MAX_GAP», а не само число.
export const MAX_JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
export const GAP_SAFETY = 0.82;
export const MAX_GAP = MAX_JUMP_HEIGHT * GAP_SAFETY;

// Пружина — «клапан давления» генератора: с неё прыгают в SPRING_MULT раз сильнее, то есть
// в SPRING_MULT² = 2.56 раза выше, и зазор НАД ней можно раздуть без риска недостижимости.
// 1.7 — не потолок, а осознанный запас: 1.7·MAX_GAP = 257 wu при физической высоте прыжка с
// пружины 471 wu, то есть та же доля от потолка (0.55), что у обычного зазора, только с
// большим отрывом — попасть на узкую платформу после длинного полёта заметно труднее.
export const SPRING_GAP_BONUS = 1.7;

// Рассыпающаяся платформа висит внутри зазора этажа, на этой его доле от верхней (живой)
// платформы. 0.45 держит обе половинки зазора строго меньше MAX_GAP даже при раздутом
// пружиной зазоре (0.55·257 = 141 < 151) — то есть этаж проходим и до, и после того, как
// платформа рассыплется.
export const CRUMBLE_AT = 0.45;

// --- Сложность --------------------------------------------------------------------

// Сложность правит только генератор (зазор, ширина, доли типов платформ), а не геометрию
// мира — как у сапёра и нонограммы. gapMin/gapMax — доли MAX_GAP, поэтому ни одна
// настройка не может выдать недостижимую платформу: потолок уже зашит в MAX_GAP.
//
// movingChance/crumblingChance/springChance — доли одного и того же броска, поэтому их
// сумма обязана оставаться заметно меньше единицы: остаток — это обычные платформы.
export const DIFFICULTY = Object.freeze({
    easy: Object.freeze({
        gapMin: 0.30, gapMax: 0.58, width: 82,
        movingChance: 0.06, movingMin: 40, movingMax: 70,
        crumblingChance: 0.05, springChance: 0.04,
    }),
    normal: Object.freeze({
        gapMin: 0.44, gapMax: 0.78, width: 66,
        movingChance: 0.16, movingMin: 55, movingMax: 95,
        crumblingChance: 0.14, springChance: 0.07,
    }),
    hard: Object.freeze({
        gapMin: 0.58, gapMax: 0.94, width: 52,
        movingChance: 0.30, movingMin: 75, movingMax: 115,
        crumblingChance: 0.26, springChance: 0.10,
    }),
});

export const DEFAULT_DIFFICULTY = 'normal';

// Битое значение из settings.json не должно ронять партию — падаем на «нормально».
export function rulesFor(difficulty) {
    return DIFFICULTY[difficulty] || DIFFICULTY[DEFAULT_DIFFICULTY];
}

// --- Создание партии --------------------------------------------------------------

export function createGame({
    rng = Math.random,
    worldH = WORLD_H,
    difficulty = DEFAULT_DIFFICULTY,
    movingPlatforms = true,
} = {}) {
    const rules = rulesFor(difficulty);
    const startY = worldH - 120;
    const state = {
        world: { w: WORLD_W, h: worldH },
        // Фигурка стоит вплотную над стартовой платформой с нулевой скоростью: первый же
        // подшаг уводит её вниз, она приземляется и отскакивает — партия начинается
        // одинаково при любом сиде, без «а вдруг под ногами пусто».
        player: {
            x: (WORLD_W - PLAYER_W) / 2,
            y: startY - PLAYER_H,
            vx: 0,
            vy: 0,
            facing: 1,
        },
        platforms: [],
        cameraY: 0,
        score: 0,
        landings: 0,
        alive: true,
        difficulty,
        movingPlatforms,
        nextPlatformY: startY,
        // Стоит ли на границе нетронутого поля пружина: только над ней генератор
        // разрешает себе раздутый зазор. Стартовая платформа обычная — значит, нет.
        springBelow: false,
        nextId: 1,
        input: { dir: 0 },
        accumulatorMs: 0,
        // rng живёт в состоянии, а не только в createGame: генератор достраивает уровень
        // всю партию, по мере подъёма камеры.
        rng,
    };

    state.platforms.push({
        id: state.nextId++,
        x: (WORLD_W - rules.width) / 2,
        y: startY,
        w: rules.width,
        kind: 'normal',
    });

    ensurePlatformsAbove(state, state.cameraY - state.world.h * 0.5);
    return state;
}

// Направление — непрерывное намерение, а не ход в очередь, как у змейки: игрок держит
// клавишу, и фигурка едет, пока держит.
export function setInput(state, dir) {
    state.input.dir = dir > 0 ? 1 : dir < 0 ? -1 : 0;
}

// Сложность — живая настройка: смена посреди партии подхватывается генератором для новых
// платформ выше текущей позиции, уже настеленное поле не переписывается.
export function setDifficulty(state, difficulty) {
    state.difficulty = difficulty;
}

export function setMovingPlatforms(state, enabled) {
    state.movingPlatforms = !!enabled;
}

// --- Генерация платформ -----------------------------------------------------------

// Рассыпающаяся платформа ставится в противоположной половине экрана от опоры этажа: так
// это настоящая развилка («срезать по хрупкой» или «дотянуть до надёжной»), а не вторая
// ступенька в том же месте.
function oppositeHalfX(rng, anchorX, w) {
    const span = WORLD_W - w;
    const half = span / 2;
    return anchorX < half ? half + rng() * (span - half) : rng() * half;
}

// Потоковая генерация вверх: достраиваем ряд платформ выше самой верхней сгенерированной
// точки, пока не перекрыт targetY. Всё поле сразу не строим — партия бесконечна, массив
// был бы бесконечным тоже.
//
// Ключевой инвариант: «этаж» задаёт ровно одна ОПОРА (anchor) — платформа, от которой
// отсчитывается следующий зазор. Опора никогда не бывает рассыпающейся: иначе неудачный
// заход обрывал бы лестницу насовсем — платформа, на которую нужно вернуться, к тому
// моменту уже сломана, и игра тихо становится непроходимой. Рассыпающаяся — всегда
// ДОПОЛНИТЕЛЬНАЯ ступенька внутри зазора этажа, и после её пропажи этаж остаётся ровно
// таким же проходимым, каким был бы без неё.
//
// Правила читаются на каждом вызове: см. setDifficulty().
export function ensurePlatformsAbove(state, targetY) {
    const rules = rulesFor(state.difficulty);
    const rng = state.rng;
    // Страховка от зацикливания, если targetY уехал абсурдно далеко за один вызов
    // (например, из-за огромного dtMs после свёрнутой вкладки).
    let guard = 4096;
    while (state.nextPlatformY > targetY && guard-- > 0) {
        let gap = MAX_GAP * (rules.gapMin + rng() * (rules.gapMax - rules.gapMin));
        // Клапан давления: если снизу пружина, зазор можно раздуть — прыжок с неё выше в
        // SPRING_MULT² раз, и даже верхняя граница остаётся с тем же запасом.
        if (state.springBelow) gap += (MAX_GAP * SPRING_GAP_BONUS - gap) * rng();

        const y = state.nextPlatformY - gap;
        const w = rules.width;
        const anchor = {
            id: state.nextId++,
            x: rng() * (WORLD_W - w),
            y,
            w,
            kind: 'normal',
        };

        // Тип этажа — один бросок на весь набор: доли не пересекаются, остаток достаётся
        // обычной платформе. Выключенные движущиеся не отдают свою долю другим типам —
        // они просто становятся обычными.
        const roll = rng();
        const movingChance = state.movingPlatforms ? rules.movingChance : 0;
        const crumblingEdge = movingChance + rules.crumblingChance;
        let crumbling = null;
        // Горизонтально позиция не ограничена «достижимостью по x»: из-за wrap по краям
        // до любой точки экрана можно доехать за время полёта. Реальный лимит — только
        // вертикальный, он уже в gap.
        if (roll < movingChance) {
            anchor.kind = 'moving';
            const speed = rules.movingMin + rng() * (rules.movingMax - rules.movingMin);
            anchor.vx = rng() < 0.5 ? -speed : speed;
        } else if (roll < crumblingEdge) {
            crumbling = {
                id: state.nextId++,
                x: oppositeHalfX(rng, anchor.x, w),
                y: y + gap * CRUMBLE_AT,
                w,
                kind: 'crumbling',
            };
        } else if (roll < crumblingEdge + rules.springChance) {
            anchor.kind = 'spring';
        }

        if (crumbling) state.platforms.push(crumbling);
        state.platforms.push(anchor);
        state.nextPlatformY = y;
        state.springBelow = anchor.kind === 'spring';
    }
}

// --- Шаг физики -------------------------------------------------------------------

// Пересечение по x с учётом wrap: фигурка, стоящая на стыке краёв, видна и слева, и
// справа — поэтому проверяем её прямоугольник в двух положениях.
function overlapsX(px, platform) {
    const left = platform.x;
    const right = platform.x + platform.w;
    if (px + PLAYER_W > left && px < right) return true;
    return px + PLAYER_W - WORLD_W > left && px - WORLD_W < right;
}

function isSolid(platform) {
    return !platform.broken;
}

// Один физический подшаг ровно STEP_MS. Отделён от advance() затем, чтобы тесты гоняли
// физику впритык, без накопителя и таймеров. Возвращает тиковые флаги для звука и
// статистики — по образцу step() змейки.
export function stepOnce(state) {
    const result = { landed: false, brokePlatform: false, fell: false };
    if (!state.alive) return result;

    const dt = STEP_MS / 1000;
    const player = state.player;

    // Горизонталь: разгон к целевой скорости, а не мгновенная подстановка.
    const target = state.input.dir * MOVE_SPEED;
    const dv = MOVE_ACCEL * dt;
    if (player.vx < target) player.vx = Math.min(target, player.vx + dv);
    else if (player.vx > target) player.vx = Math.max(target, player.vx - dv);
    if (player.vx > 1) player.facing = 1;
    else if (player.vx < -1) player.facing = -1;

    player.x += player.vx * dt;
    // Wrap по горизонтали — часть жанра, а не настройка: уйдя за левый край, фигурка
    // выходит справа. Скорость и y при этом не трогаем.
    if (player.x < 0) player.x += WORLD_W;
    else if (player.x >= WORLD_W) player.x -= WORLD_W;

    // Движущиеся платформы едут физически и отражаются от краёв — не телепортируются
    // через wrap, иначе платформа исчезала бы из-под ног.
    for (const platform of state.platforms) {
        if (platform.kind !== 'moving' || !platform.vx) continue;
        platform.x += platform.vx * dt;
        if (platform.x < 0) {
            platform.x = -platform.x;
            platform.vx = -platform.vx;
        } else if (platform.x + platform.w > WORLD_W) {
            platform.x = 2 * (WORLD_W - platform.w) - platform.x;
            platform.vx = -platform.vx;
        }
    }

    // Вертикаль: свип по y от прежней нижней грани к новой. Point-in-rect на одном кадре
    // здесь не годится — при большой скорости падения фигурка проскочила бы тонкую
    // платформу насквозь (классическое туннелирование).
    const prevBottom = player.y + PLAYER_H;
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    const bottom = player.y + PLAYER_H;

    if (player.vy > 0) {
        // Из всех платформ, попавших в свип, берём верхнюю (меньший y) — по пути вниз
        // именно её фигурка встретит первой.
        let hit = null;
        for (const platform of state.platforms) {
            if (!isSolid(platform)) continue;
            if (prevBottom > platform.y || bottom < platform.y) continue;
            if (!overlapsX(player.x, platform)) continue;
            if (hit === null || platform.y < hit.y) hit = platform;
        }
        if (hit) {
            player.y = hit.y - PLAYER_H;
            player.vy = hit.kind === 'spring' ? JUMP_VELOCITY * SPRING_MULT : JUMP_VELOCITY;
            state.landings += 1;
            result.landed = true;
            // crumbling отскок даёт, но ровно один — дальше в столкновениях не участвует.
            if (hit.kind === 'crumbling') {
                hit.broken = true;
                result.brokePlatform = true;
            }
        }
    }

    // Камера едет только вверх. Счёт — пройденная ею высота, поэтому спуск после промаха
    // его не уменьшает.
    const anchor = player.y - state.world.h * CAMERA_ANCHOR;
    if (anchor < state.cameraY) {
        state.cameraY = anchor;
        const height = Math.floor(-state.cameraY);
        if (height > state.score) state.score = height;
        ensurePlatformsAbove(state, state.cameraY - state.world.h * 0.5);
        // Ушедшее под нижний край больше не нужно ни физике, ни отрисовке.
        const limit = state.cameraY + state.world.h + PLATFORM_H * 2;
        if (state.platforms.length > 8) {
            state.platforms = state.platforms.filter((platform) => platform.y <= limit);
        }
    }

    // Проигрыш: верхняя грань фигурки ниже нижнего края экрана — значит, она ушла за него
    // целиком, и запас на её высоту уже учтён.
    if (player.y - state.cameraY > state.world.h) {
        state.alive = false;
        result.fell = true;
    }

    return result;
}

// Единственная точка входа для игрового времени: ui/ зовёт её на каждом rAF, а сколько
// подшагов прогнать — решает сама. Флаги подшагов схлопываются в один результат.
export function advance(state, dtMs) {
    const result = { landed: false, brokePlatform: false, fell: false, steps: 0 };
    if (!state.alive) return result;

    state.accumulatorMs += Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    // Лишнее время выбрасываем, а не догоняем: после свёрнутой вкладки накопитель может
    // содержать минуты, и честная симуляция подвесила бы вкладку таверны.
    const cap = STEP_MS * MAX_SUBSTEPS;
    if (state.accumulatorMs > cap) state.accumulatorMs = cap;

    while (state.accumulatorMs >= STEP_MS && state.alive) {
        state.accumulatorMs -= STEP_MS;
        const step = stepOnce(state);
        result.steps += 1;
        if (step.landed) result.landed = true;
        if (step.brokePlatform) result.brokePlatform = true;
        if (step.fell) result.fell = true;
    }

    return result;
}
