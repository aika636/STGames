// Тесты экрана сапёра под jsdom (Фаза 10.3): монтирование через оболочку, первый клик
// (поле рождается вместе с ним), флажок правой кнопкой и долгим нажатием, клавиатура,
// победа и взрыв на восстановленной партии.
//
// Отдельного теста «destroy() снимает таймер» нет — он встроен в сам прогон: незакрытый
// setInterval jsdom'а держит процесс живым, и файл просто не завершился бы.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/minesweeper/ui.test.mjs

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
// toast() из src/ctx.js зовёт амбиентный toastr, а не ctx.toastr: без глобали сообщения
// уходили бы в лог, и тест «поздравление показано» проверял бы пустоту.
globalThis.toastr = context.toastr;

const { clear, register } = await import('../../src/registry.js');
const minesweeperGame = (await import('../../src/games/minesweeper/index.js')).default;
const snakeGame = (await import('../../src/games/snake/index.js')).default;
const { isOpen, openShell } = await import('../../src/shell/modal.js');
const { getGameSettings } = await import('../../src/settings.js');
const engine = await import('../../src/games/minesweeper/core/engine.js');
const { readEntry } = await import('../../src/games/minesweeper/core/stats.js');

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

const settings = () => getGameSettings('minesweeper', minesweeperGame.defaults);
const cells = (root) => [...root.querySelectorAll('.minesweeper-cell')];
const cellAt = (root, index) => root.querySelector(`.minesweeper-cell[data-idx="${index}"]`);
const countOf = (root, cls) => root.querySelectorAll(`.minesweeper-cell.${cls}`).length;
const statusOf = (root) => root.querySelector('.minesweeper-status').textContent;

// jsdom не реализует PointerEvent, а игре от него нужны только координаты и pointerType.
function pointer(type, target, { pointerType = 'touch', x = 0, y = 0 } = {}) {
    const event = new dom.window.MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
    });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    target.dispatchEvent(event);
    return event;
}

function key(root, name) {
    const event = new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    root.querySelector('.minesweeper-board').dispatchEvent(event);
    return event;
}

// Партия, в которой открыто всё, кроме одной безопасной клетки: так победа и взрыв
// проверяются через настоящий экран, а не подкруткой его внутренностей. Мины — верхняя
// строка плюс одна клетка второй.
function nearlyWonGame(target) {
    const board = engine.BOARDS.easy;
    const mines = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const state = engine.createGame(board);
    engine.plant(state, mines);
    for (let i = 0; i < board.cols * board.rows; i++) {
        if (!state.mine[i] && i !== target) state.open[i] = 1;
    }
    state.elapsed = 12;
    return { ...engine.serialize(state), level: 'easy' };
}

console.log('minesweeper ui (jsdom)');

clear();
register(minesweeperGame);
register(snakeGame);

// --- Хаб и монтирование

await session({}, async (root) => {
    test('плитка сапёра в хабе', () => {
        assert(isOpen(), 'окно открыто');
        const tile = root.querySelector('.stg-tile[data-game-id="minesweeper"]');
        assert(tile, 'плитка на месте');
        assertEqual(tile.querySelector('.stg-tile-title').textContent, 'Сапёр', 'название');
        assert(tile.querySelector('i.fa-bomb'), 'иконка');
    });
});

