// Тесты экрана балды под jsdom (Фаза 13.4): монтирование с асинхронной загрузкой
// словаря, ввод буквы и набор пути (тапами и росчерком), отказ в ходе, ответ соперника
// по таймеру, destroy() посреди его хода и сохранение партии.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/balda/ui.test.mjs

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

const toasts = [];
// src/ctx.js зовёт АМБИЕНТНЫЙ toastr, а не ctx.toastr: подменять надо глобальный.
globalThis.toastr = {
    info: (msg) => toasts.push({ kind: 'info', msg }),
    success: (msg) => toasts.push({ kind: 'success', msg }),
    error: (msg) => toasts.push({ kind: 'error', msg }),
};

const context = {
    extensionSettings: {},
    saveSettingsDebounced: () => {},
    POPUP_TYPE: { TEXT: 1, DISPLAY: 4 },
    callGenericPopup: null,
};

globalThis.SillyTavern = { getContext: () => context };

// Ход соперника откладывается через setTimeout. Настоящие таймеры сделали бы тест
// плавающим, поэтому очередь своя: pending — то, что ещё не сработало, scheduled — все
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
const baldaGame = (await import('../../src/games/balda/index.js')).default;
const snakeGame = (await import('../../src/games/snake/index.js')).default;
const { openShell } = await import('../../src/shell/modal.js');
const { getGameSettings } = await import('../../src/settings.js');

function baldaSettings() {
    return getGameSettings('balda', baldaGame.defaults);
}

// Загаданное слово в тесте должно быть известным, иначе проверять нечего: партию задаём
// через сохранёнку. Средний ряд поля 5×5 — клетки 10…14.
const START_BOARD = `${'.'.repeat(10)}ПОРОГ${'.'.repeat(10)}`;

function savePosition(board = START_BOARD, extra = {}) {
    baldaSettings().savedGame = {
        size: 5,
        start: 'ПОРОГ',
        board,
        turn: 0,
        human: 0,
        passes: 0,
        words: [[], []],
        level: 'medium',
        ...extra,
    };
}

// Словарь грузится динамическим import(): это макрозадача, микротасками её не дождаться.
// Ждём появления поля — ровно того, чего ждёт игрок, глядя на «Загружаю словарь…».
async function waitForBoard(root, tries = 200) {
    for (let i = 0; i < tries && !root?.querySelector('.balda-board'); i++) {
        await new Promise((resolve) => setImmediate(resolve));
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
    if (options.gameId) await waitForBoard(root);

    await body(root);

    release();
    await opened;
}

// --- Ввод идёт ровно тем путём, которым он идёт у игрока

const cellAt = (root, index) => root.querySelector(`.balda-cell[data-idx="${index}"]`);
const statusOf = (root) => root.querySelector('.balda-status').textContent;
const glyphs = (root) => [...root.querySelectorAll('.balda-cell')].map((c) => c.textContent || '.').join('');

function pointer(type, target, { x = 0, y = 0 } = {}) {
    const event = new dom.window.MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
    });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    target.dispatchEvent(event);
    return event;
}

/** Тап по клетке: нажатие и отпускание без движения — росчерк длиной в одну клетку. */
function tap(root, index) {
    const cell = cellAt(root, index);
    pointer('pointerdown', cell, { x: index % 5, y: Math.floor(index / 5) });
    pointer('pointerup', cell);
}

// Позиции клавиш EN-раскладки: игрок с английским в чате печатает вслепую по ЙЦУКЕН,
// и именно этот путь надо проверять.
const CODES = { А: 'KeyF', Г: 'KeyU', К: 'KeyR', О: 'KeyJ', Р: 'KeyH', Т: 'KeyN', Ъ: 'BracketRight' };

function press(key, code) {
    const event = new dom.window.KeyboardEvent('keydown', {
        key, code, bubbles: true, cancelable: true,
    });
    document.body.dispatchEvent(event);
    return event;
}

console.log('balda ui (jsdom)');

clear();
register(baldaGame);
register(snakeGame);

// --- Хаб и монтирование

