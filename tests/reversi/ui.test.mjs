// Тесты экрана реверси под jsdom (Фаза 8.3): монтирование через оболочку, ход мышью и
// с клавиатуры, ответ соперника по таймеру и — главное в фазе — destroy() посреди
// «раздумий» соперника.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/reversi/ui.test.mjs

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

// Ход соперника откладывается через setTimeout. Настоящие таймеры сделали бы тест
// плавающим, поэтому очередь своя: pending — то, что ещё «не сработало», scheduled — все
// когда-либо поставленные колбэки (нужны, чтобы выстрелить таймером уже после destroy(),
// как это делает браузер с колбэком, ушедшим в очередь макрозадач до clearTimeout).
const pending = new Map();
const scheduled = [];
let nextTimerId = 1;

globalThis.setTimeout = (fn, ms) => {
    const id = nextTimerId++;
    pending.set(id, fn);
    scheduled.push({ id, fn, ms });
    return id;
};
globalThis.clearTimeout = (id) => {
    pending.delete(id);
};

// Прогоняет таймеры с задержкой ≥ minMs: колбэки фокуса оболочки (0 мс) трогать не надо,
// нас интересует только ход соперника (300 мс).
function runTimers(minMs = 1) {
    const due = scheduled.filter((t) => t.ms >= minMs && pending.has(t.id));
    for (const timer of due) {
        pending.delete(timer.id);
        timer.fn();
    }
    return due.length;
}

function aiTimer() {
    return scheduled.filter((t) => t.ms >= 1).at(-1) ?? null;
}

const { clear, register } = await import('../../src/registry.js');
const reversiGame = (await import('../../src/games/reversi/index.js')).default;
const snakeGame = (await import('../../src/games/snake/index.js')).default;
const { isOpen, openShell, refresh } = await import('../../src/shell/modal.js');
const { getSettings } = await import('../../src/settings.js');
const { readEntry, resetStats } = await import('../../src/games/reversi/core/stats.js');

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

const cellAt = (root, x, y) => root.querySelector(`.reversi-cell[data-idx="${y * 8 + x}"]`);
const statusOf = (root) => root.querySelector('.reversi-status').textContent;
const discs = (root, cls) => root.querySelectorAll(`.reversi-cell.${cls}`).length;

console.log('reversi ui (jsdom)');

clear();
register(reversiGame);
register(snakeGame);

// --- Хаб и монтирование

await session({}, async (root) => {
    test('плитка реверси в хабе', () => {
        assert(isOpen(), 'окно открыто');
        const tile = root.querySelector('.stg-tile[data-game-id="reversi"]');
        assert(tile, 'плитка на месте');
        assertEqual(tile.querySelector('.stg-tile-title').textContent, 'Реверси', 'название');
        assert(tile.querySelector('i.fa-circle-half-stroke'), 'иконка');
    });
});

