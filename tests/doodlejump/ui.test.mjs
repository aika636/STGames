// Тесты UI «Дудл Джампа» под jsdom (Фаза 2): монтирование экрана через оболочку,
// непрерывное направление с клавиатуры и с экранных кнопок, оверлей падения, снятие
// слушателей в destroy().
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/doodlejump/ui.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from '../_harness.mjs';
import { BOOST, PICKUP_W, PLAYER_H, PLAYER_W, WORLD_W } from '../../src/games/doodlejump/core/engine.js';

const dom = new JSDOM(
    '<!doctype html><html><body><div id="extensionsMenu"></div></body></html>',
    { pretendToBeVisual: true },
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
// view.js зовёт голый getComputedStyle; в node его нет — берём из окна jsdom.
globalThis.getComputedStyle = dom.window.getComputedStyle;

let saves = 0;
const context = {
    extensionSettings: {},
    saveSettingsDebounced: () => { saves += 1; },
    POPUP_TYPE: { TEXT: 1, DISPLAY: 4 },
    callGenericPopup: null,
};

globalThis.SillyTavern = { getContext: () => context };

// jsdom без пакета canvas не умеет 2d-контекст: подменяем getContext записывающей
// заглушкой, чтобы draw() работал и тест мог видеть сдвиг фигурки между кадрами.
// Каждая отрисовка начинается с clearRect (номер кадра). roundRect заглушка намеренно
// НЕ реализует — view.js тогда падает в ветку fillRect, и координаты видно.
// Заодно заглушка запоминает текущий цвет и проведённые линии: по ним видно, что типы
// платформ красятся по-разному, а пружинка и трещины вообще рисуются.
const fills = [];
const lines = [];
// Заодно счётчик paints: заливки путями (arc/lineTo + fill) координат не оставляют, и
// только по нему видно, что скин вообще что-то нарисовал, а не тихо ничего не сделал.
const mock2d = {
    pass: -1,
    paints: 0,
    fill_: null,
    stroke_: null,
    pen: null,
    clearRect() { this.pass += 1; },
    fillRect(x, y, w, h) {
        fills.push({ pass: this.pass, x, y, w, h, style: this.fill_ });
        this.paints += 1;
    },
    beginPath() {},
    moveTo(x, y) { this.pen = { x, y }; },
    lineTo(x, y) {
        lines.push({ pass: this.pass, from: this.pen, to: { x, y }, style: this.stroke_ });
        this.pen = { x, y };
    },
    stroke() { this.paints += 1; },
    arc() {},
    fill() { this.paints += 1; },
};
Object.defineProperty(mock2d, 'fillStyle', { set(v) { this.fill_ = v; }, configurable: true });
Object.defineProperty(mock2d, 'strokeStyle', { set(v) { this.stroke_ = v; }, configurable: true });
for (const prop of ['lineWidth', 'globalAlpha']) {
    Object.defineProperty(mock2d, prop, { set() {}, configurable: true });
}
window.HTMLCanvasElement.prototype.getContext = () => mock2d;

// Цикл игры — requestAnimationFrame; в jsdom его неоткуда крутить, поэтому собираем
// колбэки в массив и шагаем вручную с фиктивным временем.
const rafCallbacks = [];
const cancelled = [];
globalThis.requestAnimationFrame = (cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
};
globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
};

// Партия должна быть воспроизводимой: экран берёт Math.random напрямую (в тестах ядра
// его место занимает mulberry32). Константа делает генератор платформ детерминированным,
// поэтому и момент падения в тесте ниже — фиксированный.
Math.random = () => 0.001;

const { clear, register } = await import('../../src/registry.js');
const snakeGame = (await import('../../src/games/snake/index.js')).default;
const doodlejumpGame = (await import('../../src/games/doodlejump/index.js')).default;
const { isOpen, openShell, refresh } = await import('../../src/shell/modal.js');
const { getSettings } = await import('../../src/settings.js');

// Каждая сессия — один открытый попап: отдаём openShell() «висящий» промис и
// отпускаем его в конце, как игрок закрывает окно крестиком.
async function session(options, body) {
    let root = null;
    let release;
    const held = new Promise((resolve) => { release = resolve; });

    context.callGenericPopup = (content) => {
        root = content;
        return held;
    };

    const opened = openShell(options);
    await Promise.resolve();

    await body(root);

    release();
    await opened;
}

// Общие часы на все сессии: время в rAF монотонно, и экран считает по нему dt.
let now = 0;
function frame(dt = 16) {
    now += dt;
    rafCallbacks[rafCallbacks.length - 1](now);
}
function frames(count, dt = 16) {
    for (let i = 0; i < count; i++) frame(dt);
}

// Заезд конечен: если фигурка успела упасть в предыдущей проверке, начинаем новый —
// иначе следующий тест мерил бы движение на замершем экране. Рестарт ставит фигурку в
// центр, а все проверки ниже относительные, так что на них это не влияет.
function ensureAlive(root) {
    if (root.querySelector('.doodlejump-over').style.display === 'flex') {
        key('keydown', 'Enter');
        frame();
    }
}

function key(type, k) {
    const event = new dom.window.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event;
}

// Ведение пальцем: jsdom не знает ни PointerEvent, ни раскладки. PointerEvent изображаем
// MouseEvent'ом с дописанным pointerId (createDrag() читает только его и clientX), а
// getBoundingClientRect подменяем — в jsdom он всегда нулевой, и без подмены масштаб
// «CSS-пиксели → wu» выродился бы в ноль. Ширину берём ту же, что фолбэк view.js (320),
// поэтому clientX в тестах живёт в той же системе координат, что и записанные заливки.
function stubRect(canvas, width = 320) {
    canvas.getBoundingClientRect = () => ({
        left: 0, top: 0, right: width, bottom: 512, width, height: 512, x: 0, y: 0,
    });
    return canvas;
}

function pointer(canvas, type, clientX, id = 1) {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(event, 'pointerId', { value: id });
    canvas.dispatchEvent(event);
    return event;
}

