// Тесты экрана нонограммы под jsdom (Фаза 11.5): монтирование через оболочку,
// рисование росчерком с фиксацией оси, крестики (правой кнопкой и режимом), клавиатура,
// гашение выполненных подсказок и победа на восстановленной партии.
//
// Отдельного теста «destroy() снимает таймер» нет — он встроен в сам прогон: незакрытый
// setInterval jsdom'а держит процесс живым, и файл просто не завершился бы.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/nonogram/ui.test.mjs

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

const toasts = [];
const context = {
    extensionSettings: {},
    saveSettingsDebounced: () => {},
    POPUP_TYPE: { TEXT: 1, DISPLAY: 4 },
    callGenericPopup: null,
    toastr: {
        info: (msg) => toasts.push({ kind: 'info', msg }),
        success: (msg) => toasts.push({ kind: 'success', msg }),
        error: (msg) => toasts.push({ kind: 'error', msg }),
    },
};

globalThis.SillyTavern = { getContext: () => context };
// toast() из src/ctx.js зовёт амбиентный toastr, а не ctx.toastr.
globalThis.toastr = context.toastr;

const { clear, register } = await import('../../src/registry.js');
const nonogramGame = (await import('../../src/games/nonogram/index.js')).default;
const snakeGame = (await import('../../src/games/snake/index.js')).default;
const { isOpen, openShell } = await import('../../src/shell/modal.js');
const { getGameSettings } = await import('../../src/settings.js');
const { CROSS, FILLED, createGame, serialize } = await import('../../src/games/nonogram/core/game.js');
const { cluesFromGrid } = await import('../../src/games/nonogram/core/solver.js');
const { readEntry } = await import('../../src/games/nonogram/core/stats.js');

// Картинка 5×5 «крестик»: подсказки у неё однозначные, а строки и столбцы разной длины —
// на ней видно и гашение подсказок, и победу.
const PICTURE = [
    1, 0, 0, 0, 1,
    0, 1, 0, 1, 0,
    0, 0, 1, 0, 0,
    0, 1, 0, 1, 0,
    1, 0, 0, 0, 1,
];

const settings = () => getGameSettings('nonogram', nonogramGame.defaults);

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

const cellAt = (root, index) => root.querySelector(`.nonogram-cell[data-idx="${index}"]`);
const countOf = (root, cls) => root.querySelectorAll(`.nonogram-cell.${cls}`).length;

// Партия с известной картинкой: marks — что уже отмечено игроком.
function savedGame(marks = []) {
    const clues = cluesFromGrid(PICTURE, 5, 5);
    const state = createGame({ cols: 5, rows: 5, grid: PICTURE, ...clues });
    for (const [index, mark] of marks) state.marks[index] = mark;
    state.elapsed = 30;
    return { ...serialize(state), level: 'easy' };
}

// jsdom не реализует ни PointerEvent, ни elementFromPoint. Указателю от игры нужны
// только pointerType, кнопка и координаты, а координаты в тесте — это прямо номер
// столбца и строки: подмена elementFromPoint переводит их обратно в клетку.
function installHitTest(root, cols = 5) {
    dom.window.document.elementFromPoint = (x, y) => cellAt(root, y * cols + x) ?? null;
}

function pointer(type, target, { button = 0, x = 0, y = 0 } = {}) {
    const event = new dom.window.MouseEvent(type, {
        bubbles: true, cancelable: true, button, clientX: x, clientY: y,
    });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    target.dispatchEvent(event);
    return event;
}

function tap(root, index, { button = 0 } = {}) {
    const cell = cellAt(root, index);
    pointer('pointerdown', cell, { button, x: index % 5, y: Math.floor(index / 5) });
    pointer('pointerup', cell, { button });
}

function key(root, name) {
    const event = new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    root.querySelector('.nonogram-board').dispatchEvent(event);
    return event;
}

console.log('nonogram ui (jsdom)');

clear();
register(nonogramGame);
register(snakeGame);

