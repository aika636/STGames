// Тесты ввода (Фаза 3) под jsdom: клик по клетке, клавиатура, экранный numpad,
// режим заметок, undo/redo и детект победы.
//
// Проверяются не только «нажали — появилась цифра», но и то, ради чего эта фаза
// вообще рискованная: обработчик клавиатуры перехватывает событие до того, как оно
// дойдёт до поля ввода чата SillyTavern.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/input.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from './_harness.mjs';

const dom = new JSDOM(
    '<!doctype html><html><body><div id="extensionsMenu"></div><textarea id="send_textarea"></textarea></body></html>',
    { pretendToBeVisual: true },
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

const context = {
    extensionSettings: {},
    saveSettingsDebounced: () => {},
    POPUP_TYPE: { DISPLAY: 4 },
    callGenericPopup: null, // подставляется ниже: попап держим открытым весь файл
};

globalThis.SillyTavern = { getContext: () => context };

const { openSudoku } = await import('../src/ui/modal.js');
const { moveSelection } = await import('../src/ui/input.js');
const { solve } = await import('../src/core/solver.js');

// --- Одна открытая партия на весь файл: сессия в modal.js единственная, и держать
// --- попап «висящим» дешевле, чем переоткрывать его в каждом тесте.

let root = null;
let releasePopup;
const held = new Promise((resolve) => { releasePopup = resolve; });

context.callGenericPopup = (content) => {
    root = content;
    return held;
};

const opened = openSudoku({ difficulty: 'easy' });
await Promise.resolve(); // даём openSudoku дойти до showPopup

const cells = () => Array.from(root.querySelectorAll('.sudoku-cell'));
const valueAt = (idx) => cells()[idx].querySelector('.sudoku-value').textContent;
const status = () => root.querySelector('.sudoku-status').textContent;
const padButton = (digit) => root.querySelector(`.sudoku-pad-btn[data-digit="${digit}"]`);
const actionButton = (name) => root.querySelector(`.sudoku-pad-action[data-action="${name}"]`);

function click(el) {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// Клавиша уходит в document так же, как в браузере: событие рождается на элементе
// в фокусе (по умолчанию — textarea чата) и всплывает.
function press(key, { target = document.getElementById('send_textarea'), ...init } = {}) {
    const event = new dom.window.KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
    });
    target.dispatchEvent(event);
    return event;
}

// Выделение клетки. Идемпотентно: повторный клик по уже выбранной клетке снял бы
// выделение, а тестам почти всегда нужно именно «сделать текущей».
function select(idx) {
    const cell = cells()[idx];
    if (!cell.classList.contains('sudoku-selected')) click(cell);
    return cell;
}

// Индекс пустой клетки — доска генерируется случайно, фиксированного номера нет.
function emptyCell(n = 0) {
    let seen = 0;
    const list = cells();
    for (let idx = 0; idx < list.length; idx++) {
        if (list[idx].classList.contains('sudoku-given')) continue;
        if (seen++ === n) return idx;
    }
    throw new Error('пустых клеток не осталось');
}

console.log('input (jsdom)');

test('окно собрано вместе с numpad', () => {
    assert(root, 'попап получил корень игры');
    assertEqual(root.querySelectorAll('.sudoku-pad-btn').length, 9, 'кнопок цифр');
    assertEqual(root.querySelectorAll('.sudoku-pad-action').length, 4, 'кнопок действий');
});

test('клик по клетке выделяет её, повторный — снимает', () => {
    const idx = emptyCell();
    click(cells()[idx]);
    assert(cells()[idx].classList.contains('sudoku-selected'), 'клетка выделена');
    assert(cells()[idx + 1].classList.contains('sudoku-peer'), 'сосед подсвечен');

    click(cells()[idx]);
    assert(!cells()[idx].classList.contains('sudoku-selected'), 'повторный клик снял выделение');
});

test('цифра с клавиатуры попадает в выбранную клетку', () => {
    const idx = emptyCell();
    select(idx);
    press('5');
    assertEqual(valueAt(idx), '5', 'цифра проставлена');

    // Повторный ввод той же цифры стирает её.
    press('5');
    assertEqual(valueAt(idx), '', 'повторное нажатие стёрло цифру');
});

test('клавиша не доходит до поля ввода чата', () => {
    const chat = document.getElementById('send_textarea');
    let leaked = 0;
    const spy = () => leaked++;
    chat.addEventListener('keydown', spy);

    select(emptyCell());
    const event = press('7');
    assertEqual(leaked, 0, 'событий, дошедших до чата');
    assert(event.defaultPrevented, 'событие погашено preventDefault');

    // Необработанная клавиша проходит насквозь — чужие хоткеи ST не ломаем.
    const passthrough = press('F5');
    assertEqual(leaked, 1, 'необработанная клавиша дошла до чата');
    assert(!passthrough.defaultPrevented, 'необработанная клавиша не гасится');

    chat.removeEventListener('keydown', spy);
    press('7'); // убираем за собой
});

test('стрелки двигают выделение и не выходят за край', () => {
    select(0);
    press('ArrowRight');
    assert(cells()[1].classList.contains('sudoku-selected'), 'сдвиг вправо');
    press('ArrowDown');
    assert(cells()[10].classList.contains('sudoku-selected'), 'сдвиг вниз');
    press('ArrowUp');
    press('ArrowLeft');
    press('ArrowLeft'); // упор в левый край
    assert(cells()[0].classList.contains('sudoku-selected'), 'выделение осталось в углу');
});