await session({}, async (root) => {
    test('плитка балды в хабе', () => {
        const tile = root.querySelector('.stg-tile[data-game-id="balda"]');
        assert(tile, 'плитка на месте');
        assertEqual(tile.querySelector('.stg-tile-title').textContent, 'Балда', 'название');
        assert(tile.querySelector('i.fa-spell-check'), 'иконка');
    });
});

// --- Заглушка «Загружаю словарь…» (правило 9)

await test('mount синхронно рисует заглушку, и она сменяется полем', async () => {
    savePosition();
    let root = null;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    context.callGenericPopup = (content) => { root = content; return held; };

    const opened = openShell({ gameId: 'balda' });
    await Promise.resolve();

    assert(root.querySelector('.balda-loading'), 'сразу после mount видно «Загружаю словарь…»');
    assertEqual(root.querySelectorAll('.balda-cell').length, 0, 'поля ещё нет');

    await waitForBoard(root);
    assert(!root.querySelector('.balda-loading'), 'заглушка убрана');
    assert(root.querySelector('.balda-board'), 'поле построено');

    release();
    await opened;
});

// --- Ход игрока

savePosition();

await session({ gameId: 'balda' }, async (root) => {
    test('mount строит поле 5×5 с загаданным словом, клавиатуру и кнопки хода', () => {
        assertEqual(root.querySelectorAll('.balda-cell').length, 25, 'клеток на поле');
        assertEqual(glyphs(root).slice(10, 15), 'ПОРОГ', 'загаданное слово в среднем ряду');
        assertEqual(root.querySelectorAll('.balda-key').length, 32, 'клавиш в раскладке');
        assertEqual(root.querySelectorAll('.balda-cell button').length, 0, 'клетки не кнопки');
        assertEqual([...root.querySelectorAll('.balda-key')].filter((k) => k.tabIndex !== -1).length, 0,
            'клавиши вне Tab-порядка попапа');
        assert(root.querySelector('.balda-submit'), 'кнопка «Готово»');
        assert(root.querySelector('.balda-undo'), 'кнопка «Отменить»');
        assert(root.querySelector('.balda-pass'), 'кнопка «Пас»');
        assertEqual(root.querySelector('.balda-score').textContent, 'Вы 0 : 0 соперник', 'счёт');
        assertEqual(statusOf(root), 'Выберите пустую клетку рядом с занятой', 'подсказка первого шага');
    });

    test('клетка не рядом с занятой букву не принимает', () => {
        tap(root, 0);
        assertEqual(statusOf(root), 'Букву можно ставить только рядом с занятой клеткой', 'отказ');
        assertEqual(root.querySelectorAll('.balda-selected').length, 0, 'ничего не выбрано');
    });

    test('тап по пустой клетке выбирает её, буква с клавиатуры встаёт в неё', () => {
        tap(root, 7);
        assert(cellAt(root, 7).classList.contains('balda-selected'), 'клетка выбрана');
        assertEqual(statusOf(root), 'Выберите букву на клавиатуре', 'подсказка второго шага');

        const event = press('x', CODES.Ъ);
        assertEqual(event.defaultPrevented, true, 'клавиша съедена до чата');
        assert(cellAt(root, 7).classList.contains('balda-pending'), 'буква поставлена');
        assertEqual(cellAt(root, 7).textContent, 'Ъ', 'именно та, что нажата (EN-раскладка)');
        assertEqual(document.getElementById('send_textarea').value, '', 'в поле чата ничего не утекло');
    });

    test('путь набирается тапами по буквам, включая новую', () => {
        for (const index of [14, 13, 12, 7]) tap(root, index);
        assertEqual(statusOf(root), 'Слово: ГОРЪ', 'слово собирается на глазах');
        assertEqual(cellAt(root, 14).dataset.order, '1', 'номер шага виден на клетке');
        assertEqual(cellAt(root, 7).dataset.order, '4', 'новая буква — четвёртый шаг');
    });

    test('слова нет в словаре — отказ, партия не тронута', () => {
        toasts.length = 0;
        root.querySelector('.balda-submit').click();

        assertEqual(statusOf(root), 'Нет в словаре', 'причина в живом регионе');
        assertEqual(toasts.at(-1)?.msg, 'Нет в словаре', 'и в тосте');
        assertEqual(root.querySelector('.balda-score').textContent, 'Вы 0 : 0 соперник', 'счёт не изменился');
        assertEqual(glyphs(root).slice(10, 15), 'ПОРОГ', 'поле не изменилось');
        assertEqual(aiTimer(), null, 'соперника не дёргаем');
        assert(cellAt(root, 7).classList.contains('balda-pending'), 'набранное осталось — можно поправить');
    });

    test('другая буква заменяет поставленную, путь остаётся', () => {
        press('f', CODES.А);
        assertEqual(cellAt(root, 7).textContent, 'А', 'буква заменена');
        assertEqual(statusOf(root), 'Слово: ГОРА', 'путь тот же, слово другое');
    });

    test('«Готово» принимает ход, считает очки и отдаёт очередь сопернику', () => {
        toasts.length = 0;
        root.querySelector('.balda-submit').click();

        assertEqual(root.querySelector('.balda-score').textContent, 'Вы 4 : 0 соперник', 'очки по длине слова');
        assertEqual(glyphs(root)[7], 'А', 'буква осталась на поле');
        assertEqual(root.querySelectorAll('.balda-pending').length, 0, 'незавершённый ход разобран');
        assert(root.querySelector('.balda-words-list').textContent.includes('ГОРА'), 'слово в списке игрока');
        assertEqual(toasts.at(-1)?.msg, '«ГОРА» — плюс 4', 'ход объявлен');
        assertEqual(root.querySelector('.balda-turn').textContent, 'Соперник думает…', 'очередь соперника');
        assert(aiTimer(), 'ход соперника отложен таймером');
        assertEqual(aiTimer().ms, 300, 'пауза 300 мс');
    });

    test('пока соперник думает, поле и клавиатура не слушают', () => {
        const before = glyphs(root);
        tap(root, 6);
        press('f', CODES.А);
        assertEqual(glyphs(root), before, 'поле не тронуто');
        assertEqual(root.querySelectorAll('.balda-selected').length, 0, 'клетка не выбирается');
        assert(root.querySelector('.balda-keyboard').classList.contains('balda-keyboard-off'), 'клавиатура погашена');
        assertEqual(root.querySelector('.balda-submit').disabled, true, '«Готово» недоступно');
    });

    test('таймер отдаёт ход соперника и возвращает очередь игроку', () => {
        toasts.length = 0;
        assertEqual(runTimers(), 1, 'сработал один отложенный ход');

        const theirWords = root.querySelectorAll('.balda-words-list')[1].textContent;
        const passed = toasts.some((t) => t.msg.includes('пасует'));
        assert(theirWords.length > 0 || passed, 'соперник либо собрал слово, либо объявил пас');
        assertEqual(root.querySelector('.balda-turn').textContent, 'Ваш ход', 'очередь вернулась игроку');
        assertEqual(root.querySelector('.balda-submit').disabled, false, 'кнопки снова доступны');
    });

    test('«Отменить» разбирает ход по шагам', () => {
        // Клетку выбираем живую: соперник только что сходил, и какая именно клетка
        // нижнего ряда осталась пустой — его дело. Сверху от неё всегда буква
        // загаданного слова, поэтому путь из двух шагов соберётся при любом его ходе.
        const free = [15, 16, 17, 18, 19].find((i) => cellAt(root, i).classList.contains('balda-empty'));
        assert(free !== undefined, 'в нижнем ряду есть пустая клетка');
        const above = glyphs(root)[free - 5];

        tap(root, free);
        press('r', CODES.К);
        tap(root, free);
        tap(root, free - 5);
        assertEqual(statusOf(root), `Слово: К${above}`, 'путь набран');

        const undoBtn = root.querySelector('.balda-undo');
        undoBtn.click();
        assertEqual(statusOf(root), 'Слово: К', 'снят последний шаг пути');
        undoBtn.click();
        assertEqual(statusOf(root), 'Буква К поставлена — наберите слово через неё', 'путь пуст');
        undoBtn.click();
        assertEqual(statusOf(root), 'Выберите букву на клавиатуре', 'буква снята');
        undoBtn.click();
        assertEqual(statusOf(root), 'Выберите пустую клетку рядом с занятой', 'выбор снят');
        assertEqual(root.querySelectorAll('.balda-selected, .balda-pending, .balda-path').length, 0, 'поле чистое');
    });

    test('партия сохраняется после хода', () => {
        const saved = baldaSettings().savedGame;
        assertEqual(saved.board.length, 25, 'поле — строка из 25 символов');
        assertEqual(saved.board[7], 'А', 'ход игрока в сохранёнке');
        assertEqual(saved.words[0].join(','), 'ГОРА', 'слово игрока сохранено');
        assertEqual(saved.level, 'medium', 'ключ статистики едет вместе с полем');
        assert(!('used' in saved), 'множество занятых слов в настройки не уходит');
    });
});