// Фигурку в записанных заливках узнаём по ширине: она PLAYER_W мировых единиц, а
// платформы — заметно шире (66 у «нормально»). Масштаб в jsdom постоянный: клиентских
// размеров нет, view.js берёт фолбэк 320 CSS-пикселей на WORLD_W.
const SCALE = 320 / WORLD_W;
const PLAYER_PX = PLAYER_W * SCALE;
function playerX(pass) {
    const hit = fills.find((f) => f.pass === pass && Math.abs(f.w - PLAYER_PX) < 0.6);
    return hit ? hit.x : null;
}
function assertClose2(actual, expected, eps, message) {
    if (!(Math.abs(actual - expected) <= eps)) {
        throw new Error(`${message}: получено ${actual}, ожидалось ~${expected}`);
    }
}

function lastPlayerX() {
    return playerX(mock2d.pass);
}

console.log('doodlejump ui (jsdom)');

clear();
register(snakeGame);
register(doodlejumpGame);

await session({}, async (root) => {
    test('хаб показывает плитку «Дудл Джампа»', () => {
        assert(isOpen(), 'окно открыто');
        const tile = root.querySelector('.stg-tile[data-game-id="doodlejump"]');
        assert(tile, 'плитка на месте');
        assertEqual(tile.querySelector('.stg-tile-title').textContent, 'Дудл Джамп', 'название');
        assertEqual(tile.querySelector('.stg-tile-tagline').textContent, 'Прыгай выше — не упади', 'подпись');
    });
});

// --- Экран: разметка и непрерывное управление.

await session({ gameId: 'doodlejump' }, async (root) => {
    test('mount строит canvas, шапку со счётом и экранные кнопки', () => {
        assert(root.querySelector('.doodlejump-canvas'), 'canvas на месте');
        assert(root.querySelector('.doodlejump-stage'), 'сцена на месте');
        assertEqual(root.querySelectorAll('.doodlejump-header span').length, 4, 'высота, платформы, монеты и рекорд');
        assert(root.querySelector('.doodlejump-header').textContent.includes('Высота'), 'счёт в шапке, а не на канвасе');
        assert(root.querySelector('.doodlejump-header').textContent.includes('Монеты: 0'), 'монеты заезда в шапке');
        assertEqual(root.querySelectorAll('.doodlejump-buttons .doodlejump-btn').length, 2, 'две кнопки');
        assert(root.querySelector('.doodlejump-btn-left'), 'кнопка влево');
        assert(root.querySelector('.doodlejump-btn-right'), 'кнопка вправо');
        assert(root.querySelector('.doodlejump-status'), 'строка статуса');
        assertEqual(root.querySelector('.doodlejump-over').style.display, 'none', 'оверлея не видно');
    });

    test('зажатая ArrowRight двигает фигурку вправо кадр за кадром', () => {
        frame(); // первый кадр только заводит часы: dt на нём нулевой
        const before = lastPlayerX();

        const down = key('keydown', 'ArrowRight');
        assert(down.defaultPrevented, 'стрелка погашена игрой');

        frames(10);
        const after = lastPlayerX();
        assert(before !== null && after !== null, 'фигурка нарисована в обоих кадрах');
        assert(after > before, `фигурка уехала вправо: ${before} → ${after}`);
    });

    test('отпускание клавиши останавливает движение, залипания нет', () => {
        const up = key('keyup', 'ArrowRight');
        assert(up.defaultPrevented, 'keyup тоже обработан');

        frames(12); // разгон гасится не мгновенно — даём инерции сойти на нет
        const settled = lastPlayerX();
        frames(6);
        const after = lastPlayerX();
        assert(Math.abs(after - settled) < 0.5, `движение прекратилось: ${settled} → ${after}`);
    });

    test('оверлап нажатий: отпустить правую при зажатой левой — едем влево', () => {
        ensureAlive(root);
        key('keydown', 'ArrowLeft');
        key('keydown', 'ArrowRight');
        // Обе зажаты — направления нет, фигурка стоит.
        frames(10);
        const still = lastPlayerX();
        frames(5);
        assert(Math.abs(lastPlayerX() - still) < 0.5, 'две клавиши гасят друг друга');

        ensureAlive(root);
        // Правую отпустили, левая ещё зажата: «последнее направление» дало бы стоп или
        // рывок вправо, флаги дают движение влево.
        key('keyup', 'ArrowRight');
        const before = lastPlayerX();
        frames(10);
        assert(lastPlayerX() < before, 'поехали влево');
        key('keyup', 'ArrowLeft');
        frames(12);
    });

    test('кнопка на экране двигает так же, как клавиша', () => {
        ensureAlive(root);
        const btn = root.querySelector('.doodlejump-btn-right');
        const before = lastPlayerX();

        const press = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
        btn.dispatchEvent(press);
        assert(press.defaultPrevented, 'mousedown отменён — фокус остаётся на окне');

        frames(10);
        const after = lastPlayerX();
        assert(after > before, `фигурка уехала вправо: ${before} → ${after}`);

        btn.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        frames(12);
        const settled = lastPlayerX();
        frames(6);
        assert(Math.abs(lastPlayerX() - settled) < 0.5, 'отпущенная кнопка не залипает');
    });

    test('русские Ф и В работают наравне со стрелками', () => {
        ensureAlive(root);
        const down = key('keydown', 'в');
        assert(down.defaultPrevented, '«в» погашена игрой');
        const before = lastPlayerX();
        frames(10);
        assert(lastPlayerX() > before, 'поехали вправо');
        key('keyup', 'в');
        frames(12);
    });

    test('keyup с фокусом на кнопке снимает направление, но не гасит событие', () => {
        ensureAlive(root);
        key('keydown', 'ArrowRight');
        frames(6);

        // Игрок кликнул по кнопке, не отпустив стрелку: keyup прилетает уже с кнопки.
        // Флаг обязан сняться, иначе фигурка едет вправо до следующего нажатия. Кнопка
        // берётся своя, живущая в document: содержимое попапа в jsdom не привязано к
        // дереву документа, и события с него до capture-слушателя не доходят.
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        const up = new dom.window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, cancelable: true });
        btn.dispatchEvent(up);
        btn.remove();
        assert(!up.defaultPrevented, 'событию на кнопке preventDefault не достаётся');

        frames(12);
        const settled = lastPlayerX();
        frames(8);
        assert(Math.abs(lastPlayerX() - settled) < 0.5, `направление не залипло: ${settled} → ${lastPlayerX()}`);
    });

    test('уход со вкладки снимает зажатую клавишу: после возврата фигурка не едет сама', () => {
        ensureAlive(root);
        key('keydown', 'ArrowRight');
        frames(6);

        // blur съедает keyup: браузер его просто не пришлёт. Экран снимает флаги сам.
        window.dispatchEvent(new dom.window.Event('blur'));
        assertEqual(root.querySelector('.doodlejump-status').textContent, 'Пауза', 'вкладка ушла — пауза');
        window.dispatchEvent(new dom.window.Event('focus'));

        frames(12);
        const settled = lastPlayerX();
        frames(8);
        assert(Math.abs(lastPlayerX() - settled) < 0.5, `после возврата фигурка стоит: ${settled} → ${lastPlayerX()}`);
    });

    // --- Ведение пальцем по полю (docs/plan-doodlejump-fixes.md §D).

    test('палец на поле перебивает зажатую кнопку', () => {
        ensureAlive(root);
        const canvas = stubRect(root.querySelector('.doodlejump-canvas'));
        const btn = root.querySelector('.doodlejump-btn-left');
        btn.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        frames(6);

        // Палец у правого края: цель далеко справа, значит полный ход вправо, несмотря на
        // зажатую кнопку «влево».
        pointer(canvas, 'pointerdown', 310);
        frames(14);
        const before = lastPlayerX();
        frames(8);
        assert(lastPlayerX() > before, `палец переспорил кнопку: ${before} → ${lastPlayerX()}`);
    });

    test('отпустили палец — вернулось направление зажатой кнопки', () => {
        ensureAlive(root);
        const canvas = stubRect(root.querySelector('.doodlejump-canvas'));
        pointer(canvas, 'pointerup', 310);
        frames(14);
        const before = lastPlayerX();
        frames(8);
        assert(lastPlayerX() < before, `кнопка «влево» снова в силе: ${before} → ${lastPlayerX()}`);
        root.querySelector('.doodlejump-btn-left')
            .dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        frames(12);
    });

    test('палец подводит фигурку к цели и отпускает газ, а не гонит на полную', () => {
        ensureAlive(root);
        const canvas = stubRect(root.querySelector('.doodlejump-canvas'));
        // Цель — там, где фигурка стоит сейчас: намерение в мёртвой зоне, ход нулевой.
        const here = lastPlayerX() + (PLAYER_W * SCALE) / 2;
        // Заливки записаны в device-пикселях (wu·SCALE), а clientX живёт в CSS-пикселях
        // подменённого rect шириной 320 — при фолбэке view.js это одно и то же число.
        pointer(canvas, 'pointerdown', here);
        frames(20);
        const settled = lastPlayerX();
        frames(10);
        assert(Math.abs(lastPlayerX() - settled) < 1.5, `фигурка стоит у пальца: ${settled} → ${lastPlayerX()}`);
        pointer(canvas, 'pointerup', 0);
        frames(12);
    });

    test('pointercancel снимает намерение — фигурка не едет сама', () => {
        ensureAlive(root);
        const canvas = stubRect(root.querySelector('.doodlejump-canvas'));
        pointer(canvas, 'pointerdown', 310);
        frames(10);
        pointer(canvas, 'pointercancel', 310);
        frames(14);
        const settled = lastPlayerX();
        frames(8);
        assert(Math.abs(lastPlayerX() - settled) < 0.5, `после отмены фигурка стоит: ${settled} → ${lastPlayerX()}`);
    });

    test('Esc не перехватывается, посторонняя клавиша проходит насквозь', () => {
        const esc = key('keydown', 'Escape');
        assert(!esc.defaultPrevented, 'Esc достаётся попапу');
        const letter = key('keydown', 'q');
        assert(!letter.defaultPrevented, 'обычная буква уходит в таверну');
    });

    test('пробел ставит паузу и останавливает физику', () => {
        ensureAlive(root);
        const space = key('keydown', ' ');
        assert(space.defaultPrevented, 'пробел погашен');
        assertEqual(root.querySelector('.doodlejump-status').textContent, 'Пауза', 'статус — пауза');

        const before = lastPlayerX();
        frames(20);
        assertEqual(lastPlayerX(), before, 'на паузе фигурка не двигается');

        key('keydown', ' ');
        assertEqual(root.querySelector('.doodlejump-status').textContent, '', 'пауза снята');
    });
});