test('moveSelection не перепрыгивает на соседнюю строку', () => {
    assertEqual(moveSelection(8, 1), 8, 'правый край строки');
    assertEqual(moveSelection(9, -1), 9, 'левый край строки');
    assertEqual(moveSelection(0, -9), 0, 'верхний край');
    assertEqual(moveSelection(80, 9), 80, 'нижний край');
    assertEqual(moveSelection(null, 1), 0, 'первое нажатие ставит курсор в угол');
});

test('режим заметок пишет пометки, а не значения', () => {
    const idx = emptyCell();
    select(idx);
    press('n');
    assert(actionButton('notes').classList.contains('sudoku-pad-on'), 'кнопка заметок активна');
    assert(/режим заметок/.test(status()), 'статус сообщает о режиме');

    press('3');
    const notes = cells()[idx].querySelectorAll('.sudoku-note');
    assert(notes[2].classList.contains('sudoku-note-on'), 'пометка 3 поставлена');
    assertEqual(valueAt(idx), '', 'значение не изменилось');

    press('3');
    assert(!notes[2].classList.contains('sudoku-note-on'), 'повторное нажатие сняло пометку');

    click(actionButton('notes'));
    assert(!actionButton('notes').classList.contains('sudoku-pad-on'), 'режим выключен кнопкой');
});

test('numpad ставит цифру и показывает счётчик оставшихся', () => {
    const idx = emptyCell();
    select(idx);

    const before = padButton(4).querySelector('.sudoku-pad-left').textContent;
    click(padButton(4));
    assertEqual(valueAt(idx), '4', 'цифра с numpad проставлена');

    const after = padButton(4).querySelector('.sudoku-pad-left').textContent;
    assertEqual(Number(after), Number(before) - 1, 'счётчик оставшихся уменьшился');

    click(actionButton('erase'));
    assertEqual(valueAt(idx), '', 'кнопка «стереть» очистила клетку');
});

test('undo/redo откатывают ход и авточистку пометок у соседей', () => {
    const idx = emptyCell();
    const peer = idx + 1 < 81 && Math.floor((idx + 1) / 9) === Math.floor(idx / 9)
        ? idx + 1
        : idx - 1;

    // Пометка 6 у соседа по строке; ставим 6 рядом — авточистка её снимет.
    select(peer);
    press('n');
    press('6');
    press('n');
    const peerNote = () => cells()[peer].querySelectorAll('.sudoku-note')[5].classList.contains('sudoku-note-on');
    assert(peerNote(), 'пометка у соседа стоит');

    select(idx);
    press('6');
    assertEqual(valueAt(idx), '6', 'цифра проставлена');
    assert(!peerNote(), 'авточистка сняла пометку у соседа');

    press('z', { ctrlKey: true });
    assertEqual(valueAt(idx), '', 'undo убрал цифру');
    assert(peerNote(), 'undo вернул пометку соседа');

    press('y', { ctrlKey: true });
    assertEqual(valueAt(idx), '6', 'redo вернул цифру');
    assert(!peerNote(), 'redo снова снял пометку');

    press('z', { ctrlKey: true });
    select(peer);
    click(actionButton('erase')); // убираем пометку за собой
});

test('кнопки undo/redo гаснут, когда откатывать нечего', () => {
    // История непустая после предыдущих тестов, поэтому проверяем только redo:
    // новый ход обесценивает redo-ветку.
    select(emptyCell());
    press('8');
    assert(actionButton('redo').classList.contains('sudoku-pad-off'), 'redo погашен после нового хода');
    assert(!actionButton('undo').classList.contains('sudoku-pad-off'), 'undo доступен');
    press('8');
});

test('доска, пройденная до конца с клавиатуры, засчитывается как победа', () => {
    const list = cells();
    // Решение партии наружу не отдаётся, поэтому тест решает видимый пазл сам:
    // подсказки читаются из DOM, решение считает солвер ядра. Заодно это проверка
    // того, что доска действительно проходима только клавиатурой.
    const puzzle = list.map((cell) => (
        cell.classList.contains('sudoku-given') ? Number(cell.querySelector('.sudoku-value').textContent) : 0
    ));
    const solution = solve(puzzle);
    assert(solution, 'видимый пазл решается');

    for (let idx = 0; idx < list.length; idx++) {
        if (list[idx].classList.contains('sudoku-given')) continue;
        select(idx);
        if (valueAt(idx) !== String(solution[idx])) {
            if (valueAt(idx)) press('Delete');
            press(String(solution[idx]));
        }
    }

    assertEqual(list.filter((cell) => cell.querySelector('.sudoku-value').textContent).length, 81, 'клеток заполнено');
    assert(/решено за/.test(status()), `статус победы: ${status()}`);
    assert(root.querySelector('.sudoku-board').classList.contains('sudoku-board-done'), 'доска помечена решённой');

    // Решённая партия заморожена: цифры больше не принимаются.
    const idx = list.findIndex((cell) => !cell.classList.contains('sudoku-given'));
    select(idx);
    press('1');
    assertEqual(valueAt(idx), String(solution[idx]), 'после победы ход не проходит');
});

releasePopup();
await opened;

test('после закрытия окна клавиатура отпускает чат', () => {
    const chat = document.getElementById('send_textarea');
    let leaked = 0;
    const spy = () => leaked++;
    chat.addEventListener('keydown', spy);
    press('5');
    chat.removeEventListener('keydown', spy);
    assertEqual(leaked, 1, 'событие дошло до чата после закрытия');
});

report('input');