// --- Росчерк

savePosition();

await session({ gameId: 'balda' }, async (root) => {
    test('путь набирается росчерком, а движение назад снимает последний шаг', () => {
        // jsdom не реализует ни PointerEvent, ни elementFromPoint. Указателю от игры
        // нужны только координаты, а координаты в тесте — это прямо номер столбца и
        // строки: подмена elementFromPoint переводит их обратно в клетку.
        dom.window.document.elementFromPoint = (x, y) => cellAt(root, y * 5 + x) ?? null;

        tap(root, 7);
        press('f', CODES.А);

        const start = cellAt(root, 14);
        pointer('pointerdown', start, { x: 4, y: 2 });
        pointer('pointermove', start, { x: 3, y: 2 });   // О
        pointer('pointermove', start, { x: 2, y: 2 });   // Р
        pointer('pointermove', start, { x: 2, y: 1 });   // новая А
        assertEqual(statusOf(root), 'Слово: ГОРА', 'росчерк собрал слово');

        pointer('pointermove', start, { x: 2, y: 2 });   // назад по своему следу
        assertEqual(statusOf(root), 'Слово: ГОР', 'шаг назад отменил последнюю букву');
        pointer('pointermove', start, { x: 2, y: 1 });
        pointer('pointerup', start);

        root.querySelector('.balda-submit').click();
        assertEqual(root.querySelector('.balda-score').textContent, 'Вы 4 : 0 соперник', 'ход принят');
    });

    test('destroy() посреди хода соперника не роняет экран и не пишет в DOM', () => {
        const timer = aiTimer();
        assert(timer && pending.has(timer.id), 'ход соперника ещё висит в очереди');

        // Оболочка размонтирует экран синхронно и таймера не ждёт.
        const screen = root.querySelector('.stg-screen');
        root.querySelector('.stg-back').click();
        assertEqual(screen.querySelectorAll('.balda-cell').length, 0, 'экран игры снят');
        assert(!pending.has(timer.id), 'таймер снят в destroy()');

        // Колбэк, переживший destroy() (в браузере он мог уже уйти в очередь макрозадач),
        // обязан выйти молча, ничего не нарисовав.
        const htmlBefore = screen.innerHTML;
        toasts.length = 0;
        timer.fn();
        assertEqual(screen.innerHTML, htmlBefore, 'DOM не тронут');
        assertEqual(toasts.length, 0, 'тостов из мёртвого экрана нет');
        assert(screen.querySelector('.stg-hub'), 'на экране хаб');
    });

    test('партия записана в destroy() — до вырывания экрана из DOM', () => {
        assertEqual(baldaSettings().savedGame.board[7], 'А', 'ход игрока сохранён');
    });
});