// --- Падение: оверлей и запись статистики ровно один раз.

const playedBefore = getSettings().games.doodlejump.stats.played;

await session({ gameId: 'doodlejump' }, async (root) => {
    const stats = getSettings().games.doodlejump.stats;

    test('падение ниже экрана показывает оверлей', () => {
        assertEqual(stats.played, playedBefore + 1, '«сыграно» выросло на старте заезда');

        // Держим вправо: фигурка уезжает со стартовой платформы и падает. Генератор
        // детерминирован (Math.random выше — константа), поэтому падение наступает на
        // фиксированном кадре, а не «когда-нибудь».
        key('keydown', 'ArrowRight');
        const overlay = root.querySelector('.doodlejump-over');
        let guard = 0;
        while (overlay.style.display !== 'flex' && guard < 400) {
            frame();
            guard += 1;
        }

        assertEqual(overlay.style.display, 'flex', `оверлей показан (кадров: ${guard})`);
        assert(overlay.textContent.includes('Высота'), 'в оверлее высота');
        assert(overlay.textContent.includes('Платформ'), 'в оверлее число платформ');
        assert(overlay.querySelector('.doodlejump-over-restart'), 'кнопка «Ещё раз»');
        assert(root.querySelector('.doodlejump-status').textContent.includes('Enter'), 'статус зовёт нажать Enter');
    });

    test('результат записан ровно один раз за заезд', () => {
        assert(stats.bestPlatforms > 0, 'платформы записаны');
        assert(stats.bestScore > 0, 'высота записана');

        const savesAfterFall = saves;
        frames(30);
        assertEqual(saves, savesAfterFall, 'кадры после падения статистику больше не пишут');
    });

    test('Enter начинает новую партию', () => {
        const enter = key('keydown', 'Enter');
        assert(enter.defaultPrevented, 'Enter погашен');
        assertEqual(root.querySelector('.doodlejump-over').style.display, 'none', 'оверлей убран');
        assertEqual(stats.played, playedBefore + 2, 'сыграно стало на один больше');
        assertEqual(root.querySelector('.doodlejump-header').textContent.includes('Высота: 0'), true, 'счёт обнулился');
        key('keyup', 'ArrowRight');
    });
});

