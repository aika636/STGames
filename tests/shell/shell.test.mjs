// Тесты оболочки (Фаза 4) под jsdom: попап, хаб, плитки, навигация и точки запуска.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/shell/shell.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from '../_harness.mjs';

const dom = new JSDOM(
    '<!doctype html><html><body><div id="extensionsMenu"></div><textarea id="send_textarea"></textarea></body></html>',
    { pretendToBeVisual: true },
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

const popupCalls = [];
const slashCommands = [];

// Управляемая заглушка контекста: callGenericPopup подставляется в каждой сессии.
const context = {
    extensionSettings: {},
    saveSettingsDebounced: () => {},
    POPUP_TYPE: { TEXT: 1, DISPLAY: 4 },
    callGenericPopup: null,
    SlashCommandParser: {
        addCommandObject: (command) => slashCommands.push(command),
    },
    SlashCommand: { fromProps: (props) => props },
    SlashCommandArgument: { fromProps: (props) => props },
    SlashCommandEnumValue: class { constructor(value) { this.value = value; } },
    ARGUMENT_TYPE: { STRING: 'string' },
};

globalThis.SillyTavern = { getContext: () => context };

const { clear, register } = await import('../../src/registry.js');
const sudokuGame = (await import('../../src/games/sudoku/index.js')).default;
const { isOpen, openShell, refresh } = await import('../../src/shell/modal.js');
const { setAppearance } = await import('../../src/settings.js');
const { initSlashCommands, initWandButton } = await import('../../src/shell/launcher.js');

// Вторая, тестовая игра: кнопка «← Игры» видна только когда игр в реестре больше одной.
const demoGame = {
    id: 'demo',
    title: 'Демо',
    tagline: 'Заглушка для теста',
    icon: 'fa-puzzle-piece',
    defaults: { volume: 0.5 },
    mount: () => ({ destroy() {} }),
};

// Каждая сессия — один открытый попап: отдаём openShell() «висящий» промис и
// отпускаем его в конце, как игрок закрывает окно крестиком.
async function session(options, body) {
    let root = null;
    let release;
    const held = new Promise((resolve) => { release = resolve; });

    context.callGenericPopup = (content, type, value, opts) => {
        root = content;
        popupCalls.push({ content, type, options: opts });
        return held;
    };

    const opened = openShell(options);
    await Promise.resolve();

    await body(root);

    release();
    await opened;
}

console.log('shell (jsdom)');

// --- Две игры: хаб, переход в игру, возврат в хаб, закрытие попапа.

clear();
register(sudokuGame);
register(demoGame);

await session({}, async (root) => {
    test('openShell() показывает хаб с плитками игр', () => {
        assert(isOpen(), 'окно открыто');
        assert(root.classList.contains('stg-root'), 'корень оболочки');
        const hub = root.querySelector('.stg-hub');
        assert(hub, 'хаб на месте');
        assertEqual(hub.querySelectorAll('.stg-tile').length, 2, 'плиток две');

        const sudokuTile = hub.querySelector('.stg-tile[data-game-id="sudoku"]');
        assert(sudokuTile, 'плитка судоку на месте');
        assertEqual(sudokuTile.querySelector('.stg-tile-title').textContent, 'Судоку', 'название');
        assertEqual(sudokuTile.querySelector('.stg-tile-tagline').textContent, 'Логическая головоломка 9×9', 'подпись');
        assert(sudokuTile.querySelector('i.fa-table-cells'), 'иконка судоку');
    });

    test('клик по плитке монтирует доску 9×9', () => {
        root.querySelector('.stg-tile[data-game-id="sudoku"]').click();
        assert(!root.querySelector('.stg-hub'), 'хаб убран с экрана');
        const board = root.querySelector('.stg-screen .sudoku-board');
        assert(board, 'доска смонтирована в экран');
        assertEqual(board.querySelectorAll('.sudoku-cell').length, 81, 'клеток на доске');
        assertEqual(root.querySelector('.stg-title').textContent, 'Судоку', 'заголовок окна');
    });

    test('«← Игры» возвращает хаб, доска исчезает', () => {
        const back = root.querySelector('.stg-back');
        assert(back, 'кнопка «назад» на месте');
        assert(!back.hidden, 'при двух играх кнопка видна');
        back.click();

        assert(root.querySelector('.stg-hub'), 'хаб снова на месте');
        assert(!root.querySelector('.sudoku-board'), 'доска исчезла');
        assert(root.querySelector('.stg-back').hidden, 'в хабе кнопка «назад» скрыта');

        // Последняя открытая игра помечается в хабе отдельным классом.
        const sudokuTile = root.querySelector('.stg-tile[data-game-id="sudoku"]');
        assert(sudokuTile.classList.contains('stg-tile-last'), 'плитка последней игры помечена');
    });
});

test('после закрытия попапа isOpen() === false', () => {
    assertEqual(isOpen(), false, 'сессия закрыта');
});

// --- Прямой вход в игру, минуя хаб. Окно закрывается, пока смонтирована игра, —
// --- это и есть путь, на котором destroy() обязан снять клавиатуру с document.

await session({ gameId: 'sudoku', args: { difficulty: 'easy' } }, async (root) => {
    test('openShell({ gameId }) открывает игру сразу', () => {
        assert(!root.querySelector('.stg-hub'), 'хаб не показан');
        assert(root.querySelector('.stg-screen .sudoku-board'), 'доска на месте');
        assertEqual(root.querySelectorAll('.sudoku-cell').length, 81, 'клеток на доске');
        assert(!root.querySelector('.stg-back').hidden, 'кнопка «назад» видна');
    });
});

test('после закрытия попапа слушателя клавиатуры игры не остаётся', () => {
    const chat = document.getElementById('send_textarea');
    let reached = 0;
    const spy = () => reached++;
    chat.addEventListener('keydown', spy);
    const event = new dom.window.KeyboardEvent('keydown', { key: '5', bubbles: true, cancelable: true });
    chat.dispatchEvent(event);
    chat.removeEventListener('keydown', spy);

    // Обработчик игры перехватывал бы цифру (preventDefault + stopPropagation) —
    // значит, если событие дошло до чата, слушателя на document больше нет.
    assertEqual(reached, 1, 'событие дошло до чата');
    assert(!event.defaultPrevented, 'клавиша не погашена обработчиком игры');
});

// --- Повторный openShell при открытом окне второй попап не создаёт.

await session({}, async (root) => {
    test('повторный openShell не создаёт второй попап', async () => {
        const before = popupCalls.length;
        await openShell({ gameId: 'sudoku' });
        assertEqual(popupCalls.length, before, 'второго попапа нет');
    });
});

// --- Одна игра в реестре: кнопка «← Игры» бессмысленна и скрыта.

clear();
register(sudokuGame);

await session({}, async (root) => {
    test('при одной игре кнопки «назад» нет', () => {
        const back = root.querySelector('.stg-back');
        assert(back, 'кнопка в разметке есть');
        assert(back.hidden, 'в хабе скрыта');

        root.querySelector('.stg-tile').click();
        assert(root.querySelector('.stg-screen .sudoku-board'), 'доска смонтирована');
        assert(root.querySelector('.stg-back').hidden, 'в игре тоже скрыта');
    });
});

// --- Палитра окна: режим стоит на корне с первого кадра и переключается на лету.

await session({ gameId: 'sudoku' }, async (root) => {
    test('окно открывается уже с режимом палитры', () => {
        // Настройки пустые, значит режим — auto; текст в jsdom по умолчанию чёрный,
        // и авто обязано выбрать светлую палитру.
        assertEqual(root.dataset.stgTheme, 'light', 'auto по чёрному тексту — light');
    });

    test('смена оформления доезжает до открытого окна', () => {
        setAppearance('dark');
        refresh();
        assertEqual(root.dataset.stgTheme, 'dark', 'режим переключился без переоткрытия');

        setAppearance('auto');
        refresh();
        assertEqual(root.dataset.stgTheme, 'light', 'обратно в авто');
    });
});

test('панель настроек: селект оформления пишет выбор в настройки', async () => {
    const { renderCommonSettings } = await import('../../src/shell/settings-ui.js');
    const { getAppearance } = await import('../../src/settings.js');

    const box = document.createElement('div');
    renderCommonSettings(box);

    const control = box.querySelector('#stgames_appearance');
    assert(control, 'селект на месте');
    assertEqual(control.options.length, 4, 'четыре режима');
    assertEqual(control.value, 'auto', 'показан текущий режим');

    control.value = 'theme';
    control.dispatchEvent(new dom.window.Event('change'));
    assertEqual(getAppearance(), 'theme', 'выбор сохранён');

    setAppearance('auto');
});

test('панель настроек: блок игры свёрнут и раскрывается по клику', async () => {
    const { renderGameSection } = await import('../../src/shell/settings-ui.js');

    const section = renderGameSection(sudokuGame);
    const toggle = section.querySelector('.stg-game-toggle');
    const body = section.querySelector('.stg-game-body');

    assert(toggle && body, 'шапка и тело секции на месте');
    assertEqual(toggle.getAttribute('aria-controls'), body.id, 'шапка указывает на своё тело');
    assert(body.hidden, 'по умолчанию свёрнуто');
    assert(section.querySelector('#stg_stats_sudoku'), 'контейнер статистики с прежним id');
    assert(section.querySelector('#sudoku_difficulty'), 'контролы игры отрисованы');

    toggle.dispatchEvent(new dom.window.Event('click'));
    assert(!body.hidden, 'клик раскрывает секцию');
    assertEqual(toggle.getAttribute('aria-expanded'), 'true', 'состояние в aria-expanded');
    assert(section.classList.contains('stg-game-open'), 'класс раскрытой секции');

    toggle.dispatchEvent(new dom.window.Event('click'));
    assert(body.hidden, 'повторный клик сворачивает обратно');
});

// --- Точки запуска: wand-меню и слэш-команды.

test('initWandButton добавляет ровно один пункт в wand-меню', () => {
    assert(initWandButton(), 'кнопка добавлена');
    assert(initWandButton(), 'повторный вызов безопасен');
    assertEqual(document.querySelectorAll('#stgames_wand_button').length, 1, 'пунктов в меню');

    const button = document.getElementById('stgames_wand_button');
    assert(button.querySelector('.extensionsMenuExtensionButton'), 'иконка на месте');
    assertEqual(button.textContent.trim(), 'STGames', 'подпись кнопки');
});

test('initSlashCommands регистрирует /stgames и /sudoku', () => {
    slashCommands.length = 0;
    assert(initSlashCommands(), 'команды зарегистрированы');
    assertEqual(slashCommands.length, 2, 'команд добавлено');
    assertEqual(slashCommands[0].name, 'stgames', 'первая команда');
    assertEqual(slashCommands[1].name, 'sudoku', 'вторая команда');
    assert(typeof slashCommands[1].callback === 'function', 'колбэк на месте');
});

test('initSlashCommands падает на устаревший API, если парсера нет', () => {
    const original = context.SlashCommandParser;
    const legacy = [];
    delete context.SlashCommandParser;
    context.registerSlashCommand = (name) => legacy.push(name);

    assert(initSlashCommands(), 'команды зарегистрированы через устаревший API');
    assertEqual(legacy.length, 2, 'команд зарегистрировано');
    assertEqual(legacy[0], 'stgames', 'первая команда');
    assertEqual(legacy[1], 'sudoku', 'вторая команда');

    context.SlashCommandParser = original;
    delete context.registerSlashCommand;
});

test('без API слэш-команд расширение не падает', () => {
    const original = context.SlashCommandParser;
    delete context.SlashCommandParser;
    assertEqual(initSlashCommands(), false, 'вернулся false, исключения нет');
    context.SlashCommandParser = original;
});

report('shell');
