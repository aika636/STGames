// Тесты экрана «Слов» под jsdom (Фаза 9.5): монтирование через оболочку с асинхронной
// загрузкой словаря, набор с физической клавиатуры, отказ и подтверждение догадки,
// сохранение партии между сессиями, destroy() посреди раскрытия строки и панель настроек.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/words/ui.test.mjs

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

// Раскрытие строки откладывается через setTimeout. Настоящие таймеры сделали бы тест
// плавающим, поэтому очередь своя: pending — то, что ещё не сработало, scheduled — все
// когда-либо поставленные колбэки (нужны, чтобы выстрелить таймером уже после destroy()).
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

// Таймеры оболочки (фокус, 0 мс) не трогаем — нас интересует только раскрытие строки.
function revealTimer() {
    return scheduled.filter((t) => t.ms >= 1).at(-1) ?? null;
}

function runTimers(minMs = 1) {
    const due = scheduled.filter((t) => t.ms >= minMs && pending.has(t.id));
    for (const timer of due) {
        pending.delete(timer.id);
        timer.fn();
    }
    return due.length;
}

const { clear, register } = await import('../../src/registry.js');
const wordsGame = (await import('../../src/games/words/index.js')).default;
const snakeGame = (await import('../../src/games/snake/index.js')).default;
const { openShell } = await import('../../src/shell/modal.js');
const { getGameSettings } = await import('../../src/settings.js');