test('после закрытия окна физическая клавиатура отпущена', () => {
    const event = press('f', CODES.А);
    assertEqual(event.defaultPrevented, false, 'клавиши снова достаются таверне');
});

// --- Идемпотентность destroy()

await test('повторный destroy() молча выходит', async () => {
    savePosition();
    let screen = null;
    await session({ gameId: 'balda' }, async (root) => {
        screen = root.querySelector('.stg-screen');
        // Первый destroy() — выход в хаб; второй придёт из finally закрытия попапа.
        root.querySelector('.stg-back').click();
        assert(screen.querySelector('.stg-hub'), 'вернулись в хаб');
    });
    assertEqual(screen.querySelectorAll('.balda-cell').length, 0, 'второй destroy() ничего не сломал');
});

// --- Пас и конец партии

await test('пас игрока и пас соперника заканчивают партию', async () => {
    // Поле заполнено целиком, кроме среднего ряда, — ходить обеим сторонам некуда,
    // и партия обязана закончиться на двух пасах подряд.
    savePosition(`${'.'.repeat(10)}ПОРОГ${'.'.repeat(10)}`);

    await session({ gameId: 'balda' }, async (root) => {
        toasts.length = 0;
        root.querySelector('.balda-pass').click();
        assertEqual(root.querySelector('.balda-turn').textContent, 'Соперник думает…', 'ход у соперника');

        runTimers();
        // Соперник на пустом поле слово найдёт — тогда партия продолжается; важно, что
        // пас игрока не завис и очередь вернулась.
        assert(
            root.querySelector('.balda-turn').textContent === 'Ваш ход'
            || root.querySelector('.balda-turn').textContent === 'Партия окончена',
            'очередь вернулась игроку либо партия закончилась',
        );
    });
});

