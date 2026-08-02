// Тесты сохранения партии (Фаза 4) под jsdom: закрытие окна не теряет ни доску,
// ни время, а повторное открытие продолжает ту же партию, а не начинает новую.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/persist.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from '../_harness.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

let saves = 0;

const context = {
    extensionSettings: {},
    saveSettingsDebounced: () => { saves++; },
    POPUP_TYPE: { DISPLAY: 4 },
    callGenericPopup: null,
};

globalThis.SillyTavern = { getContext: () => context };

const { clear, register } = await import('../../src/registry.js');
const sudokuGame = (await import('../../src/games/sudoku/index.js')).default;
const { openShell } = await import('../../src/shell/modal.js');

clear();
register(sudokuGame);

// Каждая сессия живёт внутри одного вызова session(): открыли окно, поработали
// с корнем, закрыли попап. Так же, как это делает игрок.
async function session(body, options = {}) {
    let root = null;
    let release;
    const held = new Promise((resolve) => { release = resolve; });

    context.callGenericPopup = (content) => {
        root = content;
        return held;
    };

    const opened = openShell({ gameId: 'sudoku', args: options });
    await Promise.resolve();

    const result = await body(root);

    release();
    await opened;
    return result;
}

const saved = () => context.extensionSettings.STGames.games.sudoku.savedGame;
const stats = () => context.extensionSettings.STGames.games.sudoku.stats;

const cellsOf = (root) => Array.from(root.querySelectorAll('.sudoku-cell'));
const valuesOf = (root) => cellsOf(root).map((cell) => cell.querySelector('.sudoku-value').textContent);

function click(el) {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// Индекс первой пустой (не-подсказки) клетки.
function emptyCell(root) {
    const list = cellsOf(root);
    const idx = list.findIndex((cell) => !cell.classList.contains('sudoku-given'));
    if (idx < 0) throw new Error('пустых клеток нет');
    return idx;
}

console.log('persist (jsdom)');

// --- Партия первая: ходим и закрываем окно.

const first = await session(async (root) => {
    const idx = emptyCell(root);
    click(cellsOf(root)[idx]);
    click(root.querySelector('.sudoku-remaining-item[data-digit="7"]'));

    test('ход сразу уходит в extensionSettings', () => {
        assert(saved(), 'savedGame записан');
        assertEqual(saved().values[idx], 7, 'значение в сохранении');
        assert(saves > 0, 'saveSettingsDebounced позван');
    });

    return { idx, puzzle: saved().puzzle.slice(), values: valuesOf(root) };
});

test('после закрытия окна таймер остановлен, а время сохранено', () => {
    assertEqual(saved().completedAt, null, 'партия не помечена решённой');
    assert(Number.isFinite(saved().elapsedMs), 'elapsedMs — число');
    // Ключевое: startedAt в сохранение не попадает вовсе, поэтому «набежать» между
    // сессиями время не может — при загрузке отсчёт начнётся заново от elapsedMs.
    assert(!('startedAt' in saved()), 'бегущий startedAt в сохранение не уходит');
});

const elapsedAfterClose = saved().elapsedMs;

// --- Партия вторая: открываем без аргумента — должна восстановиться та же доска.

test('созданная доска сразу засчитана в «сыграно»', () => {
    assertEqual(stats().medium.played, 1, 'сыграно на среднем');
    assertEqual(stats().medium.solved, 0, 'решено');
    assertEqual(stats().medium.bestTimeMs, null, 'рекорда нет');
});

await session(async (root) => {
    test('восстановление партии не считается новой игрой', () => {
        assertEqual(stats().medium.played, 1, 'сыграно не выросло');
    });

    test('окно без аргумента продолжает сохранённую партию', () => {
        assertEqual(saved().puzzle.join(), first.puzzle.join(), 'пазл тот же');
        assertEqual(valuesOf(root).join(), first.values.join(), 'доска восстановлена как была');
        assert(
            cellsOf(root)[first.idx].querySelector('.sudoku-value').textContent === '7',
            'ход игрока на месте',
        );
    });

    test('время продолжается с сохранённого, а не с нуля', () => {
        assert(saved().elapsedMs >= elapsedAfterClose, 'время не откатилось назад');
        // Между закрытием и открытием прошло меньше секунды реального времени —
        // проверяем, что паузу игре не засчитали.
        assert(saved().elapsedMs - elapsedAfterClose < 1000, 'пауза не засчитана в партию');
    });
});

// --- Явный уровень: игрок просит новую партию, а не продолжение.

await session(async (root) => {
    test('/sudoku <уровень> начинает новую партию поверх сохранённой', () => {
        assert(saved().puzzle.join() !== first.puzzle.join(), 'пазл новый');
        assertEqual(saved().difficulty, 'hard', 'уровень заказанный');
        assertEqual(root.querySelector('.sudoku-select').value, 'hard', 'селектор показывает уровень');
    });

    test('новая партия засчитана своему уровню, а не предыдущему', () => {
        assertEqual(stats().hard.played, 1, 'сыграно на сложном');
        assertEqual(stats().medium.played, 1, 'на среднем не выросло');
    });
}, { difficulty: 'hard' });

// --- Решённая партия не восстанавливается: открывать окно с готовой доской незачем.

context.extensionSettings.STGames.games.sudoku.savedGame.completedAt = Date.now();
const solvedPuzzle = saved().puzzle.join();

await session(async () => {
    test('решённая партия не восстанавливается — начинается новая', () => {
        assert(saved().puzzle.join() !== solvedPuzzle, 'пазл новый');
        assertEqual(saved().completedAt, null, 'новая партия не помечена решённой');
    });
});

// --- Битое сохранение не должно ломать открытие окна.

context.extensionSettings.STGames.games.sudoku.savedGame = { version: 1, puzzle: [1, 2, 3] };

await session(async (root) => {
    test('битое сохранение игнорируется, окно открывается', () => {
        assertEqual(cellsOf(root).length, 81, 'доска собрана');
        assertEqual(saved().puzzle.length, 81, 'сохранение перезаписано новой партией');
    });
});

report('persist');