await session({ gameId: 'reversi' }, async (root) => {
    test('mount строит доску 8×8, шапку и строку статуса', () => {
        assertEqual(root.querySelectorAll('.reversi-cell').length, 64, 'клеток на доске');
        assertEqual(discs(root, 'reversi-black'), 2, 'чёрных фишек в старте');
        assertEqual(discs(root, 'reversi-white'), 2, 'белых фишек в старте');
        assert(root.querySelector('.reversi-score').textContent.includes('2 : 2'), 'счёт в шапке');
        assert(root.querySelector('.reversi-status'), 'строка статуса');
        assert(root.querySelector('.reversi-btn'), 'кнопка «Новая игра»');
    });

    test('клетки — gridcell с roving tabindex, а не кнопки', () => {
        assertEqual(root.querySelectorAll('.reversi-cell button').length, 0, 'кнопок внутри доски нет');
        const focusable = [...root.querySelectorAll('.reversi-cell')].filter((c) => c.tabIndex === 0);
        assertEqual(focusable.length, 1, 'фокусируема ровно одна клетка');
        assertEqual(
            root.querySelector('.reversi-board').getAttribute('aria-activedescendant'),
            focusable[0].id,
            'курсор объявлен через aria-activedescendant',
        );
    });

    test('подсвечены четыре хода чёрных', () => {
        assertEqual(discs(root, 'reversi-hint'), 4, 'подсказок');
        for (const [x, y] of [[3, 2], [2, 3], [5, 4], [4, 5]]) {
            assert(cellAt(root, x, y).classList.contains('reversi-hint'), `ход ${x},${y} подсвечен`);
        }
    });

    test('клик по нелегальной клетке ничего не меняет', () => {
        cellAt(root, 0, 0).click();
        assertEqual(discs(root, 'reversi-black'), 2, 'фишек не прибавилось');
        assertEqual(aiTimer(), null, 'соперник не вызван');
    });

    test('ход игрока переворачивает фишку и отдаёт очередь сопернику', () => {
        cellAt(root, 3, 2).click();

        assertEqual(discs(root, 'reversi-black'), 4, 'чёрных стало четыре');
        assertEqual(discs(root, 'reversi-white'), 1, 'белая осталась одна');
        assert(cellAt(root, 3, 2).classList.contains('reversi-last'), 'последний ход отмечен');
        assertEqual(statusOf(root), 'Соперник думает…', 'экран сообщает о раздумьях');
        assertEqual(discs(root, 'reversi-hint'), 0, 'на чужом ходу подсказок нет');
        assert(aiTimer(), 'ход соперника отложен таймером');
        assertEqual(aiTimer().ms, 300, 'пауза 300 мс');
    });

    test('пока соперник думает, клики по доске игнорируются', () => {
        const before = root.querySelector('.reversi-score').textContent;
        cellAt(root, 2, 3).click();
        cellAt(root, 5, 4).click();
        assertEqual(root.querySelector('.reversi-score').textContent, before, 'счёт не изменился');
        assertEqual(statusOf(root), 'Соперник думает…', 'экран всё ещё ждёт соперника');
    });

    test('таймер отдаёт ход соперника и возвращает очередь игроку', () => {
        assertEqual(runTimers(), 1, 'сработал один отложенный ход');

        assertEqual(discs(root, 'reversi-white') + discs(root, 'reversi-black'), 6, 'фишек на доске стало шесть');
        assertEqual(statusOf(root), '', 'раздумья закончились');
        assert(root.querySelector('.reversi-turn').textContent.startsWith('Ваш ход'), 'очередь у игрока');
        assert(discs(root, 'reversi-hint') > 0, 'ходы игрока снова подсвечены');
    });

    test('стрелка двигает курсор, Enter делает ход, чужие клавиши не гасятся', () => {
        const board = root.querySelector('.reversi-board');
        const startCursor = board.getAttribute('aria-activedescendant');

        const arrow = new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        board.dispatchEvent(arrow);
        assert(arrow.defaultPrevented, 'стрелка обработана игрой');
        assert(board.getAttribute('aria-activedescendant') !== startCursor, 'курсор сдвинулся');

        const letter = new dom.window.KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true });
        board.dispatchEvent(letter);
        assert(!letter.defaultPrevented, 'необработанная клавиша уходит к таверне');

        const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        board.dispatchEvent(escape);
        assert(!escape.defaultPrevented, 'Esc не перехватывается — его получает попап');

        // Курсор на подсвеченный ход и Enter.
        const hint = root.querySelector('.reversi-cell.reversi-hint');
        const target = Number(hint.dataset.idx);
        const before = discs(root, 'reversi-black') + discs(root, 'reversi-white');
        moveCursorTo(board, target);
        assertEqual(board.getAttribute('aria-activedescendant'), `reversi-cell-${target}`, 'курсор доехал');

        const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        board.dispatchEvent(enter);
        assert(enter.defaultPrevented, 'Enter обработан игрой');
        assert(discs(root, 'reversi-black') + discs(root, 'reversi-white') > before, 'ход сделан');
        assertEqual(statusOf(root), 'Соперник думает…', 'снова очередь соперника');
    });

    test('destroy() посреди раздумий не роняет экран и не пишет в DOM', () => {
        const timer = aiTimer();
        assert(timer && pending.has(timer.id), 'ход соперника ещё висит в очереди');

        // Оболочка размонтирует экран синхронно и таймера не ждёт.
        const screen = root.querySelector('.stg-screen');
        root.querySelector('.stg-back').click();
        assertEqual(screen.querySelectorAll('.reversi-cell').length, 0, 'экран игры снят');
        assert(!pending.has(timer.id), 'таймер снят в destroy()');

        // А теперь — то, ради чего фаза вообще трогает контракт: колбэк, переживший
        // destroy() (в браузере он мог уже уйти в очередь макрозадач), обязан выйти
        // молча, ничего не нарисовав.
        const htmlBefore = screen.innerHTML;
        timer.fn();
        assertEqual(screen.innerHTML, htmlBefore, 'DOM не тронут');
        assertEqual(screen.querySelectorAll('.reversi-cell').length, 0, 'доска не воскресла');
        assert(screen.querySelector('.stg-hub'), 'на экране хаб');
    });
});

// --- Игра белыми: соперник ходит первым

