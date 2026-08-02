// Тесты UI змейки под jsdom (Фаза 6): монтирование экрана через оболочку, направление
// со стрелки и с d-pad, оверлей смерти, снятие слушателей в destroy(), хаб с двумя
// плитками.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/snake/ui.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from '../_harness.mjs';

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

const context = {
    extensionSettings: {},
    saveSettingsDebounced: () => {},
    POPUP_TYPE: { TEXT: 1, DISPLAY: 4 },
    callGenericPopup: null,
};

globalThis.SillyTavern = { getContext: () => context };

// jsdom без пакета canvas не умеет 2d-контекст: подменяем getContext записывающей
// заглушкой, чтобы draw() работал и тест мог видеть сдвиг головы между тиками.
// Каждая отрисовка начинается с clearRect (номер кадра), первый fillRect кадра —
// голова змейки.
const fills = [];
const mock2d = {
    pass: -1,
    clearRect() { this.pass += 1; },
    fillRect(x, y, w, h) { fills.push({ pass: this.pass, x, y, w, h }); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    arc() {},
    fill() {},
};
for (const prop of ['strokeStyle', 'lineWidth', 'fillStyle']) {
    Object.defineProperty(mock2d, prop, { set() {}, configurable: true });
}
window.HTMLCanvasElement.prototype.getContext = () => mock2d;

// Цикл змейки — requestAnimationFrame; в jsdom его неоткуда крутить, поэтому собираем
// колбэки в массив и шагаем вручную с фиктивным временем (тик каждые 170 мс).
const rafCallbacks = [];
const cancelled = [];
globalThis.requestAnimationFrame = (cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
};
globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id);
};

// Еда всегда в углу (0,0): траектория головы в тесте её не задевает, и длина змейки
// между проверяемыми тиками не меняется.
const originalRandom = Math.random;
Math.random = () => 0.001;

const { clear, register } = await import('../../src/registry.js');
const sudokuGame = (await import('../../src/games/sudoku/index.js')).default;
const snakeGame = (await import('../../src/games/snake/index.js')).default;
const { isOpen, openShell } = await import('../../src/shell/modal.js');
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

console.log('snake ui (jsdom)');

// --- Хаб: две игры в реестре, плитка змейки на месте.

clear();
register(sudokuGame);
register(snakeGame);

await session({}, async (root) => {
    test('openShell() показывает хаб с двумя плитками', () => {
        assert(isOpen(), 'окно открыто');
        const hub = root.querySelector('.stg-hub');
        assert(hub, 'хаб на месте');
        assertEqual(hub.querySelectorAll('.stg-tile').length, 2, 'плиток две');

        const snakeTile = hub.querySelector('.stg-tile[data-game-id="snake"]');
        assert(snakeTile, 'плитка змейки на месте');
        assertEqual(snakeTile.querySelector('.stg-tile-title').textContent, 'Змейка', 'название');
        assertEqual(snakeTile.querySelector('.stg-tile-tagline').textContent, 'Аркада: ешь, расти, не врезайся', 'подпись');
        assert(snakeTile.querySelector('i.fa-worm'), 'иконка змейки');
    });
});

// --- Экран змейки: canvas, d-pad, направление со стрелки и с кнопки, смерть.