// --- Монеты: счётчик заезда, кошелёк и брошенный заезд (§G.2 плана).

// Партии выше идут на константе Math.random = 0.001, и на ней каждый этаж выходит
// движущимся — монет там не бывает вовсе. Здесь нужна другая партия: зацикленная
// последовательность бросков даёт ровный столбик обычных платформ с монетой на каждой,
// то есть заезд, где монеты собираются гарантированно, а не «повезёт».
//
// Порядок бросков генератора на этаж: зазор, x, тип платформы, бустер, монета.
const COIN_SEQ = [0.4, 0.5, 0.5, 0.9, 0.01];
let coinRoll = 0;
function useCoinRng() {
    coinRoll = 0;
    Math.random = () => COIN_SEQ[coinRoll++ % COIN_SEQ.length];
}
function useDefaultRng() {
    Math.random = () => 0.001;
}

function headerCoins(root) {
    const span = root.querySelectorAll('.doodlejump-header span')[2];
    return Number(span.textContent.replace(/\D+/g, ''));
}
function walletCoins() {
    return getSettings().games.doodlejump.wallet.coins;
}

// Копим монеты, пока счётчик заезда не сдвинется с нуля.
function collectCoins(root, limit = 400) {
    frame();
    let guard = 0;
    while (headerCoins(root) === 0 && guard < limit) {
        frame();
        guard += 1;
    }
    return headerCoins(root);
}

useCoinRng();
const walletBeforeFall = walletCoins();

await session({ gameId: 'doodlejump' }, async (root) => {
    test('счётчик монет за заезд растёт в шапке и кошелька не касается', () => {
        const earned = collectCoins(root);
        assert(earned > 0, `монеты собраны: ${earned}`);
        assertEqual(walletCoins(), walletBeforeFall, 'пока заезд идёт, кошелёк не трогаем');
    });

    test('в конце заезда монеты уезжают в кошелёк ровно один раз', () => {
        // Уводим фигурку с колонки платформ — заезд кончается падением.
        key('keydown', 'ArrowRight');
        const overlay = root.querySelector('.doodlejump-over');
        let guard = 0;
        while (overlay.style.display !== 'flex' && guard < 900) {
            frame();
            guard += 1;
        }
        key('keyup', 'ArrowRight');
        assertEqual(overlay.style.display, 'flex', `заезд кончился (кадров: ${guard})`);

        const earned = headerCoins(root);
        assert(earned > 0, `за заезд собрано монет: ${earned}`);
        assertEqual(walletCoins(), walletBeforeFall + earned, 'кошелёк вырос ровно на итог заезда');

        frames(30);
        assertEqual(walletCoins(), walletBeforeFall + earned, 'кадры после падения кошелёк не трогают');
        assertEqual(headerCoins(root), earned, 'счётчик заезда остался счётчиком заезда');
    });
});

// Брошенный заезд (закрыли окно) монеты ЗАСЧИТЫВАЕТ: собранное отбирать не за что, а
// обратное решение поощряло бы досиживать до падения ради валюты.
useCoinRng();
const walletBeforeQuit = walletCoins();
let earnedInQuit = 0;

await session({ gameId: 'doodlejump' }, async (root) => {
    earnedInQuit = collectCoins(root);
    test('монеты брошенного заезда до закрытия окна ещё не в кошельке', () => {
        assert(earnedInQuit > 0, `монеты собраны: ${earnedInQuit}`);
        assertEqual(walletCoins(), walletBeforeQuit, 'кошелёк пока прежний');
    });
});

test('брошенный заезд засчитывает монеты при закрытии окна', () => {
    assertEqual(walletCoins(), walletBeforeQuit + earnedInQuit, 'кошелёк вырос на собранное');
});

// Кошелёк из руками поправленного settings.json может оказаться чем угодно: экран обязан
// это пережить и починить запись, а не упасть.
getSettings().games.doodlejump.wallet = 'нет у меня кошелька';
useCoinRng();
let earnedBroken = 0;

await session({ gameId: 'doodlejump' }, async (root) => {
    earnedBroken = collectCoins(root);
    test('битый кошелёк в настройках не роняет экран', () => {
        assert(earnedBroken > 0, `заезд идёт и монеты собираются: ${earnedBroken}`);
    });
});

test('битый кошелёк чинится при записи монет, а не роняет запись', () => {
    assertEqual(walletCoins(), earnedBroken, 'кошелёк создан заново и содержит собранное');
});

useDefaultRng();

// --- Реестр скинов (§G.4 плана): контракт и отрисовка каждой формы.
//
// Формы рисуются примитивами, и легко взять метод, которого нет ни в заглушке, ни в
// старом браузере. Цикл по всему реестру — страховка ровно от этого: если скин зовёт
// что-то лишнее, тест падает здесь, а не у игрока на канвасе.

const { SKINS: SKIN_REGISTRY, getSkin: lookupSkin, resolveColors: resolveSkinColors } =
    await import('../../src/games/doodlejump/ui/skins.js');
const { DEFAULT_SKIN } = await import('../../src/games/doodlejump/core/wallet.js');