await test('игра белыми: соперник ходит первым', async () => {
    getSettings().games.reversi.playAs = 'white';

    await session({ gameId: 'reversi' }, async (root) => {
        assertEqual(statusOf(root), 'Соперник думает…', 'ждём хода соперника сразу после монтирования');
        assertEqual(discs(root, 'reversi-hint'), 0, 'подсказок на чужом ходу нет');

        assertEqual(runTimers(), 1, 'сработал ход соперника');
        assertEqual(discs(root, 'reversi-black'), 4, 'чёрные сходили');
        assert(root.querySelector('.reversi-turn').textContent.startsWith('Ваш ход'), 'очередь игрока');
    });

    getSettings().games.reversi.playAs = 'black';
});

// --- Настройки на лету

await test('refresh() гасит подсказки, когда их выключили в настройках', async () => {
    await session({ gameId: 'reversi' }, async (root) => {
        assert(discs(root, 'reversi-hint') > 0, 'подсказки включены по умолчанию');

        getSettings().games.reversi.showHints = false;
        refresh();
        assertEqual(discs(root, 'reversi-hint'), 0, 'после refresh() подсветка снята');

        getSettings().games.reversi.showHints = true;
        refresh();
        assert(discs(root, 'reversi-hint') > 0, 'и возвращается обратно');
    });
});

// --- Сохранение партии (8.4)

await test('партия сохраняется после хода и восстанавливается при следующем открытии', async () => {
    const settings = getSettings().games.reversi;
    settings.savedGame = null;
    let signature = null;

    await session({ gameId: 'reversi' }, async (root) => {
        cellAt(root, 3, 2).click();
        assertEqual(runTimers(), 1, 'соперник ответил');

        assert(settings.savedGame, 'партия записана в настройки');
        assertEqual(settings.savedGame.board.length, 64, 'доска — строка из 64 символов');
        assertEqual(settings.savedGame.level, 'medium', 'уровень партии сохранён вместе с доской');
        signature = boardSignature(root);
    });

    await session({ gameId: 'reversi' }, async (root) => {
        assertEqual(boardSignature(root), signature, 'доска восстановлена в точности');
        assert(root.querySelector('.reversi-turn').textContent.startsWith('Ваш ход'), 'очередь та же');
        assertEqual(aiTimer() && pending.has(aiTimer().id), false, 'соперника не дёргаем на своём ходу');
    });
});

await test('битая сохранённая партия означает новую, а не сломанный экран', async () => {
    getSettings().games.reversi.savedGame = { board: 'мусор', turn: 7 };

    await session({ gameId: 'reversi' }, async (root) => {
        assertEqual(discs(root, 'reversi-black'), 2, 'стартовая позиция');
        assertEqual(discs(root, 'reversi-white'), 2, 'стартовая позиция');
    });
});

// --- Слэш-команда

test('slash.parse пропускает только известные уровни', () => {
    assertEqual(reversiGame.slash.parse('hard').level, 'hard', 'уровень распознан');
    assertEqual(reversiGame.slash.parse(' HARD ').level, 'hard', 'регистр и пробелы не мешают');
    assertEqual(reversiGame.slash.parse('нечто').level, undefined, 'чужое значение отброшено');
    assertEqual(reversiGame.slash.parse('').level, undefined, 'вход без аргумента');
});

await test('/reversi hard задаёт уровень и начинает новую партию', async () => {
    const settings = getSettings().games.reversi;
    settings.level = 'medium';

    await session({ gameId: 'reversi' }, async (root) => {
        cellAt(root, 3, 2).click();
        runTimers();
        assert(settings.savedGame, 'есть незаконченная партия');
    });

    await session({ gameId: 'reversi', args: { level: 'hard' } }, async (root) => {
        assertEqual(settings.level, 'hard', 'уровень из команды записан в настройки');
        assertEqual(root.querySelector('.reversi-level').textContent, 'Сложный', 'шапка показывает уровень');
        assertEqual(discs(root, 'reversi-black'), 2, 'явный уровень начинает новую партию, а не продолжает');
    });

    settings.level = 'medium';
});

// --- Статистика

await test('партия до конца: «сыграно» на старте, результат один раз в конце', async () => {
    const settings = getSettings().games.reversi;
    settings.level = 'easy'; // глубина 1 — партия доигрывается быстро
    settings.savedGame = null;
    resetStats(settings.stats);

    await session({ gameId: 'reversi' }, async (root) => {
        assertEqual(readEntry(settings.stats, 'easy').played, 1, 'сыграно засчитано при старте');

        assert(playToEnd(root), 'партия доиграна до конца');

        const entry = readEntry(settings.stats, 'easy');
        assertEqual(entry.played, 1, 'партия не посчитана дважды');
        assertEqual(entry.wins + entry.losses + entry.draws, 1, 'результат записан ровно один раз');
        assert(statusOf(root).includes('Новая игра'), 'экран предлагает начать заново');

        // Ещё один прогон рендера и destroy() не должны дописать второй результат:
        // запись результата — строго один раз за партию.
        refresh();
        assertEqual(readEntry(settings.stats, 'easy').wins + readEntry(settings.stats, 'easy').losses
            + readEntry(settings.stats, 'easy').draws, 1, 'результат всё ещё один');
    });

    await session({ gameId: 'reversi' }, async (root) => {
        assertEqual(discs(root, 'reversi-black'), 2, 'доигранная партия не восстанавливается');
        assertEqual(readEntry(settings.stats, 'easy').played, 2, 'новая партия засчитана в «сыграно»');
    });

    settings.level = 'medium';
});