await session({}, async (root) => {
    test('плитка нонограммы в хабе', () => {
        assert(isOpen(), 'окно открыто');
        const tile = root.querySelector('.stg-tile[data-game-id="nonogram"]');
        assert(tile, 'плитка на месте');
        assertEqual(tile.querySelector('.stg-tile-title').textContent, 'Нонограмма', 'название');
        assert(tile.querySelector('i.fa-table-cells'), 'иконка');
    });

    test('подготовка: партия с известной картинкой', () => {
        settings().savedGame = savedGame();
        settings().stats = {};
    });
});

await session({ gameId: 'nonogram' }, async (root) => {
    installHitTest(root);

    test('mount строит поле, подсказки по двум сторонам и шапку', () => {
        assertEqual(root.querySelectorAll('.nonogram-cell').length, 25, 'клеток на лёгком уровне');
        assertEqual(root.querySelectorAll('.nonogram-clue-row').length, 5, 'подсказок строк');
        assertEqual(root.querySelectorAll('.nonogram-clue-col').length, 5, 'подсказок столбцов');
        assertEqual(root.querySelector('.nonogram-left').textContent, 'Осталось: 9', 'счётчик клеток');
        assertEqual(root.querySelector('.nonogram-timer').textContent, '00:30', 'время продолжается');
        assertEqual(root.querySelector('.nonogram-mode').textContent, 'Режим: закрасить', 'режим по умолчанию');
    });

    test('до первой отметки партия не засчитана', () => {
        assertEqual(readEntry(settings().stats, 'easy').played, 0, 'сыграно');
    });

    test('тап закрашивает клетку, повторный — стирает', () => {
        tap(root, 0);
        assertEqual(countOf(root, 'nonogram-fill'), 1, 'клетка закрашена');
        assertEqual(root.querySelector('.nonogram-left').textContent, 'Осталось: 8', 'счётчик уменьшился');
        assertEqual(readEntry(settings().stats, 'easy').played, 1, 'партия засчитана');

        tap(root, 0);
        assertEqual(countOf(root, 'nonogram-fill'), 0, 'клетка стёрта');
    });

    test('правая кнопка ставит крестик, а не открывает меню браузера', () => {
        const menu = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        cellAt(root, 1).dispatchEvent(menu);
        assert(menu.defaultPrevented, 'меню браузера погашено');

        tap(root, 1, { button: 2 });
        assertEqual(countOf(root, 'nonogram-cross'), 1, 'крестик поставлен');
        tap(root, 1, { button: 2 });
        assertEqual(countOf(root, 'nonogram-cross'), 0, 'крестик снят');
    });

    test('режим крестика — единственный способ пометить клетку пальцем', () => {
        const mode = root.querySelector('.nonogram-mode');
        mode.click();
        assertEqual(mode.textContent, 'Режим: крестик', 'подпись переключилась');
        assertEqual(mode.getAttribute('aria-pressed'), 'true', 'состояние объявлено');

        tap(root, 2);
        assertEqual(countOf(root, 'nonogram-cross'), 1, 'тап поставил крестик');
        tap(root, 2);
        mode.click();
        assertEqual(countOf(root, 'nonogram-cross'), 0, 'крестик снят, режим вернулся');
    });

    test('росчерк красит линию и держит ось', () => {
        const start = cellAt(root, 0);
        pointer('pointerdown', start, { x: 0, y: 0 });
        pointer('pointermove', start, { x: 1, y: 0 });
        pointer('pointermove', start, { x: 2, y: 0 });
        // Палец дрогнул и уехал на соседнюю строку — росчерк обязан остаться на своей.
        pointer('pointermove', start, { x: 3, y: 1 });
        pointer('pointerup', start);

        assertEqual(countOf(root, 'nonogram-fill'), 4, 'закрашены четыре клетки');
        for (let x = 0; x < 4; x++) {
            assert(cellAt(root, x).classList.contains('nonogram-fill'), `клетка ${x} первой строки`);
        }
        // Клетка (3,1), на которую съехал палец, осталась чистой: сработала её проекция
        // на исходную строку.
        assert(!cellAt(root, 8).classList.contains('nonogram-fill'), 'вторая строка не задета');
    });

    test('росчерк по закрашенному стирает, а не красит попеременно', () => {
        const start = cellAt(root, 0);
        pointer('pointerdown', start, { x: 0, y: 0 });
        pointer('pointermove', start, { x: 1, y: 0 });
        pointer('pointermove', start, { x: 2, y: 0 });
        pointer('pointermove', start, { x: 3, y: 0 });
        pointer('pointerup', start);
        assertEqual(countOf(root, 'nonogram-fill'), 0, 'линия стёрта целиком');
    });

    test('стрелка двигает курсор, Enter красит, X ставит крестик', () => {
        const board = root.querySelector('.nonogram-board');
        const before = board.getAttribute('aria-activedescendant');

        const arrow = key(root, 'ArrowDown');
        assert(arrow.defaultPrevented, 'стрелка обработана игрой');
        assert(board.getAttribute('aria-activedescendant') !== before, 'курсор сдвинулся');

        const enter = key(root, 'Enter');
        assert(enter.defaultPrevented, 'Enter обработан игрой');
        assertEqual(countOf(root, 'nonogram-fill'), 1, 'клетка закрашена с клавиатуры');
        key(root, 'Enter');
        assertEqual(countOf(root, 'nonogram-fill'), 0, 'повторный Enter стирает');

        key(root, 'x');
        assertEqual(countOf(root, 'nonogram-cross'), 1, 'крестик с клавиатуры');
        key(root, 'ч');
        assertEqual(countOf(root, 'nonogram-cross'), 0, 'та же клавиша в ЙЦУКЕН снимает крестик');

        assert(!key(root, 'q').defaultPrevented, 'необработанная клавиша уходит к таверне');
        assert(!key(root, 'Escape').defaultPrevented, 'Esc не перехватывается — его получает попап');
    });

    test('выполненная подсказка гаснет', () => {
        // Верхняя строка картинки — 1 … 1: закрашиваем ровно её края.
        tap(root, 0);
        tap(root, 4);
        const clue = root.querySelectorAll('.nonogram-clue-row')[0];
        assert(clue.classList.contains('nonogram-done'), 'подсказка строки погашена');

        tap(root, 0);
        assert(!clue.classList.contains('nonogram-done'), 'после стирания подсказка вернулась');
        tap(root, 4);
    });

    test('«Новая» берёт другую картинку и обнуляет счётчик партии', () => {
        const played = readEntry(settings().stats, 'easy').played;
        root.querySelector('.nonogram-btn').click();
        assertEqual(countOf(root, 'nonogram-fill'), 0, 'поле чистое');
        assertEqual(readEntry(settings().stats, 'easy').played, played, '«сыграно» не выросло');
    });
});