await session({ gameId: 'snake' }, async (root) => {
    test('openShell({ gameId: "snake" }) монтирует canvas, d-pad и шапку', () => {
        assert(root.querySelector('.snake-canvas'), 'canvas на месте');
        assert(root.querySelector('.snake-dpad'), 'd-pad на месте');
        assertEqual(root.querySelectorAll('.snake-dpad-grid .snake-dpad-btn').length, 4, 'четыре стрелки крестом');
        assert(root.querySelector('.snake-dpad-pause'), 'кнопка паузы на месте');
        assertEqual(root.querySelectorAll('.snake-header span').length, 3, 'счёт, длина и рекорд');
        assert(root.querySelector('.snake-status'), 'строка статуса');
    });

    test('стрелка вверх меняет направление — голова сдвигается после тика', () => {
        // Первый кадр тика не делает (0 < 170 мс), второй двигает голову вправо —
        // стартовое направление. Это базовая линия до нажатия.
        rafCallbacks[0](0);
        rafCallbacks[1](170);

        const event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        assert(event.defaultPrevented, 'стрелка погашена игрой');

        rafCallbacks[2](340); // следующий тик — уже по направлению из очереди

        const headRight = fills.find((f) => f.pass === 1);
        const headUp = fills.find((f) => f.pass === 2);
        assert(headRight && headUp, 'два отрисованных кадра');
        assertEqual(headUp.x, headRight.x, 'столбец не изменился');
        assert(headUp.y < headRight.y, 'голова сдвинулась вверх');
    });

    test('кнопка d-pad делает то же', () => {
        const event = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
        root.querySelector('.snake-dpad-up').dispatchEvent(event);
        assert(event.defaultPrevented, 'mousedown отменён');

        rafCallbacks[3](510); // тик: снова вверх

        const headArrow = fills.find((f) => f.pass === 2);
        const headDpad = fills.find((f) => f.pass === 3);
        assert(headArrow && headDpad, 'кадры на месте');
        assertEqual(headDpad.x, headArrow.x, 'столбец тот же');
        assert(headDpad.y < headArrow.y, 'голова сдвинулась вверх');
    });

    test('смерть показывает оверлей и записывает рекорд', () => {
        // Девять тиков вверх от y=8 упираются в стену: счёт не растёт, рекорд — по длине.
        for (let i = 0; i < 9; i++) {
            const key = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
            document.dispatchEvent(key);
            rafCallbacks[rafCallbacks.length - 1](680 + i * 170);
        }

        const overlay = root.querySelector('.snake-over');
        assert(overlay, 'оверлей на месте');
        assertEqual(overlay.style.display, 'flex', 'оверлей показан');
        assert(overlay.textContent.includes('Счёт'), 'в оверлее счёт');

        const stats = getSettings().games.snake.stats;
        assertEqual(stats.played, 1, 'сыграно один заезд');
        assertEqual(stats.bestLength, 3, 'длина записана');
        assertEqual(stats.bestScore, 0, 'счёт ноль — рекорд не по счёту');
    });
});

test('destroy снимает слушатель keydown с document', () => {
    const event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    assert(!event.defaultPrevented, 'стрелка больше не перехватывается');
});

test('destroy отменяет кадр rAF', () => {
    assert(cancelled.includes(rafCallbacks.length), 'cancelAnimationFrame вызван с последним кадром');
});

test('после закрытия попапа isOpen() === false', () => {
    assertEqual(isOpen(), false, 'сессия закрыта');
});

// --- Панель настроек и статистика по контракту реестра.

test('renderSettings рисует чекбокс сетки и сохраняет значение', () => {
    let saved = false;
    const api = {
        settings: { stats: {}, showGrid: false },
        save: () => { saved = true; },
    };
    const container = document.createElement('div');

    snakeGame.renderSettings(container, api);

    const cb = container.querySelector('#snake_show_grid');
    assert(cb, 'чекбокс на месте');
    assertEqual(cb.checked, false, 'по умолчанию выключен');

    cb.checked = true;
    cb.dispatchEvent(new dom.window.Event('change'));
    assertEqual(api.settings.showGrid, true, 'настройка обновилась');
    assert(saved, 'save вызван');
});

test('renderStats рисует три строки и кнопку сброса', () => {
    let saved = false;
    let rerendered = false;
    const api = {
        settings: { stats: { played: 2, bestScore: 15, bestLength: 12 } },
        save: () => { saved = true; },
        renderAllStats: () => { rerendered = true; },
    };
    const container = document.createElement('div');

    snakeGame.renderStats(container, api);

    const texts = [...container.querySelectorAll('div')].map((el) => el.textContent);
    assert(texts.includes('Сыграно: 2'), 'сыграно');
    assert(texts.includes('Лучший счёт: 15'), 'лучший счёт');
    assert(texts.includes('Лучшая длина: 12'), 'лучшая длина');

    const reset = container.querySelector('button');
    assert(reset, 'кнопка сброса на месте');
    reset.click();
    assertEqual(Object.keys(api.settings.stats).length, 0, 'статистика очищена');
    assert(saved, 'сохранено после сброса');
    assert(rerendered, 'статистика перерисована');
});

report('snake ui');