// --- Панель настроек и статистики

test('панель настроек рисует уровень, цвет и подсветку', () => {
    const container = document.createElement('div');
    const api = { settings: getSettings().games.reversi, save: () => {}, renderAllStats: () => {}, onSettingsChanged: () => {} };
    reversiGame.renderSettings(container, api);

    const level = container.querySelector('#reversi_level');
    const playAs = container.querySelector('#reversi_play_as');
    const hints = container.querySelector('#reversi_show_hints');
    assert(level && playAs && hints, 'три контрола на месте');
    assertEqual(level.value, 'medium', 'селектор показывает текущий уровень');
    assertEqual(hints.checked, true, 'подсветка включена');

    level.value = 'hard';
    level.dispatchEvent(new dom.window.Event('change'));
    assertEqual(getSettings().games.reversi.level, 'hard', 'уровень уехал в настройки');

    // Значение не из списка (правка DOM, старое сохранение) сводится к дефолту, а не
    // попадает в настройки и в ключи статистики.
    level.value = 'нечто';
    level.dispatchEvent(new dom.window.Event('change'));
    assertEqual(getSettings().games.reversi.level, 'medium', 'чужое значение сведено к дефолту');

    hints.checked = false;
    hints.dispatchEvent(new dom.window.Event('change'));
    assertEqual(getSettings().games.reversi.showHints, false, 'чекбокс пишет в настройки');
    getSettings().games.reversi.showHints = true;
});

test('панель статистики: строка на уровень и сброс', () => {
    const container = document.createElement('div');
    const api = { settings: getSettings().games.reversi, save: () => {}, renderAllStats: () => {}, onSettingsChanged: () => {} };
    reversiGame.renderStats(container, api);

    // Шапка плюс три уровня.
    assertEqual(container.querySelectorAll('.reversi-stats-row').length, 4, 'строк в таблице');
    const easyRow = [...container.querySelectorAll('.reversi-stats-row')][1];
    assertEqual(easyRow.children[0].textContent, 'Лёгкий', 'первый уровень — лёгкий');
    assertEqual(easyRow.children[1].textContent, '2', 'сыграно из предыдущего теста');

    const reset = container.querySelector('#reversi_stats_reset');
    assertEqual(reset.style.display, '', 'при непустой статистике сброс виден');
    reset.click();
    assertEqual(readEntry(getSettings().games.reversi.stats, 'easy').played, 0, 'статистика обнулена');

    reversiGame.renderStats(container, api);
    assertEqual(container.querySelector('#reversi_stats_reset').style.display, 'none', 'без партий сброса нет');
    assertEqual(container.querySelector('#reversi_stats_hint').style.display, '', 'вместо него — пояснение');
});

test('после закрытия попапа isOpen() === false', () => {
    assertEqual(isOpen(), false, 'сессия закрыта');
});

// Позиция на доске как строка: сравнивает восстановленную партию с исходной, не завися
// от разметки шапки и статуса.
function boardSignature(root) {
    return [...root.querySelectorAll('.reversi-cell')]
        .map((cell) => (cell.classList.contains('reversi-black') ? 'b'
            : cell.classList.contains('reversi-white') ? 'w' : '.'))
        .join('');
}

// Доигрывает партию: свой ход — клик по первой подсказке, чужой — прогон отложенного
// таймера. Возвращает false, если партия не закончилась за отведённые шаги.
function playToEnd(root) {
    for (let guard = 0; guard < 300; guard++) {
        if (root.querySelector('.reversi-turn').textContent === 'Партия окончена') return true;
        const hint = root.querySelector('.reversi-cell.reversi-hint');
        if (hint) hint.click();
        else if (!runTimers()) return false;
    }
    return false;
}

// Курсор двигается только стрелками — доезжаем до нужной клетки по осям.
function moveCursorTo(board, target) {
    const press = (key) => board.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    for (let guard = 0; guard < 32; guard++) {
        const now = Number(board.getAttribute('aria-activedescendant').replace('reversi-cell-', ''));
        if (now === target) return;
        const dx = (target % 8) - (now % 8);
        const dy = Math.floor(target / 8) - Math.floor(now / 8);
        if (dx) press(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
        else press(dy > 0 ? 'ArrowDown' : 'ArrowUp');
    }
}

report('reversi ui');