// Словарь грузится динамическим import(): это макрозадача, микротасками её не дождаться.
// Ждём появления сетки — ровно то, чего ждёт игрок, глядя на «загружаю…».
async function waitForGrid(root, tries = 50) {
    for (let i = 0; i < tries && !root?.querySelector('.words-grid'); i++) {
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
    if (options.gameId) await waitForGrid(root);

    await body(root);

    release();
    await opened;
}

function wordsSettings() {
    return getGameSettings('words', wordsGame.defaults);
}

// Ввод идёт ровно тем путём, которым он идёт у игрока: событие на document, а не вызов
// внутренней функции экрана.
const CODES = { А: 'KeyF', Б: 'Comma', В: 'KeyD', Г: 'KeyU', Е: 'KeyT', К: 'KeyR', Н: 'KeyY', О: 'KeyJ', П: 'KeyG', Р: 'KeyH', Т: 'KeyN' };

function press(key, code) {
    const event = new dom.window.KeyboardEvent('keydown', {
        key, code, bubbles: true, cancelable: true,
    });
    document.body.dispatchEvent(event);
    return event;
}

// Печатаем с EN-раскладки: именно она приходит к игроку, у которого в чате английский.
function type(word) {
    for (const letter of word) press('x', CODES[letter]);
}

const tiles = (root, rowIndex) => [...root.querySelectorAll('.words-row')[rowIndex].querySelectorAll('.words-tile')];
const rowText = (root, rowIndex) => tiles(root, rowIndex).map((t) => t.textContent).join('');
const statusOf = (root) => root.querySelector('.words-status').textContent;

console.log('words ui (jsdom)');

clear();
register(wordsGame);
register(snakeGame);

// --- Хаб и монтирование

await session({}, async (root) => {
    test('плитка «Слов» в хабе', () => {
        const tile = root.querySelector('.stg-tile[data-game-id="words"]');
        assert(tile, 'плитка на месте');
        assertEqual(tile.querySelector('.stg-tile-title').textContent, 'Слова', 'название');
        assert(tile.querySelector('i.fa-font'), 'иконка');
    });
});

// Партию задаём через сохранёнку: загаданное слово в тесте должно быть известным,
// иначе проверять раскраску не на чем.
wordsSettings().savedGame = { secret: 'ПОРОГ', guesses: [], hardMode: false, length: 5, maxAttempts: 6 };

await session({ gameId: 'words' }, async (root) => {
    test('mount строит поле 6×5, клавиатуру, шапку и живой регион', () => {
        assertEqual(root.querySelectorAll('.words-row').length, 6, 'строк');
        assertEqual(root.querySelectorAll('.words-tile').length, 30, 'плиток');
        assertEqual(root.querySelectorAll('.words-key').length, 34, 'клавиш');
        assertEqual(root.querySelector('.words-attempts').textContent, 'Попытка 1 из 6');
        assertEqual(root.querySelector('.words-btn').textContent, 'Сдаться', 'идёт партия');
        assertEqual(root.querySelector('.words-status').getAttribute('aria-live'), 'polite');
        assert(!root.querySelector('.words-loading'), '«загружаю» убрано');
        assertEqual(root.querySelectorAll('.words-tile button').length, 0, 'плитки не кнопки');
    });

    test('буквы с EN-раскладки попадают в строку и не уходят в чат', () => {
        const event = press('n', 'KeyN');
        assertEqual(event.defaultPrevented, true, 'клавиша съедена до чата');
        assertEqual(rowText(root, 0), 'Т', 'KeyN дала Т');

        type('РАВА');
        assertEqual(rowText(root, 0), 'ТРАВА');
        assertEqual(document.getElementById('send_textarea').value, '', 'в поле чата ничего не утекло');
    });

    test('шестая буква не влезает, Backspace стирает последнюю', () => {
        type('К');
        assertEqual(rowText(root, 0), 'ТРАВА', 'строка не длиннее пяти');
        press('Backspace', 'Backspace');
        assertEqual(rowText(root, 0), 'ТРАВ');
        type('А');
    });

    test('слова нет в словаре — строка трясётся, попытка не тратится', () => {
        toasts.length = 0;
        press('Backspace', 'Backspace');
        type('Б');
        press('Enter', 'Enter');

        const row = root.querySelectorAll('.words-row')[0];
        assert(row.classList.contains('words-invalid'), 'строка помечена отказом');
        assertEqual(root.querySelector('.words-attempts').textContent, 'Попытка 1 из 6', 'попытка на месте');
        assertEqual(statusOf(root), 'Нет в словаре', 'причина в живом регионе');
        assertEqual(toasts.at(-1)?.msg, 'Нет в словаре', 'и в тосте');

        press('Backspace', 'Backspace');
        type('А');
    });

    test('повтор того же отказа тост не дублирует', () => {
        // Другой текст отказа, а не «нет в словаре» из прошлого теста: глушилка
        // сравнивает сообщения, и повтором она сочла бы их оба.
        press('Backspace', 'Backspace');
        toasts.length = 0;
        press('Enter', 'Enter');
        press('Enter', 'Enter');
        assertEqual(toasts.map((t) => t.msg).join('|'), 'Мало букв', 'второй тост подряд заглушен');
        type('А');
    });

    test('догадка раскрашивается как мультимножество и красит клавиатуру', () => {
        press('Enter', 'Enter');

        // ТРАВА против ПОРОГ: Р есть, остальное — нет.
        const states = tiles(root, 0).map((t) => t.dataset.state);
        assertEqual(states.join(','), 'absent,present,absent,absent,absent');
        assertEqual(root.querySelector('.words-attempts').textContent, 'Попытка 2 из 6');
        assert(statusOf(root).startsWith('Т — нет в слове, Р — есть в слове'), 'строка расшифрована');

        const keyR = root.querySelector('.words-key[data-key="Р"]');
        assert(keyR.classList.contains('words-key-present'), 'Р на клавиатуре жёлтая');
        assertEqual(keyR.getAttribute('aria-label'), 'Р, есть в слове');
        assert(root.querySelector('.words-key[data-key="Т"]').classList.contains('words-key-absent'), 'Т серая');
    });

    test('партия сохранена без раскраски и состояния клавиатуры', () => {
        const saved = wordsSettings().savedGame;
        assertEqual(saved.secret, 'ПОРОГ');
        assertEqual(saved.guesses.join(''), 'ТРАВА');
        assertEqual(Object.keys(saved).sort().join(','), 'guesses,hardMode,length,maxAttempts,secret');
    });

    test('тап по экранной клавише работает наравне с физической', () => {
        root.querySelector('.words-key[data-key="К"]').click();
        assertEqual(rowText(root, 1), 'К');
        root.querySelector('.words-key[data-key="backspace"]').click();
        assertEqual(rowText(root, 1), '');
    });
});

// --- Сохранение между сессиями

await session({ gameId: 'words' }, async (root) => {
    test('партия переживает переоткрытие окна', () => {
        assertEqual(rowText(root, 0), 'ТРАВА', 'догадка на месте');
        assertEqual(tiles(root, 0)[1].dataset.state, 'present', 'раскраска пересчитана, а не восстановлена');
        assertEqual(root.querySelector('.words-attempts').textContent, 'Попытка 2 из 6');
    });

    test('восстановленная партия повторно не считается сыгранной', () => {
        // Партия пришла из сохранёнки, поэтому «сыграно» не росло ни разу: счётчик
        // растёт в момент старта новой партии, а не при каждом открытии окна.
        assertEqual(wordsSettings().stats.played ?? 0, 0, '«сыграно» не выросло');
    });
});

// --- Битое сохранение

wordsSettings().savedGame = { secret: 'ЭЭ', guesses: ['ммм'] };

await session({ gameId: 'words' }, async (root) => {
    test('битое сохранение выбрасывается, партия начинается заново', () => {
        assertEqual(rowText(root, 0), '', 'поле чистое');
        assertEqual(wordsSettings().savedGame.secret.length, 5, 'загадано новое слово');
        assertEqual(wordsSettings().stats.played, 1, 'новая партия посчитана');
    });
});

// --- Победа и destroy() посреди раскрытия

wordsSettings().savedGame = { secret: 'ПОРОГ', guesses: [], hardMode: false, length: 5, maxAttempts: 6 };

await session({ gameId: 'words' }, async (root) => {
    test('итог партии объявляется после раскрытия строки, а не поверх неё', () => {
        toasts.length = 0;
        type('ПОРОГ');
        press('Enter', 'Enter');

        assert(root.querySelectorAll('.words-row')[0].classList.contains('words-row-reveal'), 'строка раскрывается');
        assertEqual(toasts.length, 0, 'до конца анимации о победе не сообщают');
        assert(revealTimer(), 'итог отложен таймером');
        assertEqual(root.querySelector('.words-btn').textContent, 'Новое слово', 'кнопка сменилась сразу');

        runTimers();
        assertEqual(toasts.at(-1)?.kind, 'success', 'победа объявлена');
        assertEqual(wordsSettings().stats.wins, 1, 'победа записана');
        assertEqual(wordsSettings().stats.distribution[0], 1, 'с первой попытки');
        assertEqual(wordsSettings().savedGame, null, 'доигранная партия не хранится');
    });
});

wordsSettings().savedGame = { secret: 'ПОРОГ', guesses: [], hardMode: false, length: 5, maxAttempts: 6 };

await session({ gameId: 'words' }, async (root) => {
    test('destroy() посреди раскрытия: таймер не пишет ни в DOM, ни в статистику', () => {
        type('ПОРОГ');
        press('Enter', 'Enter');
        assert(revealTimer(), 'таймер поставлен');
    });
    // Окно закрывается прямо сейчас — release() ниже размонтирует экран.
});

test('колбэк раскрытия после destroy() ничего не записал', () => {
    toasts.length = 0;
    const winsBefore = wordsSettings().stats.wins;
    // Браузер выстрелит колбэком, уже ушедшим в очередь макрозадач до clearTimeout.
    for (const timer of scheduled.filter((t) => t.ms >= 1)) timer.fn();
    assertEqual(toasts.length, 0, 'тостов из мёртвого экрана нет');
    assertEqual(wordsSettings().stats.wins, winsBefore, 'статистика не тронута');
});

test('после закрытия окна физическая клавиатура отпущена', () => {
    const event = press('n', 'KeyN');
    assertEqual(event.defaultPrevented, false, 'клавиши снова достаются таверне');
});

// --- Капитуляция и новое слово

wordsSettings().savedGame = { secret: 'ПОРОГ', guesses: [], hardMode: false, length: 5, maxAttempts: 6 };

await session({ gameId: 'words' }, async (root) => {
    test('«Сдаться» раскрывает слово, пишет поражение и обнуляет серию', () => {
        toasts.length = 0;
        const playedBefore = wordsSettings().stats.played;
        root.querySelector('.words-btn').click();

        assertEqual(statusOf(root), 'Слово: ПОРОГ', 'слово раскрыто');
        assertEqual(wordsSettings().stats.losses, 1, 'поражение записано');
        assertEqual(wordsSettings().stats.currentStreak, 0, 'серия обнулена');
        assertEqual(wordsSettings().stats.played, playedBefore, 'капитуляция не добавляет партию');
        assertEqual(wordsSettings().savedGame, null, 'доигранная партия не хранится');
        assertEqual(root.querySelector('.words-btn').textContent, 'Новое слово');
    });

    test('«Новое слово» начинает партию и считает её сыгранной', () => {
        const playedBefore = wordsSettings().stats.played;
        root.querySelector('.words-btn').click();

        assertEqual(root.querySelector('.words-attempts').textContent, 'Попытка 1 из 6');
        assertEqual(root.querySelector('.words-btn').textContent, 'Сдаться');
        assertEqual(wordsSettings().stats.played, playedBefore + 1, 'новая партия посчитана');
        assertEqual(wordsSettings().savedGame.guesses.length, 0, 'партия сохранена пустой');
    });
});

// --- Панель настроек и статистики

await test('панель настроек: два переключателя с подписями', async () => {
    const { renderWordsSettings, renderWordsStats } = await import('../../src/games/words/settings.js');
    const box = document.createElement('div');
    renderWordsSettings(box, { save: () => {}, onSettingsChanged: () => {} });

    assert(box.querySelector('#words_hard_mode'), 'жёсткий режим');
    assert(box.querySelector('#words_color_blind'), 'режим для дальтоников');
    assertEqual(box.querySelectorAll('.words-settings-hint').length, 2, 'подписи у обоих');

    // Не click(): input лежит внутри <label for>, и jsdom прогоняет активацию метки
    // вторым кругом, переключая галку обратно.
    const hard = box.querySelector('#words_hard_mode');
    hard.checked = true;
    hard.dispatchEvent(new dom.window.Event('change'));
    assertEqual(wordsSettings().hardMode, true, 'галка пишется в настройки');
    hard.checked = false;
    hard.dispatchEvent(new dom.window.Event('change'));

    const stats = document.createElement('div');
    renderWordsStats(stats, { save: () => {}, renderAllStats: () => {} });
    assertEqual(stats.querySelectorAll('.words-stats-bar').length, 7, 'шесть попыток плюс поражения');
    assertEqual(stats.querySelectorAll('.words-stats-metric').length, 4, 'сводка');
    assertEqual(stats.querySelector('#words_stats_hint').style.display, 'none', 'при сыгранных партиях пояснение скрыто');
    assertEqual(stats.querySelector('#words_stats_reset').style.display, '', 'кнопка сброса показана');
});

report('words/ui');
