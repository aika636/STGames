// Тесты экрана кроссворда-скелета под jsdom (Фаза 12.4): монтирование через оболочку,
// асинхронная загрузка пула головоломок, тап-ввод (слот → слово), переключение
// across/down повторным тапом, замена и снятие слова, отказ по пересечению, победа
// и жизненный цикл destroy().
//
// Партия каждый раз подставляется рукописной головоломкой из _puzzle.mjs, а не берётся
// из настоящего пула: 5×5 и пять слов проверяются глазом, а случайная головоломка
// сделала бы тест зависимым от генератора.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/crossword/ui.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from '../_harness.mjs';
import { ATAKA, FIXTURE, LODKA, MARKA, MEL, RYADY } from './_puzzle.mjs';

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
const crosswordGame = (await import('../../src/games/crossword/index.js')).default;
const snakeGame = (await import('../../src/games/snake/index.js')).default;
const { isOpen, openShell } = await import('../../src/shell/modal.js');
const { getGameSettings } = await import('../../src/settings.js');
const { readEntry } = await import('../../src/games/crossword/core/stats.js');
const { LEVELS, LEVEL_SIZES, levelLabel } = await import('../../src/games/crossword/settings.js');

clear();
register(crosswordGame);
register(snakeGame);

const settings = () => getGameSettings('crossword', crosswordGame.defaults);