test('реестр скинов: id и названия уникальны, цены целые, палитра с фолбэком', () => {
    assert(SKIN_REGISTRY.length === 8, `скинов в реестре: ${SKIN_REGISTRY.length}`);
    assertEqual(new Set(SKIN_REGISTRY.map((s) => s.id)).size, SKIN_REGISTRY.length, 'id уникальны');
    assertEqual(new Set(SKIN_REGISTRY.map((s) => s.title)).size, SKIN_REGISTRY.length, 'названия уникальны');

    for (const skin of SKIN_REGISTRY) {
        assert(typeof skin.id === 'string' && skin.id.length > 0, `id непустой: ${skin.id}`);
        assert(typeof skin.title === 'string' && skin.title.length > 0, `название непустое: ${skin.id}`);
        assert(Number.isInteger(skin.price) && skin.price >= 0, `цена — неотрицательное целое: ${skin.id}`);
        assertEqual(typeof skin.draw, 'function', `draw — функция: ${skin.id}`);

        const entries = Object.entries(skin.palette);
        assert(entries.length > 0, `палитра непустая: ${skin.id}`);
        for (const [key, value] of entries) {
            assert(Array.isArray(value) && value.length === 2, `${skin.id}.${key} — пара «имя, фолбэк»`);
            assert(value[0].startsWith('--stg-doodlejump-'), `${skin.id}.${key} берёт цвет из слоя палитры`);
            assert(/^#[0-9a-f]{6}$/i.test(value[1]), `${skin.id}.${key} с литеральным фолбэком`);
        }
        assertEqual(lookupSkin(skin.id), skin, `getSkin находит ${skin.id}`);
    }
});

test('порядок реестра — по возрастанию цены: он же порядок плиток в магазине', () => {
    const prices = SKIN_REGISTRY.map((s) => s.price);
    assertEqual(prices[0], 0, 'первый скин бесплатный');
    for (let i = 1; i < prices.length; i++) {
        assert(prices[i] > prices[i - 1], `цена растёт: ${prices[i - 1]} → ${prices[i]}`);
    }
});

test('каждый скин рисуется обеими сторонами и ничего не рисует мимо контекста', () => {
    const colors = (skin) => resolveSkinColors(skin, (name, fallback) => fallback);
    for (const skin of SKIN_REGISTRY) {
        for (const facing of [1, -1]) {
            const before = mock2d.paints;
            skin.draw(mock2d, 0, 0, PLAYER_W, PLAYER_H, facing, colors(skin));
            assert(mock2d.paints > before, `${skin.id} нарисовался при facing=${facing}`);
        }
    }
});

// --- Магазин скинов (§G.3 плана): оверлей внутри игры, а не игра в хабе.

function shopBalance(root) {
    return Number(root.querySelector('.doodlejump-shop-balance').textContent.replace(/\D+/g, ''));
}
function shopItem(root, id) {
    return root.querySelector(`.doodlejump-shop-item[data-skin-id="${id}"]`);
}
function gameSkins() {
    return getSettings().games.doodlejump.skins;
}

// Кошелёк набивается напрямую: сколько монет накопили тесты выше — их дело, а магазину
// нужна заведомо достаточная сумма.
getSettings().games.doodlejump.wallet = { coins: 500 };
getSettings().games.doodlejump.skins = { owned: ['default'], current: 'default' };

await session({ gameId: 'doodlejump' }, async (root) => {
    const shop = root.querySelector('.doodlejump-shop');

    test('кнопка в шапке открывает магазин и ставит партию на паузу', () => {
        assert(shop, 'оверлей магазина в разметке');
        assertEqual(shop.style.display, 'none', 'закрыт при монтировании');

        frame();
        key('keydown', 'ArrowRight');
        frames(5);
        const before = lastPlayerX();

        root.querySelector('.doodlejump-shop-open').click();
        assertEqual(shop.style.display, 'flex', 'магазин открыт');
        assert(root.querySelector('.doodlejump-status').textContent.includes('Магазин'), 'статус говорит о паузе');
        assertEqual(shopBalance(root), 500, 'баланс — кошелёк, а не счётчик заезда');
        assertEqual(
            root.querySelectorAll('.doodlejump-shop-item').length,
            SKIN_REGISTRY.length,
            'на витрине все скины реестра',
        );
        assertEqual(root.querySelectorAll('.doodlejump-shop-item').length, 8, 'восемь плиток скинов');
        assert(root.querySelector('.doodlejump-shop-preview'), 'превью рисуется на канвасе');

        frames(10);
        assertClose2(lastPlayerX(), before, 0.001, 'пока магазин открыт, фигурка стоит');
    });

    test('надетый скин помечен, купить его нельзя', () => {
        const item = shopItem(root, 'default');
        assert(item.classList.contains('is-worn'), 'бесплатный скин надет');
        assertEqual(item.querySelector('.doodlejump-shop-note').textContent, 'Надет', 'подпись состояния');
        assert(item.querySelector('.doodlejump-shop-action').disabled, 'кнопка не нажимается');
    });

    test('покупка списывает монеты, надевает скин и сохраняет настройки', () => {
        const savesBefore = saves;
        const item = shopItem(root, 'ufo');
        assertEqual(item.querySelector('.doodlejump-shop-note').textContent, 'Цена: 25', 'цена на плитке');
        item.querySelector('.doodlejump-shop-action').click();

        assert(saves > savesBefore, 'настройки сохранены');
        assertEqual(shopBalance(root), 475, 'баланс на экране уменьшился на цену');
        assertEqual(gameSkins().current, 'ufo', 'купленный скин надет в настройках');
        assert(gameSkins().owned.includes('ufo'), 'и попал в купленные');
        assert(shopItem(root, 'ufo').classList.contains('is-worn'), 'плитка перерисована надетой');
    });

    test('повторная покупка невозможна, купленный только надевается', () => {
        // Возвращаемся на бесплатный — у купленного должно остаться «Надеть», а не «Купить».
        shopItem(root, 'default').querySelector('.doodlejump-shop-action').click();
        assertEqual(gameSkins().current, 'default', 'надет бесплатный');

        const ufo = shopItem(root, 'ufo');
        assertEqual(ufo.querySelector('.doodlejump-shop-note').textContent, 'Куплен', 'состояние «куплен»');
        assertEqual(ufo.querySelector('.doodlejump-shop-action').textContent, 'Надеть', 'цену больше не просят');

        ufo.querySelector('.doodlejump-shop-action').click();
        assertEqual(shopBalance(root), 475, 'второй раз не списано');
        assertEqual(gameSkins().current, 'ufo', 'скин надет');
    });

    test('на дорогой скин без монет покупка не проходит и баланс не меняется', () => {
        getSettings().games.doodlejump.wallet.coins = 10;
        root.querySelector('.doodlejump-shop-close').click();
        root.querySelector('.doodlejump-shop-open').click();

        assertEqual(shopBalance(root), 10, 'баланс перечитан');
        shopItem(root, 'ghost').querySelector('.doodlejump-shop-action').click();
        assertEqual(shopBalance(root), 10, 'монеты на месте');
        assert(!gameSkins().owned.includes('ghost'), 'скин не выдан');
    });

    // Самый дорогой скин — конец ценовой лестницы: его и проверяем на обеих границах,
    // иначе «денег хватает» тестировалось бы только на первой ступеньке.
    const top = SKIN_REGISTRY[SKIN_REGISTRY.length - 1];

    function reopenShop(coins) {
        getSettings().games.doodlejump.wallet.coins = coins;
        root.querySelector('.doodlejump-shop-close').click();
        root.querySelector('.doodlejump-shop-open').click();
    }

    test('монеты на одну меньше цены — самый дорогой скин не выдают', () => {
        reopenShop(top.price - 1);
        assertEqual(shopBalance(root), top.price - 1, 'баланс перечитан');
        shopItem(root, top.id).querySelector('.doodlejump-shop-action').click();
        assertEqual(shopBalance(root), top.price - 1, 'монеты на месте');
        assert(!gameSkins().owned.includes(top.id), `${top.id} не выдан`);
    });

    test('ровно по цене — самый дорогой скин покупается и надевается', () => {
        reopenShop(top.price);
        shopItem(root, top.id).querySelector('.doodlejump-shop-action').click();
        assertEqual(shopBalance(root), 0, 'списано ровно всё');
        assert(gameSkins().owned.includes(top.id), `${top.id} в купленных`);
        assertEqual(gameSkins().current, top.id, 'и надет');
        assert(shopItem(root, top.id).classList.contains('is-worn'), 'плитка перерисована надетой');

        // Возвращаем форму по умолчанию: проверки ниже ищут фигурку по заливке шириной
        // PLAYER_W, а её оставляет только прямоугольный силуэт.
        shopItem(root, DEFAULT_SKIN).querySelector('.doodlejump-shop-action').click();
        assertEqual(gameSkins().current, DEFAULT_SKIN, 'надет бесплатный');
    });

    test('закрытие магазина возвращает игру', () => {
        root.querySelector('.doodlejump-shop-close').click();
        assertEqual(root.querySelector('.doodlejump-shop').style.display, 'none', 'магазин закрыт');
        assertEqual(root.querySelector('.doodlejump-status').textContent, '', 'паузы больше нет');

        frame();
        const before = lastPlayerX();
        frames(8);
        assert(lastPlayerX() > before, 'фигурка снова едет вправо');
        key('keyup', 'ArrowRight');
    });

    test('магазин открывается и с экрана проигрыша', () => {
        key('keydown', 'ArrowRight');
        const overlay = root.querySelector('.doodlejump-over');
        let guard = 0;
        while (overlay.style.display !== 'flex' && guard < 900) {
            frame();
            guard += 1;
        }
        key('keyup', 'ArrowRight');
        assertEqual(overlay.style.display, 'flex', `заезд кончился (кадров: ${guard})`);

        const openBtn = overlay.querySelector('.doodlejump-over-shop');
        assert(openBtn, 'кнопка магазина на экране проигрыша');
        openBtn.click();
        assertEqual(root.querySelector('.doodlejump-shop').style.display, 'flex', 'магазин открыт поверх');

        // Enter за спиной у витрины новый заезд не начинает.
        const played = getSettings().games.doodlejump.stats.played;
        key('keydown', 'Enter');
        assertEqual(getSettings().games.doodlejump.stats.played, played, 'заезд не начат');

        root.querySelector('.doodlejump-shop-close').click();
        assertEqual(overlay.style.display, 'flex', 'экран проигрыша на месте');
    });
});

// Скин, которого нет в реестре (переименовали, правили settings.json руками): отрисовка
// обязана падать на бесплатный, а не ронять экран.
getSettings().games.doodlejump.skins = { owned: ['default', 'нетакого'], current: 'нетакого' };

await session({ gameId: 'doodlejump' }, async (root) => {
    test('битый current падает на default, отрисовка не роняется', () => {
        frame();
        assert(root.querySelector('.doodlejump-canvas'), 'экран жив');
        assert(lastPlayerX() !== null, 'фигурка нарисована формой по умолчанию');
        frames(5);
        assert(lastPlayerX() !== null, 'и продолжает рисоваться кадр за кадром');
    });
});

getSettings().games.doodlejump.skins = { owned: ['default'], current: 'default' };

// --- Панель настроек при открытом экране: настройки живые.

await session({ gameId: 'doodlejump' }, async (root) => {
    const settings = getSettings().games.doodlejump;

    test('переключатель кнопок доезжает до открытого экрана', () => {
        const container = document.createElement('div');
        // Тот же api, что собирает панель настроек хаба: живые настройки игры и
        // onSettingsChanged, пинающий открытое окно.
        doodlejumpGame.renderSettings(container, {
            settings,
            save: () => {},
            onSettingsChanged: () => refresh(),
        });

        const buttons = root.querySelector('.doodlejump-buttons');
        assertEqual(buttons.style.display, '', 'кнопки видны');

        const cb = container.querySelector('#doodlejump_show_buttons');
        cb.checked = false;
        cb.dispatchEvent(new dom.window.Event('change'));
        assertEqual(buttons.style.display, 'none', 'refresh() спрятал кнопки');

        cb.checked = true;
        cb.dispatchEvent(new dom.window.Event('change'));
        assertEqual(buttons.style.display, '', 'и вернул обратно');
    });

    test('смена сложности доезжает до идущей партии', () => {
        const container = document.createElement('div');
        doodlejumpGame.renderSettings(container, { settings, save: () => {} });

        const sel = container.querySelector('#doodlejump_difficulty');
        sel.value = 'hard';
        sel.dispatchEvent(new dom.window.Event('change'));
        assertEqual(settings.difficulty, 'hard', 'настройка записана');

        // Экран перечитывает сложность каждый кадр — генератор новых платформ узнаёт о
        // ней без рестарта.
        ensureAlive(root);
        frames(3);
        assertEqual(getSettings().games.doodlejump.difficulty, 'hard', 'кадр настройку не затёр');

        sel.value = 'normal';
        sel.dispatchEvent(new dom.window.Event('change'));
    });
});

// --- Настройки и статистика на голом api.

test('renderSettings рисует выбор сложности и два чекбокса, пишет в настройки', () => {
    let saved = 0;
    const api = {
        settings: { stats: {}, difficulty: 'normal', movingPlatforms: true, showButtons: true },
        save: () => { saved += 1; },
    };
    const container = document.createElement('div');

    doodlejumpGame.renderSettings(container, api);

    const sel = container.querySelector('#doodlejump_difficulty');
    assert(sel, 'селект сложности на месте');
    assertEqual(sel.options.length, 3, 'три уровня');
    assertEqual([...sel.options].map((o) => o.textContent).join(','), 'Лёгкая,Обычная,Сложная', 'русские подписи');
    assertEqual(sel.value, 'normal', 'выбрана текущая сложность');

    sel.value = 'hard';
    sel.dispatchEvent(new dom.window.Event('change'));
    assertEqual(api.settings.difficulty, 'hard', 'сложность записана');

    const moving = container.querySelector('#doodlejump_moving_platforms');
    assert(moving, 'чекбокс движущихся платформ на месте');
    assertEqual(moving.checked, true, 'по умолчанию включён');
    moving.checked = false;
    moving.dispatchEvent(new dom.window.Event('change'));
    assertEqual(api.settings.movingPlatforms, false, 'платформы выключены');

    const boosters = container.querySelector('#doodlejump_boosters');
    assert(boosters, 'чекбокс бустеров на месте');
    assertEqual(boosters.checked, true, 'по умолчанию включены');
    boosters.checked = false;
    boosters.dispatchEvent(new dom.window.Event('change'));
    assertEqual(api.settings.boosters, false, 'бустеры выключены');

    const showButtons = container.querySelector('#doodlejump_show_buttons');
    assert(showButtons, 'чекбокс кнопок на месте');
    showButtons.checked = false;
    showButtons.dispatchEvent(new dom.window.Event('change'));
    assertEqual(api.settings.showButtons, false, 'кнопки выключены');

    assertEqual(saved, 4, 'каждое изменение сохранено');
});

test('renderSettings падает на «обычную» при битой сложности из settings.json', () => {
    const api = { settings: { stats: {}, difficulty: 'нечто' }, save: () => {} };
    const container = document.createElement('div');
    doodlejumpGame.renderSettings(container, api);
    assertEqual(container.querySelector('#doodlejump_difficulty').value, 'normal', 'выбрана обычная');
});

test('renderStats рисует статистику, кошелёк и кнопку сброса', () => {
    let saved = false;
    let rerendered = false;
    const api = {
        settings: { stats: { played: 4, bestScore: 1200, bestPlatforms: 27 }, wallet: { coins: 42 } },
        save: () => { saved = true; },
        renderAllStats: () => { rerendered = true; },
    };
    const container = document.createElement('div');

    doodlejumpGame.renderStats(container, api);

    const texts = [...container.querySelectorAll('div')].map((el) => el.textContent);
    assert(texts.includes('Сыграно: 4'), 'сыграно');
    assert(texts.includes('Лучшая высота: 1200'), 'лучшая высота');
    assert(texts.includes('Лучший забег по платформам: 27'), 'лучший забег по платформам');
    assert(texts.includes('Монет в кошельке: 42'), 'кошелёк рядом со статистикой');

    const reset = container.querySelector('button');
    assert(reset, 'кнопка сброса на месте');
    reset.click();
    assertEqual(Object.keys(api.settings.stats).length, 0, 'статистика очищена');
    assertEqual(api.settings.wallet.coins, 42, 'сброс статистики кошелёк не тронул');
    assert(saved, 'сохранено после сброса');
    assert(rerendered, 'статистика перерисована');
});

test('renderStats без статистики не показывает кнопку сброса', () => {
    const container = document.createElement('div');
    doodlejumpGame.renderStats(container, { settings: { stats: {} }, save: () => {}, renderAllStats: () => {} });
    assertEqual(container.querySelector('button'), null, 'сбрасывать нечего');
    assert(container.textContent.includes('Сыграно: 0'), 'нули всё равно показаны');
});

// --- Отрисовка типов платформ: голый view, состояние собирается руками.

await test('view красит типы платформ по-разному, рисует пружинку и трещины', async () => {
    const { createView } = await import('../../src/games/doodlejump/ui/view.js');
    const view = createView();
    const state = {
        cameraY: 0,
        player: { x: 180, y: 200, facing: 1 },
        platforms: [
            { id: 1, x: 10, y: 100, w: 66, kind: 'normal' },
            { id: 2, x: 90, y: 160, w: 66, kind: 'moving', vx: 60 },
            { id: 3, x: 170, y: 220, w: 66, kind: 'spring' },
            { id: 4, x: 250, y: 280, w: 66, kind: 'crumbling' },
            { id: 5, x: 250, y: 340, w: 66, kind: 'crumbling', broken: true },
        ],
    };

    fills.length = 0;
    lines.length = 0;
    view.draw(state);

    // В jsdom переменных палитры нет — view.js берёт фолбэки, и они у типов разные.
    const PLATFORM_PX = 66 * SCALE;
    const byKind = state.platforms.map((p) => {
        const hit = fills.find((f) => Math.abs(f.w - PLATFORM_PX) < 0.6 && Math.abs(f.y - p.y * SCALE) < 0.6);
        return hit ? hit.style : null;
    });
    assert(byKind.every(Boolean), 'все пять платформ нарисованы');
    assertEqual(new Set(byKind).size, 4, 'четыре цвета: обычная, движущаяся, пружина, хрупкая');
    assertEqual(byKind[3], byKind[4], 'сломанная остаётся того же цвета, что и целая');

    // Пружинка — зигзаг над верхней гранью пружины; трещины — три линии во всю высоту
    // сломанной платформы.
    const springTop = 220 * SCALE;
    const coil = lines.filter((l) => l.from.y <= springTop + 0.6 && l.to.y < springTop);
    assertEqual(coil.length, 3, 'пружинка из трёх звеньев над платформой');

    const brokenTop = 340 * SCALE;
    const cracks = lines.filter((l) => Math.abs(l.from.y - brokenTop) < 0.6 && l.to.y > l.from.y);
    assertEqual(cracks.length, 3, 'три трещины на сломанной платформе');
    assert(cracks.every((l) => l.style === byKind[4]), 'трещины цветом хрупкой платформы');

    // Целая хрупкая — без трещин: они и есть сигнал «опоры больше нет».
    const wholeTop = 280 * SCALE;
    assertEqual(lines.filter((l) => Math.abs(l.from.y - wholeTop) < 0.6).length, 0, 'у целой хрупкой трещин нет');
    view.destroy();
});

await test('view рисует бустеры разными силуэтами, а полёт — полоской остатка', async () => {
    const { createView } = await import('../../src/games/doodlejump/ui/view.js');
    const view = createView();
    const state = {
        cameraY: 0,
        player: { x: 180, y: 200, facing: 1, boost: null },
        platforms: [{ id: 1, x: 170, y: 260, w: 66, kind: 'normal' }],
        pickups: [
            { id: 2, kind: 'propeller', x: 40, y: 120, w: PICKUP_W },
            { id: 3, kind: 'rocket', x: 260, y: 120, w: PICKUP_W },
            { id: 4, kind: 'rocket', x: 150, y: 120, w: PICKUP_W, taken: true },
        ],
    };

    fills.length = 0;
    view.draw(state);
    // Заливки предмета: в его колонке и на его высоте — иначе в выборку попала бы
    // платформа, стоящая ниже в той же колонке.
    const atX = (x) => fills.filter((f) => f.x >= x * SCALE - 0.6
        && f.x < (x + PICKUP_W) * SCALE + 0.6
        && f.y < 200 * SCALE);
    const propeller = atX(40);
    const rocket = atX(260);
    assert(propeller.length >= 2, 'пропеллер нарисован не одним прямоугольником');
    assert(rocket.length >= 4, 'у ракеты корпус, хвост и два крыла');
    assertEqual(new Set([propeller[0].style, rocket[0].style]).size, 2, 'у пропеллера и ракеты разные цвета');
    assertEqual(atX(150).length, 0, 'подобранный предмет не рисуется');

    // Полоска остатка — над фигуркой, ровно две заливки: подложка и заполнение.
    fills.length = 0;
    state.player.boost = { kind: 'rocket', msLeft: BOOST.rocket.ms / 2, vy: BOOST.rocket.vy };
    view.draw(state);
    const gauge = fills.filter((f) => f.y < state.player.y * SCALE && f.x === 180 * SCALE);
    assertEqual(gauge.length, 2, 'подложка и заполнение');
    assertClose2(gauge[1].w, gauge[0].w / 2, 0.6, 'заполнение — половина: полёт пройден наполовину');

    view.destroy();
});

// --- createDrag напрямую: арифметика намерения и снятие слушателей.
//
// Через смонтированный экран это не проверить: destroy() уносит канвас из дерева вместе
// со слушателями, и «слушателя больше нет» стало бы неотличимо от «элемента больше нет».

await test('createDrag: намерение — доля расстояния до пальца, а destroy снимает слушатели', async () => {
    const { createDrag } = await import('../../src/games/doodlejump/ui/controls.js');
    const canvas = stubRect(document.createElement('canvas'));
    document.body.appendChild(canvas);

    const seen = [];
    let playerX = 180; // центр фигурки — 200 wu, ровно середина мира
    const drag = createDrag({ canvas, getPlayerX: () => playerX, onInput: (dir) => seen.push(dir) });

    // Палец в 30 wu правее центра фигурки: половина STEER_ZONE = половина хода.
    // clientX = wu·(320/WORLD_W).
    pointer(canvas, 'pointerdown', 230 * (320 / WORLD_W));
    assertEqual(seen.length, 1, 'касание сразу задало намерение');
    assert(Math.abs(seen[0] - 0.5) < 1e-6, `половина хода, а не полный: ${seen[0]}`);

    // Палец не двигался, а фигурка приехала — намерение обязано пересчитаться само.
    playerX = 210;
    drag.update();
    assert(Math.abs(seen[seen.length - 1]) < 1e-6, 'приехали к пальцу — ход нулевой');

    pointer(canvas, 'pointerup', 230 * (320 / WORLD_W));
    assertEqual(seen[seen.length - 1], null, 'палец отпущен — управление возвращено');

    drag.destroy();
    const before = seen.length;
    pointer(canvas, 'pointerdown', 10);
    pointer(canvas, 'pointermove', 300);
    assertEqual(seen.length, before, 'после destroy события не слушаются');
    canvas.remove();
});

// --- Снятие слушателей.

test('destroy снимает keydown и keyup с document', () => {
    const down = key('keydown', 'ArrowRight');
    assert(!down.defaultPrevented, 'keydown больше не перехватывается');
    const up = key('keyup', 'ArrowRight');
    assert(!up.defaultPrevented, 'keyup больше не перехватывается');
});

test('destroy отменяет кадр rAF', () => {
    assert(cancelled.includes(rafCallbacks.length), 'cancelAnimationFrame вызван с последним кадром');
});

test('destroy снимает visibilitychange/blur/focus и кадры больше не идут', () => {
    const passBefore = mock2d.pass;
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    window.dispatchEvent(new dom.window.Event('blur'));
    window.dispatchEvent(new dom.window.Event('focus'));
    // Кадр, уже стоявший в очереди, обязан выйти по флагу destroyed, ничего не нарисовав.
    frame();
    assertEqual(mock2d.pass, passBefore, 'отрисовки после destroy нет');
});

test('после закрытия попапа isOpen() === false', () => {
    assertEqual(isOpen(), false, 'сессия закрыта');
});

report('doodlejump ui');
