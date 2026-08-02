// Смоук-тесты UI под jsdom: доска, окно игры и точки запуска.
// В браузере это не заменяет ручную проверку, но ловит то, ради чего иначе пришлось бы
// каждый раз идти в таверну: сломанный DOM, отвалившуюся регистрацию команды, попап,
// который не закрывается.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/ui.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from '../_harness.mjs';

// --- Окружение браузера и заглушка SillyTavern. Ставится до импорта модулей UI:
// --- src/ctx.js зовёт глобальный SillyTavern.getContext() в каждой функции.

const dom = new JSDOM('<!doctype html><html><body><div id="extensionsMenu"></div></body></html>', {
    pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

const popupCalls = [];
const slashCommands = [];

// Управляемая заглушка контекста: тесты подменяют поля, чтобы проверить фолбэки.
const context = {
    extensionSettings: {},
    saveSettingsDebounced: () => {},
    POPUP_TYPE: { TEXT: 1, DISPLAY: 4 },
    callGenericPopup: (content, type, value, options) => {
        popupCalls.push({ content, type, options });
        // Попап ST резолвится, когда пользователь его закрыл. Здесь закрываем сразу —
        // тесту важно, что окно строится и что после закрытия сессия освобождается.
        return Promise.resolve(true);
    },
    SlashCommandParser: {
        addCommandObject: (command) => slashCommands.push(command),
    },
    SlashCommand: { fromProps: (props) => props },
    SlashCommandArgument: { fromProps: (props) => props },
    SlashCommandEnumValue: class { constructor(value) { this.value = value; } },
    ARGUMENT_TYPE: { STRING: 'string' },
};

globalThis.SillyTavern = { getContext: () => context };

const { createBoard, createRemainingCounter } = await import('../../src/games/sudoku/ui/board.js');
const { openShell, isOpen } = await import('../../src/shell/modal.js');
const { initSlashCommands, initWandButton } = await import('../../src/shell/launcher.js');
const { clear, register } = await import('../../src/registry.js');
const sudokuGame = (await import('../../src/games/sudoku/index.js')).default;
const { createGame, remainingCounts, setValue, toggleNote } = await import('../../src/games/sudoku/core/game.js');
const { getSudokuSettings, renderSudokuStats } = await import('../../src/games/sudoku/settings.js');
const { recordPlayed, recordSolved, resetStats } = await import('../../src/games/sudoku/core/stats.js');
const { generatePuzzle } = await import('../../src/games/sudoku/core/generator.js');
const { mulberry32 } = await import('../../src/games/sudoku/core/rng.js');

clear();
register(sudokuGame);

function newGame(difficulty = 'easy', seed = 5) {
    return createGame(generatePuzzle({ difficulty, rng: mulberry32(seed) }));
}

console.log('ui (jsdom)');

test('createBoard строит 81 клетку с границами боксов', () => {
    const board = createBoard();
    const cells = board.root.querySelectorAll('.sudoku-cell');
    assertEqual(cells.length, 81, 'клеток на доске');
    assertEqual(board.root.getAttribute('role'), 'grid', 'роль доски');

    // Утолщённые линии: по 2 внутренние границы на каждую из 9 строк и 9 столбцов.
    assertEqual(board.root.querySelectorAll('[data-box-left]').length, 18, 'вертикальных линий боксов');
    assertEqual(board.root.querySelectorAll('[data-box-top]').length, 18, 'горизонтальных линий боксов');
});

test('render показывает подсказки и введённые цифры', () => {
    const state = newGame();
    const board = createBoard();
    board.render(state);

    const givenIdx = state.puzzle.findIndex((value) => value !== 0);
    const givenCell = board.cells[givenIdx].cell;
    assert(givenCell.classList.contains('sudoku-given'), 'подсказка помечена классом');
    assertEqual(givenCell.querySelector('.sudoku-value').textContent, String(state.puzzle[givenIdx]), 'цифра подсказки');

    const emptyIdx = state.values.findIndex((value) => value === 0);
    setValue(state, emptyIdx, 5);
    board.render(state);

    const filled = board.cells[emptyIdx].cell;
    assertEqual(filled.querySelector('.sudoku-value').textContent, '5', 'введённая цифра');
    assert(filled.classList.contains('sudoku-filled'), 'клетка помечена как заполненная');
    assert(!filled.classList.contains('sudoku-given'), 'ход игрока подсказкой не считается');
});

test('render показывает пометки и прячет их под цифрой', () => {
    const state = newGame();
    const board = createBoard();
    const idx = state.values.findIndex((value) => value === 0);

    toggleNote(state, idx, 3);
    toggleNote(state, idx, 7);
    board.render(state);

    const notes = board.cells[idx].notes;
    assert(notes[2].classList.contains('sudoku-note-on'), 'пометка 3 видна');
    assert(notes[6].classList.contains('sudoku-note-on'), 'пометка 7 видна');
    assert(!notes[0].classList.contains('sudoku-note-on'), 'пометки 1 нет');

    setValue(state, idx, 9);
    board.render(state);
    assert(!notes[2].classList.contains('sudoku-note-on'), 'после ввода цифры пометки сняты');
});

test('render подсвечивает выбранную клетку и одинаковые цифры, но не юниты', () => {
    const state = newGame();
    const board = createBoard();

    // Клетка с цифрой, которая встречается на доске ещё раз — иначе проверять нечего.
    const selected = state.values.findIndex((value, i) => (
        value !== 0 && state.values.some((other, j) => other === value && j !== i)
    ));
    assert(selected >= 0, 'на доске есть повторяющаяся цифра');
    board.render(state, { selected });

    assert(board.cells[selected].cell.classList.contains('sudoku-selected'), 'выбранная клетка');

    const digit = state.values[selected];
    const same = state.values.findIndex((value, i) => value === digit && i !== selected);
    assert(board.cells[same].cell.classList.contains('sudoku-same'), 'одинаковая цифра подсвечена');

    // Строка/столбец/бокс больше не заливаются: подсветка юнитов убрана намеренно.
    assertEqual(board.root.querySelectorAll('.sudoku-peer').length, 0, 'клеток с подсветкой юнита');

    // Сосед по строке подсвечен ровно тогда, когда в нём стоит та же цифра.
    const neighbour = board.cells[selected + (selected % 9 === 8 ? -1 : 1)];
    assertEqual(
        neighbour.cell.classList.contains('sudoku-same'),
        state.values[Number(neighbour.cell.dataset.idx)] === digit,
        'сосед подсвечен только по совпадению цифры',
    );
});

test('createRemainingCounter показывает, сколько цифр осталось', () => {
    const state = newGame();
    const counter = createRemainingCounter();
    counter.update(remainingCounts(state));

    assertEqual(counter.root.querySelectorAll('.sudoku-remaining-item').length, 9, 'пунктов счётчика');

    const digit = state.values.find((value) => value !== 0);
    const placed = state.values.filter((value) => value === digit).length;
    const { left } = counter.items.get(digit);
    assertEqual(Number(left.textContent), 9 - placed, `осталось цифр ${digit}`);
});

test('render помечает конфликты и уважает настройку', () => {
    const state = newGame();
    const board = createBoard();

    // Ставим в пустую клетку цифру, которая уже есть в её строке.
    const idx = state.values.findIndex((value) => value === 0);
    const row = Math.floor(idx / 9);
    const givenIdx = state.puzzle.findIndex((value, i) => value !== 0 && Math.floor(i / 9) === row);
    setValue(state, idx, state.puzzle[givenIdx]);

    board.render(state, { highlightConflicts: true });
    assert(board.cells[idx].cell.classList.contains('sudoku-conflict'), 'конфликт подсвечен');

    board.render(state, { highlightConflicts: false });
    assert(!board.cells[idx].cell.classList.contains('sudoku-conflict'), 'подсветка отключается настройкой');
});

test('render помечает ошибочные цифры и уважает настройку', () => {
    const state = newGame();
    const board = createBoard();

    // Заведомо неверная цифра: любая, кроме той, что стоит в решении.
    const idx = state.values.findIndex((value) => value === 0);
    const wrong = (state.solution[idx] % 9) + 1;
    setValue(state, idx, wrong);

    board.render(state, { highlightMistakes: true });
    assert(board.cells[idx].cell.classList.contains('sudoku-mistake'), 'ошибка подсвечена');

    board.render(state, { highlightMistakes: false });
    assert(!board.cells[idx].cell.classList.contains('sudoku-mistake'), 'подсветка отключается настройкой');

    // Верная цифра ошибкой не считается.
    setValue(state, idx, wrong); // повторный ввод стирает
    setValue(state, idx, state.solution[idx]);
    board.render(state, { highlightMistakes: true });
    assert(!board.cells[idx].cell.classList.contains('sudoku-mistake'), 'верная цифра не помечена');
});

test('render проставляет aria-label для скринридера', () => {
    const state = newGame();
    const board = createBoard();
    board.render(state);
    const label = board.cells[0].cell.getAttribute('aria-label');
    assert(/строка 1, столбец 1/.test(label), `подпись клетки: ${label}`);
});

await test('openShell строит окно игры и отдаёт его в попап ST', async () => {
    popupCalls.length = 0;
    await openShell({ gameId: 'sudoku', args: { difficulty: 'easy' } });

    assertEqual(popupCalls.length, 1, 'попап показан один раз');
    const { content, type, options } = popupCalls[0];
    assertEqual(type, 4, 'тип попапа — DISPLAY');
    assertEqual(options.allowVerticalScrolling, true, 'вертикальная прокрутка разрешена');

    assert(content.classList.contains('stg-root'), 'в попап ушёл корень оболочки');
    assertEqual(content.querySelectorAll('.sudoku-cell').length, 81, 'доска построена');
    assert(content.querySelector('.sudoku-timer'), 'таймер на месте');
    assert(content.querySelector('.sudoku-select'), 'селектор уровня на месте');

    const filled = Array.from(content.querySelectorAll('.sudoku-value')).filter((el) => el.textContent).length;
    assert(filled > 30 && filled < 60, `на лёгком уровне видно ${filled} подсказок`);
});

await test('после закрытия попапа сессия освобождается', async () => {
    assertEqual(isOpen(), false, 'сессии нет');
    await openShell({ gameId: 'sudoku', args: { difficulty: 'easy' } });
    assertEqual(isOpen(), false, 'сессия закрыта вместе с попапом');
});

await test('окно не открывается дважды', async () => {
    popupCalls.length = 0;

    // Попап, который «висит», пока тест сам его не отпустит.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const original = context.callGenericPopup;
    context.callGenericPopup = (content, type, value, options) => {
        popupCalls.push({ content, type, options });
        return held;
    };

    const first = openShell({ gameId: 'sudoku', args: { difficulty: 'easy' } });
    await openShell({ gameId: 'sudoku', args: { difficulty: 'easy' } }); // второй вызов при открытом окне
    assertEqual(popupCalls.length, 1, 'второй попап не открылся');

    release();
    await first;
    context.callGenericPopup = original;
    assertEqual(isOpen(), false, 'сессия закрыта');
});

await test('без callGenericPopup показывается собственный оверлей', async () => {
    const original = context.callGenericPopup;
    delete context.callGenericPopup;

    const promise = openShell({ gameId: 'sudoku', args: { difficulty: 'easy' } });
    const overlay = document.querySelector('.stg-overlay');
    assert(overlay, 'оверлей создан');
    assertEqual(overlay.querySelectorAll('.sudoku-cell').length, 81, 'доска внутри оверлея');

    // Закрытие по Esc.
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;

    assert(!document.querySelector('.stg-overlay'), 'оверлей убран из DOM');
    assertEqual(isOpen(), false, 'сессия закрыта');
    context.callGenericPopup = original;
});

test('initWandButton добавляет пункт в меню и не дублирует его', () => {
    assert(initWandButton(), 'кнопка добавлена');
    assert(initWandButton(), 'повторный вызов безопасен');
    assertEqual(document.querySelectorAll('#stgames_wand_button').length, 1, 'кнопок в меню');

    const button = document.getElementById('stgames_wand_button');
    assert(button.querySelector('.extensionsMenuExtensionButton'), 'иконка на месте');
    assertEqual(button.textContent.trim(), 'Мини-игры', 'подпись кнопки');
});

test('initSlashCommands регистрирует /stgames и /sudoku', () => {
    slashCommands.length = 0;
    assert(initSlashCommands(), 'команды зарегистрированы');
    assertEqual(slashCommands.length, 2, 'команд добавлено');
    assertEqual(slashCommands[0].name, 'stgames', 'имя первой команды');
    assertEqual(slashCommands[1].name, 'sudoku', 'имя второй команды');
    assert(typeof slashCommands[1].callback === 'function', 'колбэк на месте');
});

test('initSlashCommands падает на устаревший API, если парсера нет', () => {
    const original = context.SlashCommandParser;
    const legacy = [];
    delete context.SlashCommandParser;
    context.registerSlashCommand = (name) => legacy.push(name);

    assert(initSlashCommands(), 'команды зарегистрированы через устаревший API');
    assertEqual(legacy[0], 'stgames', 'имя первой команды');
    assertEqual(legacy[1], 'sudoku', 'имя второй команды');

    context.SlashCommandParser = original;
    delete context.registerSlashCommand;
});

test('без API слэш-команд расширение не падает', () => {
    const original = context.SlashCommandParser;
    delete context.SlashCommandParser;
    assertEqual(initSlashCommands(), false, 'вернулся false, исключения нет');
    context.SlashCommandParser = original;
});

// --- Таблица статистики в панели настроек. initSettingsUI() тянет settings.html через
// --- $.get, поэтому проверяется только отрисовка — на вручную собранном контейнере.

test('renderSudokuStats без контейнера молча ничего не делает', () => {
    // Окно игры зовёт renderAllStats() после каждой партии, а панель настроек могла
    // не загрузиться (settings.html не отдался) — падать в этом месте нельзя.
    renderSudokuStats(null);
});

test('renderSudokuStats рисует строку на каждый уровень и прячет сброс без партий', () => {
    // Тесты выше открывали окно игры, а каждое открытие — это сыгранная партия.
    resetStats(getSudokuSettings().stats);

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSudokuStats(container);

    const rows = container.querySelectorAll('.sudoku-stats-row');
    assertEqual(rows.length, 5, 'строк: шапка и четыре уровня');
    assertEqual(rows[1].children[0].textContent, 'Лёгкий', 'подпись уровня');
    assertEqual(rows[1].children[1].textContent, '0', 'сыграно');
    assertEqual(rows[1].children[3].textContent, '—', 'лучшего времени нет');

    assertEqual(container.querySelector('#sudoku_stats_reset').style.display, 'none', 'сброс скрыт');
    assertEqual(container.querySelector('#sudoku_stats_hint').style.display, '', 'подсказка видна');
});

test('renderSudokuStats показывает счётчики и рекорд', () => {
    const stats = getSudokuSettings().stats;
    recordPlayed(stats, 'hard');
    recordPlayed(stats, 'hard');
    recordSolved(stats, 'hard', 125_000);

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSudokuStats(container);

    const row = container.querySelectorAll('.sudoku-stats-row')[3];
    assertEqual(row.children[0].textContent, 'Сложный', 'уровень');
    assertEqual(row.children[1].textContent, '2', 'сыграно');
    assertEqual(row.children[2].textContent, '1', 'решено');
    assertEqual(row.children[3].textContent, '02:05', 'лучшее время');

    assertEqual(container.querySelector('#sudoku_stats_reset').style.display, '', 'сброс показан');
    assertEqual(container.querySelector('#sudoku_stats_hint').style.display, 'none', 'подсказка скрыта');
});

report('ui');