await session({ gameId: 'minesweeper' }, async (root) => {
    test('mount строит поле уровня, шапку и счётчик мин', () => {
        assertEqual(cells(root).length, 81, 'клеток на лёгком уровне');
        assertEqual(root.querySelector('.minesweeper-counter').textContent, '💣 10', 'счётчик мин');
        assertEqual(root.querySelector('.minesweeper-timer').textContent, '00:00', 'таймер на нуле');
        assertEqual(root.querySelector('.minesweeper-select').value, 'easy', 'селектор уровня');
        assertEqual(countOf(root, 'minesweeper-open'), 0, 'поле закрыто целиком');
    });

    test('до первого клика партия не засчитана', () => {
        assertEqual(readEntry(settings().stats, 'easy').played, 0, 'сыграно');
    });

    test('клетки — gridcell с roving tabindex, а не кнопки', () => {
        assertEqual(root.querySelectorAll('.minesweeper-cell button').length, 0, 'кнопок внутри поля нет');
        const focusable = cells(root).filter((c) => c.tabIndex === 0);
        assertEqual(focusable.length, 1, 'фокусируема ровно одна клетка');
        assertEqual(
            root.querySelector('.minesweeper-board').getAttribute('aria-activedescendant'),
            focusable[0].id,
            'курсор объявлен через aria-activedescendant',
        );
    });

    test('флажок правой кнопкой, контекстное меню браузера погашено', () => {
        const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        cellAt(root, 40).dispatchEvent(event);
        assert(event.defaultPrevented, 'меню браузера не всплывает');
        assertEqual(countOf(root, 'minesweeper-flag'), 1, 'флажок поставлен');
        assertEqual(root.querySelector('.minesweeper-counter').textContent, '💣 9', 'счётчик мин уменьшился');

        cellAt(root, 40).dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        assertEqual(countOf(root, 'minesweeper-flag'), 0, 'повторная правая кнопка снимает флажок');
    });

    test('клик по помеченной клетке её не открывает', () => {
        cellAt(root, 40).dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        cellAt(root, 40).click();
        assertEqual(countOf(root, 'minesweeper-open'), 0, 'поле по-прежнему закрыто');
        assertEqual(countOf(root, 'minesweeper-flag'), 1, 'флажок на месте');
        cellAt(root, 40).dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });

    test('первый клик рождает поле и не может попасть на мину', () => {
        cellAt(root, 40).click();
        assert(countOf(root, 'minesweeper-open') > 0, 'клетки открылись');
        assertEqual(countOf(root, 'minesweeper-boom'), 0, 'взрыва нет');
        assert(!statusOf(root), 'партия идёт');
        assertEqual(readEntry(settings().stats, 'easy').played, 1, 'партия засчитана в «сыграно»');
        assert(settings().savedGame, 'партия сохранена');
    });

    test('первый клик открывает область, а не одинокую цифру', () => {
        // Мины нет ни под кликом, ни рядом с ним, поэтому под ним всегда ноль и разлив.
        assert(countOf(root, 'minesweeper-open') >= 9, 'открылась область');
    });

    // Асинхронные тесты обязательно с await: без него они уехали бы за конец сессии,
    // где экрана уже нет (правило tests/_harness.mjs).
    await test('долгое нажатие ставит флажок и гасит клик, который идёт следом', () => {
        const target = cells(root).find((c) => !c.classList.contains('minesweeper-open'));
        const index = Number(target.dataset.idx);
        const before = countOf(root, 'minesweeper-open');

        pointer('pointerdown', target, { x: 10, y: 10 });
        return new Promise((resolve) => {
            setTimeout(() => {
                pointer('pointerup', target, { x: 10, y: 10 });
                cellAt(root, index).click();

                assertEqual(countOf(root, 'minesweeper-flag'), 1, 'флажок поставлен долгим нажатием');
                assertEqual(countOf(root, 'minesweeper-open'), before, 'клетка не открылась');
                resolve();
            }, 450);
        });
    });

    await test('уехавший палец — это прокрутка, а не флажок', () => {
        const target = cells(root).find(
            (c) => !c.classList.contains('minesweeper-open') && !c.classList.contains('minesweeper-flag'),
        );
        pointer('pointerdown', target, { x: 10, y: 10 });
        pointer('pointermove', target, { x: 10, y: 80 });
        return new Promise((resolve) => {
            setTimeout(() => {
                pointer('pointerup', target, { x: 10, y: 80 });
                assertEqual(countOf(root, 'minesweeper-flag'), 1, 'второго флажка не появилось');
                resolve();
            }, 450);
        });
    });

    await test('мышью долгое нажатие флажок не ставит — у неё есть правая кнопка', () => {
        const target = cells(root).find(
            (c) => !c.classList.contains('minesweeper-open') && !c.classList.contains('minesweeper-flag'),
        );
        pointer('pointerdown', target, { pointerType: 'mouse' });
        return new Promise((resolve) => {
            setTimeout(() => {
                pointer('pointerup', target, { pointerType: 'mouse' });
                assertEqual(countOf(root, 'minesweeper-flag'), 1, 'флажков всё ещё один');
                resolve();
            }, 450);
        });
    });

    test('стрелка двигает курсор, F ставит флажок, чужие клавиши уходят к таверне', () => {
        const board = root.querySelector('.minesweeper-board');
        const before = board.getAttribute('aria-activedescendant');

        const arrow = key(root, 'ArrowDown');
        assert(arrow.defaultPrevented, 'стрелка обработана игрой');
        assert(board.getAttribute('aria-activedescendant') !== before, 'курсор сдвинулся');

        // Курсор ставится на заведомо закрытую клетку правой кнопкой: на открытой
        // клетке флажку взяться неоткуда, и тест проверял бы не то.
        const free = cells(root).find(
            (c) => !c.classList.contains('minesweeper-open') && !c.classList.contains('minesweeper-flag'),
        );
        const menu = () => free.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        menu();
        menu();

        const flags = countOf(root, 'minesweeper-flag');
        const flag = key(root, 'f');
        assert(flag.defaultPrevented, 'F обработана игрой');
        assertEqual(countOf(root, 'minesweeper-flag'), flags + 1, 'флажок с клавиатуры');
        key(root, 'а');
        assertEqual(countOf(root, 'minesweeper-flag'), flags, 'та же клавиша в ЙЦУКЕН снимает флажок');

        assert(!key(root, 'q').defaultPrevented, 'необработанная клавиша уходит к таверне');
        assert(!key(root, 'Escape').defaultPrevented, 'Esc не перехватывается — его получает попап');
    });

    test('«Новая игра» закрывает поле и не засчитывает партию заново', () => {
        const played = readEntry(settings().stats, 'easy').played;
        root.querySelector('.minesweeper-btn').click();
        assertEqual(countOf(root, 'minesweeper-open'), 0, 'поле закрыто');
        assertEqual(countOf(root, 'minesweeper-flag'), 0, 'флажки сняты');
        assertEqual(readEntry(settings().stats, 'easy').played, played, '«сыграно» не выросло');
    });
});

