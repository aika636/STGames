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
import { assert, assertEqual, report, test } from '../_harness.mjs';

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

const { clear, register } = await import('../../src/registry.js');
const sudokuGame = (await import('../../src/games/sudoku/index.js')).default;
const { openShell } = await import('../../src/shell/modal.js');
const { moveSelection } = await import('../../src/games/sudoku/ui/input.js');
const { solve } = await import('../../src/games/sudoku/core/solver.js');

clear();
register(sudokuGame);

// --- Одна открытая партия на весь файл: сессия в modal.js единственная, и держать
// --- попап «висящим» дешевле, чем переоткрывать его в каждом тесте.

let root = null;
let releasePopup;
const held = new Promise((resolve) => { releasePopup = resolve; });

context.callGenericPopup = (content) => {
    root = content;
    return held;
};

const opened = openShell({ gameId: 'sudoku', args: { difficulty: 'easy' } });
await Promise.resolve(); // даём openShell дойти до showPopup

const cells = () => Array.from(root.querySelectorAll('.sudoku-cell'));
const valueAt = (idx) => cells()[idx].querySelector('.sudoku-value').textContent;
const status = () => root.querySelector('.sudoku-status').textContent;
const remainingFor = (digit) => root.querySelectorAll('.sudoku-remaining-item')[digit - 1]
    .querySelector('.sudoku-remaining-left').textContent;
const actionButton = (name) => root.querySelector(`.sudoku-pad-action[data-action="${name}"]`);
const digitButton = (digit) => root.querySelector(`.sudoku-remaining-item[data-digit="${digit}"]`);

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

// Пара пустых клеток в одной строке. Доска каждый раз новая, фиксированных
// индексов нет, а «сосед справа» может оказаться подсказкой.
function emptyPairInRow() {
    const list = cells();
    const free = (idx) => !list[idx].classList.contains('sudoku-given')
        && !list[idx].querySelector('.sudoku-value').textContent;

    for (let row = 0; row < 9; row++) {
        const inRow = [];
        for (let col = 0; col < 9; col++) {
            const idx = row * 9 + col;
            if (free(idx)) inRow.push(idx);
        }
        if (inRow.length >= 2) return [inRow[0], inRow[1]];
    }
    throw new Error('не нашлось двух пустых клеток в одной строке');
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

test('окно собрано: ряд цифр и кнопки действий', () => {
    assert(root, 'попап получил корень игры');
    assertEqual(root.querySelectorAll('.sudoku-remaining-item').length, 9, 'кнопок ряда цифр');
    assertEqual(root.querySelectorAll('.sudoku-pad-action').length, 4, 'кнопок действий');
});

test('клик по клетке выделяет её, повторный — снимает', () => {
    const idx = emptyCell();
    click(cells()[idx]);
    assert(cells()[idx].classList.contains('sudoku-selected'), 'клетка выделена');
    assertEqual(root.querySelectorAll('.sudoku-peer').length, 0, 'строка и столбец не заливаются');

    click(cells()[idx]);
    assert(!cells()[idx].classList.contains('sudoku-selected'), 'повторный клик снял выделение');
});

// Попап ST при открытии сам ставит фокус на первый focusable-элемент окна — это select
// уровня. Пока он не отдавал цифры игре, ввод молчал до первого клика по кнопке.
test('цифра проходит, даже когда фокус на селекторе уровня', () => {
    const levelSelect = root.querySelector('.sudoku-select');
    const idx = emptyCell();
    select(idx);

    // Попап-заглушка окно в документ не вставляет, а событие с оторванного узла до
    // document не всплывает — вешаем окно в body на время теста.
    document.body.appendChild(root);

    press('1', { target: levelSelect });
    assertEqual(valueAt(idx), '1', 'цифра поставлена при фокусе на select');

    // Стрелки остаются за самим select: ими игрок листает список уровней.
    const arrow = press('ArrowDown', { target: levelSelect });
    assert(!arrow.defaultPrevented, 'стрелка отдана селектору');

    press('1', { target: levelSelect }); // повторный ввод стирает — доска чистая
    assertEqual(valueAt(idx), '', 'клетка снова пуста');

    root.remove();
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

// Единственный способ ввода на телефоне: системной клавиатуры у попапа ST нет,
// потому что в окне игры нет ни одного поля ввода.
test('тап по цифре в ряду ставит её в выбранную клетку', () => {
    const idx = emptyCell();
    select(idx);

    click(digitButton(2));
    assertEqual(valueAt(idx), '2', 'цифра поставлена тапом');

    click(digitButton(2));
    assertEqual(valueAt(idx), '', 'повторный тап стёр цифру');

    // Режим заметок работает и для тапа — иначе на телефоне пометок не поставить.
    press('n');
    click(digitButton(9));
    const notes = cells()[idx].querySelectorAll('.sudoku-note');
    assert(notes[8].classList.contains('sudoku-note-on'), 'тап в режиме заметок дал пометку');
    click(digitButton(9));
    press('n');
});

test('счётчик оставшихся цифр идёт за ходами', () => {
    const idx = emptyCell();
    select(idx);

    const before = remainingFor(4);
    press('4');
    assertEqual(valueAt(idx), '4', 'цифра проставлена');
    assertEqual(Number(remainingFor(4)), Number(before) - 1, 'счётчик оставшихся уменьшился');

    click(actionButton('erase'));
    assertEqual(valueAt(idx), '', 'кнопка «стереть» очистила клетку');
    assertEqual(remainingFor(4), before, 'счётчик вернулся к прежнему значению');
});

test('undo/redo откатывают ход и авточистку пометок у соседей', () => {
    // Нужны две пустые клетки в одной строке: авточистка снимает пометку только
    // у соседей по строке, столбцу или боксу.
    const [idx, peer] = emptyPairInRow();

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

test('победа попадает в статистику уровня', () => {
    const stats = context.extensionSettings.STGames.games.sudoku.stats.easy;
    assertEqual(stats.played, 1, 'сыграно');
    assertEqual(stats.solved, 1, 'решено');
    assert(Number.isFinite(stats.bestTimeMs), `лучшее время записано: ${stats.bestTimeMs}`);
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