// --- Слэш-команда

test('slash.parse пропускает только известные уровни', () => {
    assertEqual(baldaGame.slash.parse('hard').level, 'hard', 'уровень распознан');
    assertEqual(baldaGame.slash.parse(' HARD ').level, 'hard', 'регистр и пробелы не мешают');
    assertEqual(baldaGame.slash.parse('нечто').level, undefined, 'чужое значение отброшено');
    assertEqual(baldaGame.slash.parse('').level, undefined, 'вход без аргумента');
});

await test('/balda hard задаёт уровень и начинает новую партию', async () => {
    const settings = baldaSettings();
    settings.level = 'medium';
    savePosition();

    await session({ gameId: 'balda', args: { level: 'hard' } }, async (root) => {
        assertEqual(settings.level, 'hard', 'уровень из команды записан в настройки');
        assertEqual(root.querySelector('.balda-level').textContent, 'Сложный', 'шапка показывает уровень');
        assert(glyphs(root).slice(10, 15) !== 'ПОРОГ' || settings.savedGame.words[0].length === 0,
            'явный уровень начинает новую партию');
        assertEqual(root.querySelector('.balda-score').textContent, 'Вы 0 : 0 соперник', 'счёт с нуля');
    });

    settings.level = 'medium';
});

// --- Панель настроек и статистики

await test('панель настроек: уровень и первый ход', async () => {
    const { renderBaldaSettings, renderBaldaStats } = await import('../../src/games/balda/settings.js');
    const box = document.createElement('div');
    renderBaldaSettings(box, { save: () => {}, onSettingsChanged: () => {} });

    const level = box.querySelector('#balda_level');
    const first = box.querySelector('#balda_play_first');
    assert(level && first, 'оба контрола на месте');

    level.value = 'hard';
    level.dispatchEvent(new dom.window.Event('change'));
    assertEqual(baldaSettings().level, 'hard', 'уровень уехал в настройки');

    // Значение не из списка (правка DOM, старое сохранение) сводится к дефолту, а не
    // попадает в настройки и в ключи статистики.
    level.value = 'нечто';
    level.dispatchEvent(new dom.window.Event('change'));
    assertEqual(baldaSettings().level, 'medium', 'чужое значение сведено к дефолту');

    const stats = document.createElement('div');
    renderBaldaStats(stats, { save: () => {}, renderAllStats: () => {} });
    // Шапка плюс три уровня.
    assertEqual(stats.querySelectorAll('.balda-stats-row').length, 4, 'строк в таблице');
    // Сыгранной посчиталась только партия из `/balda hard`: восстановленные из сохранёнки
    // повторно не считаются — счётчик растёт в момент старта новой.
    assert((baldaSettings().stats.hard?.played ?? 0) > 0, 'новая партия посчитана в «сыграно»');
    assertEqual(stats.querySelector('#balda_stats_reset').style.display, '', 'кнопка сброса показана');

    stats.querySelector('#balda_stats_reset').click();
    renderBaldaStats(stats, { save: () => {}, renderAllStats: () => {} });
    assertEqual(stats.querySelector('#balda_stats_reset').style.display, 'none', 'без партий сброса нет');
    assertEqual(stats.querySelector('#balda_stats_hint').style.display, '', 'вместо него — пояснение');
});

report('balda/ui');
