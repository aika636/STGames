// Смоук-тесты UI под jsdom: доска, окно игры и точки запуска.
// В браузере это не заменяет ручную проверку, но ловит то, ради чего иначе пришлось бы
// каждый раз идти в таверну: сломанный DOM, отвалившуюся регистрацию команды, попап,
// который не закрывается.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/ui.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from './_harness.mjs';

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

const { createBoard, createRemainingCounter } = await import('../src/ui/board.js');
const { openSudoku, isOpen } = await import('../src/ui/modal.js');
const { initSlashCommand, initWandButton } = await import('../src/ui/launcher.js');
const { createGame, remainingCounts, setValue, toggleNote } = await import('../src/core/game.js');
const { generatePuzzle } = await import('../src/core/generator.js');
const { mulberry32 } = await import('../src/core/rng.js');

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

test('render проставляет aria-label для скринридера', () => {
    const state = newGame();
    const board = createBoard();
    board.render(state);
    const label = board.cells[0].cell.getAttribute('aria-label');
    assert(/строка 1, столбец 1/.test(label), `подпись клетки: ${label}`);
});

await test('openSudoku строит окно и отдаёт его в попап ST', async () => {
    popupCalls.length = 0;
    await openSudoku({ difficulty: 'easy' });

    assertEqual(popupCalls.length, 1, 'попап показан один раз');
    const { content, type, options } = popupCalls[0];
    assertEqual(type, 4, 'тип попапа — DISPLAY');
    assertEqual(options.allowVerticalScrolling, true, 'вертикальная прокрутка разрешена');

    assert(content.classList.contains('sudoku-root'), 'в попап ушёл корень игры');
    assertEqual(content.querySelectorAll('.sudoku-cell').length, 81, 'доска построена');
    assert(content.querySelector('.sudoku-timer'), 'таймер на месте');
    assert(content.querySelector('.sudoku-select'), 'селектор уровня на месте');

    const filled = Array.from(content.querySelectorAll('.sudoku-value')).filter((el) => el.textContent).length;
    assert(filled > 30 && filled < 60, `на лёгком уровне видно ${filled} подсказок`);
});

await test('после закрытия попапа сессия освобождается', async () => {
    assertEqual(isOpen(), false, 'сессии нет');
    await openSudoku({ difficulty: 'easy' });
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

    const first = openSudoku({ difficulty: 'easy' });
    await openSudoku({ difficulty: 'easy' }); // второй вызов при открытом окне
    assertEqual(popupCalls.length, 1, 'второй попап не открылся');

    release();
    await first;
    context.callGenericPopup = original;
    assertEqual(isOpen(), false, 'сессия закрыта');
});

await test('без callGenericPopup показывается собственный оверлей', async () => {
    const original = context.callGenericPopup;
    delete context.callGenericPopup;

    const promise = openSudoku({ difficulty: 'easy' });
    const overlay = document.querySelector('.sudoku-overlay');
    assert(overlay, 'оверлей создан');
    assertEqual(overlay.querySelectorAll('.sudoku-cell').length, 81, 'доска внутри оверлея');

    // Закрытие по Esc.
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await promise;

    assert(!document.querySelector('.sudoku-overlay'), 'оверлей убран из DOM');
    assertEqual(isOpen(), false, 'сессия закрыта');
    context.callGenericPopup = original;
});

test('initWandButton добавляет пункт в меню и не дублирует его', () => {
    assert(initWandButton(), 'кнопка добавлена');
    assert(initWandButton(), 'повторный вызов безопасен');
    assertEqual(document.querySelectorAll('#sudoku_wand_button').length, 1, 'кнопок в меню');

    const button = document.getElementById('sudoku_wand_button');
    assert(button.querySelector('.extensionsMenuExtensionButton'), 'иконка на месте');
    assertEqual(button.textContent.trim(), 'Судоку', 'подпись кнопки');
});

test('initSlashCommand регистрирует /sudoku', () => {
    slashCommands.length = 0;
    assert(initSlashCommand(), 'команда зарегистрирована');
    assertEqual(slashCommands.length, 1, 'команд добавлено');
    assertEqual(slashCommands[0].name, 'sudoku', 'имя команды');
    assert(typeof slashCommands[0].callback === 'function', 'колбэк на месте');
});

test('initSlashCommand падает на устаревший API, если парсера нет', () => {
    const original = context.SlashCommandParser;
    const legacy = [];
    delete context.SlashCommandParser;
    context.registerSlashCommand = (name) => legacy.push(name);

    assert(initSlashCommand(), 'команда зарегистрирована через устаревший API');
    assertEqual(legacy[0], 'sudoku', 'имя команды');

    context.SlashCommandParser = original;
    delete context.registerSlashCommand;
});

test('без API слэш-команд расширение не падает', () => {
    const original = context.SlashCommandParser;
    delete context.SlashCommandParser;
    assertEqual(initSlashCommand(), false, 'вернулся false, исключения нет');
    context.SlashCommandParser = original;
});

report('ui');