// Пул грузится динамическим import(): пока он не приехал, экрана нет. Микротаска здесь
// не поможет — ждём несколько оборотов очереди макрозадач.
async function settle(times = 10) {
    for (let i = 0; i < times; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

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

// Партия по рукописной головоломке. placed — что уже разложено, по слоту.
function savedGame(placed = [-1, -1, -1, -1, -1], elapsed = 30) {
    return {
        ...FIXTURE,
        level: 'easy',
        placed: placed.join(','),
        elapsed,
        over: false,
        won: false,
    };
}

const cellAt = (root, index) => root.querySelector(`.crossword-cell[data-idx="${index}"]`);
const wordAt = (root, index) => root.querySelector(`.crossword-word[data-word="${index}"]`);
const lettersOf = (root, indices) => indices.map((i) => cellAt(root, i).textContent).join('');
const activeCells = (root) => [...root.querySelectorAll('.crossword-cell.crossword-active')]
    .map((cell) => Number(cell.dataset.idx));

function fakeApi() {
    return {
        settings: settings(),
        save: () => {},
        toast: (kind, msg) => toasts.push({ kind, msg }),
        exitToHub: () => {},
        isSoloGame: () => false,
        renderAllStats: () => {},
    };
}

console.log('crossword ui (jsdom)');

// Размеры уровней в подписях продублированы константой, чтобы панель настроек не тянула
// 82 КБ пула ради строки «7×7». Дубль обязан сходиться с данными.
await test('подписи уровней сходятся с пулом', async () => {
    const pool = (await import('../../src/games/crossword/data/puzzles.js')).default;
    for (const level of LEVELS) {
        const first = pool.levels[level][0];
        assertEqual(LEVEL_SIZES[level], first.cols, `ширина уровня ${level}`);
        assertEqual(LEVEL_SIZES[level], first.rows, `высота уровня ${level}`);
        assert(levelLabel(level).includes(`${first.cols}×${first.rows}`), `подпись уровня ${level}`);
    }
});

await session({}, async (root) => {
    test('плитка кроссворда в хабе', () => {
        assert(isOpen(), 'окно открыто');
        const tile = root.querySelector('.stg-tile[data-game-id="crossword"]');
        assert(tile, 'плитка на месте');
        assertEqual(tile.querySelector('.stg-tile-title').textContent, 'Кроссворд', 'название');
        assert(tile.querySelector('i.fa-puzzle-piece'), 'иконка');
    });

    test('подготовка: пустая партия по рукописной головоломке', () => {
        settings().savedGame = savedGame();
        settings().stats = {};
    });
});

await session({ gameId: 'crossword' }, async (root) => {
    test('пока пул не приехал, окно показывает заглушку', () => {
        assert(root.querySelector('.crossword-loading'), 'заглушка на месте');
        assertEqual(root.querySelectorAll('.crossword-cell').length, 0, 'сетки ещё нет');
    });

    await settle();

    test('заглушка сменяется сеткой и банком слов', () => {
        assert(!root.querySelector('.crossword-loading'), 'заглушка убрана');
        assertEqual(root.querySelectorAll('.crossword-cell').length, 25, 'клеток 5×5');
        assertEqual(root.querySelectorAll('.crossword-cell.crossword-block').length, 8, 'блоков');
        assertEqual(root.querySelectorAll('.crossword-word').length, 5, 'слов в банке');
        assertEqual(root.querySelector('.crossword-left').textContent, 'Осталось слов: 5', 'счётчик');
        assertEqual(root.querySelector('.crossword-timer').textContent, '00:30', 'время продолжается');
    });

    test('до первого слова партия не засчитана', () => {
        assertEqual(readEntry(settings().stats, 'easy').played, 0, 'сыграно');
    });

    test('тап по клетке подсвечивает слот целиком', () => {
        cellAt(root, 1).click();
        assertEqual(activeCells(root).join(','), '0,1,2,3', 'горизонтальный слот');
    });

    test('тап по слову ставит его в выбранный слот', () => {
        wordAt(root, MEL).click();
        assertEqual(lettersOf(root, [0, 1, 2, 3]), 'МЕЛЬ', 'буквы в сетке');
        assertEqual(root.querySelector('.crossword-left').textContent, 'Осталось слов: 4', 'счётчик');
        assert(wordAt(root, MEL).classList.contains('crossword-word-used'), 'слово погасло в банке');
        assertEqual(root.querySelectorAll('.crossword-word').length, 5, 'банк не потерял ни одной кнопки');
        assertEqual(readEntry(settings().stats, 'easy').played, 1, 'партия засчитана');
    });

    test('слово в занятом слоте заменяется, прежнее возвращается в банк', () => {
        cellAt(root, 1).click();
        wordAt(root, RYADY).click();
        assertEqual(lettersOf(root, [0, 1, 2, 3]), 'РЯДЫ', 'новое слово встало');
        assert(!wordAt(root, MEL).classList.contains('crossword-word-used'), 'МЕЛЬ вернулось в банк');
        assert(wordAt(root, RYADY).classList.contains('crossword-word-used'), 'РЯДЫ разложено');
        assertEqual(root.querySelector('.crossword-left').textContent, 'Осталось слов: 4', 'занято по-прежнему одно место');
    });

    test('повторный тап по разложенному слову снимает его', () => {
        wordAt(root, RYADY).click();
        assertEqual(lettersOf(root, [0, 1, 2, 3]), '', 'сетка опустела');
        assertEqual(root.querySelector('.crossword-left').textContent, 'Осталось слов: 5', 'счётчик вернулся');
        assert(!wordAt(root, RYADY).classList.contains('crossword-word-used'), 'слово снова в банке');
    });

    test('повторный тап по клетке переключает across ⇄ down', () => {
        // Клетка 1 лежит только в горизонтальном слове — тап по ней задаёт заведомое
        // начальное состояние, иначе первый же тап по клетке 0 сработал бы как переключение.
        cellAt(root, 1).click();
        cellAt(root, 0).click();
        assertEqual(activeCells(root).join(','), '0,1,2,3', 'сначала горизонтальный');
        cellAt(root, 0).click();
        assertEqual(activeCells(root).join(','), '0,5,10,15,20', 'повторный тап дал вертикальный');
        cellAt(root, 0).click();
        assertEqual(activeCells(root).join(','), '0,1,2,3', 'и обратно');
    });

    test('слово, не сходящееся на пересечении, не встаёт', () => {
        // МЕЛЬ по горизонтали ставит «М» в клетку 0, ЛОДКА по вертикали хочет там «Л».
        cellAt(root, 1).click();
        wordAt(root, MEL).click();

        cellAt(root, 0).click();
        cellAt(root, 0).click();
        assertEqual(activeCells(root).join(','), '0,5,10,15,20', 'выбран вертикальный слот');

        toasts.length = 0;
        wordAt(root, LODKA).click();
        assertEqual(lettersOf(root, [5, 10, 15, 20]), '', 'слово не встало');
        assert(toasts.some((t) => t.msg.includes('пересечении')), 'причина названа');
        assert(!wordAt(root, LODKA).classList.contains('crossword-word-used'), 'ЛОДКА осталась в банке');
    });

    test('стрелка сначала меняет направление, потом двигает курсор', () => {
        const board = root.querySelector('.crossword-board');
        const press = (key) => {
            const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
            board.dispatchEvent(event);
            return event;
        };

        // Выбран вертикальный слот на клетке 0 — «вправо» сначала переключает на
        // горизонтальный, и только следующее нажатие ведёт курсор дальше.
        const first = press('ArrowRight');
        assert(first.defaultPrevented, 'стрелка обработана игрой');
        assertEqual(activeCells(root).join(','), '0,1,2,3', 'направление переключилось');
        assertEqual(board.getAttribute('aria-activedescendant'), 'crossword-cell-0', 'курсор на месте');

        press('ArrowRight');
        assertEqual(board.getAttribute('aria-activedescendant'), 'crossword-cell-1', 'курсор сдвинулся');

        assert(!press('q').defaultPrevented, 'необработанная клавиша уходит к таверне');
        assert(!press('Tab').defaultPrevented, 'Tab не перехватывается');
        assert(!press('Escape').defaultPrevented, 'Esc не перехватывается — его получает попап');
    });

    test('Enter снимает слово с выбранного слота', () => {
        const board = root.querySelector('.crossword-board');
        const event = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        board.dispatchEvent(event);
        assert(event.defaultPrevented, 'Enter обработан игрой');
        assertEqual(lettersOf(root, [0, 1, 2, 3]), '', 'слово снято');
    });

    test('«Новая» берёт другую головоломку и не накручивает «сыграно»', () => {
        const played = readEntry(settings().stats, 'easy').played;
        root.querySelector('.crossword-btn').click();
        assertEqual(root.querySelectorAll('.crossword-cell').length, 49, 'сетка лёгкого уровня из пула 7×7');
        assertEqual(root.querySelectorAll('.crossword-word.crossword-word-used').length, 0, 'сетка чистая');
        assertEqual(readEntry(settings().stats, 'easy').played, played, '«сыграно» не выросло');
    });
});

// --- Победа на подготовленной партии

await session({}, async () => {
    test('подготовка: разложено всё, кроме последнего слова', () => {
        settings().savedGame = savedGame([MEL, MARKA, LODKA, RYADY, -1]);
        settings().stats = {};
    });
});

await session({ gameId: 'crossword' }, async (root) => {
    await settle();

    test('восстановленная партия открывается там же, где закончилась', () => {
        assertEqual(lettersOf(root, [0, 1, 2, 3]), 'МЕЛЬ', 'слова на месте');
        assertEqual(root.querySelector('.crossword-left').textContent, 'Осталось слов: 1', 'счётчик');
        assertEqual(readEntry(settings().stats, 'easy').played, 0, 'повторно партия не засчитана');
    });

    test('последнее слово собирает кроссворд: статистика, рекорд и тост', () => {
        toasts.length = 0;
        wordAt(root, ATAKA).click();

        assert(root.querySelector('.crossword-status').textContent.startsWith('Кроссворд собран'), 'строка статуса');
        assertEqual(root.querySelector('.crossword-left').textContent, 'Готово', 'счётчик закрыт');

        const entry = readEntry(settings().stats, 'easy');
        assertEqual(entry.wins, 1, 'победа записана');
        assert(entry.bestTime !== null, 'рекорд времени записан');
        assert(toasts.some((t) => t.kind === 'success'), 'поздравление показано');
    });

    test('после победы сетка заморожена', () => {
        wordAt(root, ATAKA).click();
        assertEqual(lettersOf(root, [20, 21, 22, 23, 24]), 'АТАКА', 'слово на месте');
        assertEqual(root.querySelector('.crossword-left').textContent, 'Готово', 'счётчик не изменился');
    });
});

// --- Жизненный цикл: монтирование напрямую, без оболочки

test('подготовка: пустая партия для проверок destroy()', () => {
    settings().savedGame = savedGame();
    settings().stats = {};
});

{
    const host = dom.window.document.createElement('div');
    const live = crosswordGame.mount(host, fakeApi());
    await settle();

    let board = null;

    test('destroy() сохраняет партию до того, как чистит корень', () => {
        board = host.querySelector('.crossword-board');
        cellAt(host, 1).click();
        wordAt(host, MEL).click();

        live.destroy();
        assertEqual(host.innerHTML, '', 'корень вычищен');
        assertEqual(settings().savedGame.placed.split(',')[0], String(MEL), 'слово попало в сохранённую партию');
    });

    test('destroy() идемпотентен и снимает слушателей', () => {
        live.destroy();
        const event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        board.dispatchEvent(event);
        assert(!event.defaultPrevented, 'клавиатура сетки больше не слушается');
    });
}

{
    const host = dom.window.document.createElement('div');
    const live = crosswordGame.mount(host, fakeApi());

    test('destroy() во время загрузки пула ничего не рисует и не бросает', () => {
        assert(host.querySelector('.crossword-loading'), 'пока видна заглушка');
        live.destroy();
        live.destroy();
    });

    await settle();

    test('после загрузки в мёртвый экран ничего не дорисовалось', () => {
        assertEqual(host.innerHTML, '', 'корень остался пустым');
    });
}

report('crossword/ui');