// --- Победа и взрыв на подготовленной партии

await session({}, async () => {
    test('подготовка: почти доигранная партия ложится в настройки', () => {
        settings().savedGame = nearlyWonGame(80);
        settings().stats = {};
        assert(settings().savedGame.started, 'поле в сохранении уже засеяно');
    });
});

await session({ gameId: 'minesweeper' }, async (root) => {
    test('восстановленная партия открывается там же, где закончилась', () => {
        assertEqual(countOf(root, 'minesweeper-open'), 70, 'открытые клетки на месте');
        assertEqual(root.querySelector('.minesweeper-timer').textContent, '00:12', 'время продолжается');
        assertEqual(readEntry(settings().stats, 'easy').played, 0, 'повторно партия не засчитана');
    });

    test('последняя клетка приносит победу: статистика, рекорд и тост', () => {
        toasts.length = 0;
        cellAt(root, 80).click();

        assert(statusOf(root).startsWith('Поле разминировано'), 'строка статуса');
        assertEqual(countOf(root, 'minesweeper-flag'), 10, 'мины помечены сами');
        assertEqual(root.querySelector('.minesweeper-counter').textContent, '💣 0', 'счётчик мин обнулён');

        const entry = readEntry(settings().stats, 'easy');
        assertEqual(entry.wins, 1, 'победа записана');
        assert(entry.bestTime !== null, 'рекорд времени записан');
        assert(toasts.some((t) => t.kind === 'success'), 'поздравление показано');
    });

    test('доигранная партия не восстанавливается — экран ждёт новую', () => {
        assert(settings().savedGame.over, 'в настройках лежит законченная партия');
    });
});

await session({}, async () => {
    test('подготовка: партия под взрыв', () => {
        settings().savedGame = nearlyWonGame(80);
        settings().stats = {};
    });
});

await session({ gameId: 'minesweeper' }, async (root) => {
    test('клик по мине заканчивает партию и показывает поле', () => {
        // Клетка 3 — мина по построению. Клетка 80 — единственная закрытая клетка без
        // мины, на ней и ставим заведомо неверный флажок.
        cellAt(root, 80).dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        cellAt(root, 3).click();

        assertEqual(statusOf(root), 'Взрыв. Нажмите «Новая игра».', 'строка статуса');
        assert(cellAt(root, 3).classList.contains('minesweeper-boom'), 'клетка взрыва отмечена');
        // Мины видны все десять, включая ту, на которой взорвались: у неё сверху своя
        // метка, но саму мину она не заменяет.
        assertEqual(countOf(root, 'minesweeper-mine'), 10, 'мины показаны');
        assert(cellAt(root, 80).classList.contains('minesweeper-wrong'), 'неверный флажок помечен');
        assertEqual(readEntry(settings().stats, 'easy').wins, 0, 'победа не засчитана');
    });

    test('после конца партии клики по полю ничего не делают', () => {
        const before = countOf(root, 'minesweeper-open');
        cellAt(root, 80).click();
        assertEqual(countOf(root, 'minesweeper-open'), before, 'поле не изменилось');
    });
});

report('minesweeper/ui');