// --- Победа на подготовленной партии

await session({}, async () => {
    test('подготовка: картинка, где осталась одна клетка', () => {
        const marks = [];
        for (let i = 0; i < PICTURE.length; i++) {
            if (PICTURE[i] && i !== 24) marks.push([i, FILLED]);
        }
        marks.push([1, CROSS]);
        settings().savedGame = savedGame(marks);
        settings().stats = {};
    });
});

await session({ gameId: 'nonogram' }, async (root) => {
    installHitTest(root);

    test('восстановленная партия открывается там же, где закончилась', () => {
        assertEqual(countOf(root, 'nonogram-fill'), 8, 'отметки на месте');
        assertEqual(countOf(root, 'nonogram-cross'), 1, 'крестик на месте');
        assertEqual(root.querySelector('.nonogram-left').textContent, 'Осталось: 1', 'счётчик');
        assertEqual(readEntry(settings().stats, 'easy').played, 0, 'повторно партия не засчитана');
    });

    test('последняя клетка собирает картинку: статистика, рекорд и тост', () => {
        toasts.length = 0;
        tap(root, 24);

        assert(root.querySelector('.nonogram-status').textContent.startsWith('Картинка собрана'), 'строка статуса');
        assertEqual(root.querySelector('.nonogram-left').textContent, 'Готово', 'счётчик закрыт');

        const entry = readEntry(settings().stats, 'easy');
        assertEqual(entry.wins, 1, 'победа записана');
        assert(entry.bestTime !== null, 'рекорд времени записан');
        assert(toasts.some((t) => t.kind === 'success'), 'поздравление показано');
    });

    test('после победы поле заморожено', () => {
        const before = countOf(root, 'nonogram-fill');
        tap(root, 0);
        assertEqual(countOf(root, 'nonogram-fill'), before, 'метки не меняются');
    });
});

report('nonogram/ui');
