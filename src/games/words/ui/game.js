// Экран «Слов». Оболочка (src/shell/modal.js) создаёт контейнер root и зовёт
// createWordsScreen(root, api); про попап и SillyTavern этот модуль ничего не знает.
//
// Особенность игры — асинхронный старт: словари весят под четверть мегабайта и грузятся
// динамическим import() при первом открытии, а не приезжают с каждой загрузкой таверны.
// mount() при этом остаётся СИНХРОННЫМ (контракт реестра), поэтому окно сразу показывает
// «загружаю…», а отложенный колбэк первой строкой проверяет, жив ли ещё экран, — правило 7
// из docs/games.md. Второй отложенный участок — раскрытие строки: результат партии
// объявляется после переворота плиток, и этот таймер тоже обязан пережить destroy().

import { logError } from '../../../log.js';
import { createDictionary } from '../core/dictionary.js';
import {
    MAX_ATTEMPTS, PLAYING, WON, WORD_LENGTH,
    createGame, deserialize, marks as guessMarks, serialize, submitGuess, surrender,
    winningAttempt,
} from '../core/engine.js';
import { keyboardState } from '../core/mark.js';
import { recordPlayed, recordResult } from '../core/stats.js';
import { createToaster, describeRejection, markInvalid } from './feedback.js';
import { createGrid, describeRow, revealDuration } from './grid.js';
import { attachKeyboard, createKeyboard } from './keyboard.js';

// Словари грузятся один раз на сессию: import() кэширует модуль сам, а createDictionary
// разворачивает 24 тысячи слов в Set — повторять это на каждое открытие окна незачем.
let dictionaryPromise = null;

function loadDictionary() {
    if (!dictionaryPromise) {
        dictionaryPromise = Promise.all([
            import('../data/answers.js'),
            import('../data/allowed.js'),
        ])
            .then(([answers, allowed]) => createDictionary(answers.default, allowed.default))
            .catch((err) => {
                // Неудачную загрузку не кэшируем: следующее открытие окна должно пробовать снова.
                dictionaryPromise = null;
                throw err;
            });
    }
    return dictionaryPromise;
}

export function createWordsScreen(root, api) {
    root.innerHTML = '';

    const screen = document.createElement('div');
    screen.className = 'words-root';
    screen.tabIndex = -1;
    root.appendChild(screen);

    const loading = document.createElement('div');
    loading.className = 'words-loading';
    loading.textContent = 'Загружаю словарь…';
    screen.appendChild(loading);

    let destroyed = false;
    let live = null;

    loadDictionary().then((dictionary) => {
        // Оболочка размонтирует игру синхронно и загрузку не ждёт: за это время окно
        // могло закрыться или уйти в хаб.
        if (destroyed) return;
        loading.remove();
        try {
            live = buildScreen(screen, api, dictionary);
        } catch (err) {
            logError('не удалось построить экран «Слов»', err);
            screen.textContent = 'Игра не открылась';
        }
    }).catch((err) => {
        if (destroyed) return;
        logError('не удалось загрузить словарь «Слов»', err);
        loading.textContent = 'Не удалось загрузить словарь';
    });

    return {
        destroy() {
            // Идемпотентен: оболочка зовёт destroy() и при выходе в хаб, и в finally
            // закрытия попапа.
            if (destroyed) return;
            destroyed = true;
            live?.destroy();
            live = null;
            root.innerHTML = '';
        },
        refresh() {
            if (destroyed) return;
            live?.refresh();
        },
    };
}

function buildScreen(screen, api, dictionary) {
    const settings = api.settings;

    // --- Разметка

    const header = document.createElement('div');
    header.className = 'words-header';

    const attemptsEl = document.createElement('span');
    attemptsEl.className = 'words-attempts';
    const modeEl = document.createElement('span');
    modeEl.className = 'words-mode';

    const info = document.createElement('div');
    info.className = 'words-info';
    info.append(attemptsEl, modeEl);

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'words-btn menu_button';

    header.append(info, actionBtn);

    const grid = createGrid({ length: WORD_LENGTH, maxAttempts: MAX_ATTEMPTS });

    // ОДИН живой регион на всё: расшифровка подтверждённой строки, отказы и результат.
    // Живой регион на каждой строке заспамил бы скринридер.
    const status = document.createElement('div');
    status.className = 'words-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const keyboard = createKeyboard({
        onLetter: (letter) => typeLetter(letter),
        onEnter: () => submit(),
        onBackspace: () => erase(),
    });

    screen.append(header, grid.root, status, keyboard.root);

    // --- Состояние экрана

    let destroyed = false;
    let current = '';
    let revealRow = null;
    let revealTimer = null;
    let cancelShake = null;
    // Результат пишется в статистику строго один раз за партию: сюда приходят и конец
    // партии по догадке, и капитуляция.
    let recorded = false;

    const toaster = createToaster((message) => notify(message));

    let state = restoreGame();
    const restored = Boolean(state);
    // Новая партия рисует себя сама (и считается в «сыграно»); восстановленная
    // отрисовывается ниже, когда экран уже связан со слушателями.
    if (!state) state = startGame();

    // --- Ввод
    //
    // Тап по экранной клавише и физическая клавиша приходят сюда через одни и те же
    // три функции (см. ui/keyboard.js): две ветки с одинаковыми правилами разъехались бы
    // на первой же правке.

    function typeLetter(letter) {
        if (destroyed || state.status !== PLAYING) return;
        if (current.length >= state.length) return;
        current += letter;
        render();
    }

    function erase() {
        if (destroyed || state.status !== PLAYING) return;
        if (!current) return;
        current = current.slice(0, -1);
        render();
    }

    function submit() {
        if (destroyed || state.status !== PLAYING) return;

        const guess = current;
        const result = submitGuess(state, guess, dictionary);
        if (!result.ok) {
            reject(result);
            return;
        }

        current = '';
        revealRow = state.guesses.length - 1;
        render();
        persist();
        // Расшифровку строки говорим сразу, не дожидаясь анимации: скринридеру
        // перевороты плиток безразличны, а ждать секунду ради них — обидно.
        announce(describeRow(guess, result.marks));

        if (state.status === PLAYING) return;

        // Итог — после раскрытия строки: тост поверх ещё не перевёрнутых плиток
        // сообщает результат раньше, чем игрок его увидел.
        clearReveal();
        revealTimer = setTimeout(() => {
            revealTimer = null;
            if (destroyed) return;
            finish();
        }, revealDuration(state.length));
    }

    // Невалидная догадка не меняет партию вообще (см. core/engine.js): строка трясётся,
    // попытка не тратится. Повтор одного и того же тоста глушится на секунду — иначе
    // долбёжка Enter заспамит экран.
    function reject(result) {
        const message = describeRejection(result);
        cancelShake?.();
        cancelShake = markInvalid(grid.rowAt(state.guesses.length));
        toaster(message);
        announce(message);
    }

    // --- Партия

    function finish() {
        const won = state.status === WON;
        const text = won
            ? `Угадано с ${state.guesses.length}-й попытки!`
            : `Слово: ${state.secret}`;
        announce(text);
        notify(text, won ? 'success' : 'info');
        record();
    }

    function startGame() {
        const secret = dictionary.pick();
        if (!secret) {
            // Пустой словарь — не партия: без слова игре нечего загадывать.
            throw new Error('словарь пуст');
        }
        // hardMode считывается ровно здесь и дальше живёт в партии: переключатель
        // посреди игры иначе менял бы сложность внутри одной строки статистики.
        state = createGame({ secret, hardMode: settings.hardMode === true });
        current = '';
        revealRow = null;
        recorded = false;
        clearReveal();
        cancelShake?.();
        cancelShake = null;
        // «Сыграно» растёт в момент старта партии, а не в её конце: брошенные партии
        // иначе нигде бы не отражались.
        countPlayed();
        persist();
        render();
        return state;
    }

    // Намеренный выход отличим от «закрыл окно, потому что пришло сообщение в чат»:
    // капитуляция раскрывает слово, пишет поражение и обнуляет серию, закрытие окна —
    // нет (правило 8 в docs/games.md).
    function surrenderGame() {
        if (state.status !== PLAYING) return;
        surrender(state);
        current = '';
        clearReveal();
        render();
        persist();
        const text = `Слово: ${state.secret}`;
        announce(text);
        notify(text);
        record();
    }

    // --- Отрисовка

    function render() {
        grid.render({
            guesses: state.guesses,
            marks: guessMarks(state),
            current,
            revealRow,
        });
        keyboard.render(keyboardState(state.secret, state.guesses));

        attemptsEl.textContent = state.status === PLAYING
            ? `Попытка ${state.guesses.length + 1} из ${state.maxAttempts}`
            : 'Партия окончена';
        // Режим показывается по ПАРТИИ, а не по настройке: переключённая посреди игры
        // галка применится только к следующему слову.
        modeEl.textContent = state.hardMode ? 'Жёсткий режим' : '';
        // Пока партия идёт, кнопка называется «Сдаться»; «Новое слово» появляется
        // только после конца партии.
        actionBtn.textContent = state.status === PLAYING ? 'Сдаться' : 'Новое слово';

        screen.classList.toggle('words-colorblind', settings.colorBlind === true);
    }

    function announce(text) {
        status.textContent = text;
    }

    function notify(message, kind = 'info') {
        try {
            api.toast(kind, message);
        } catch (err) {
            logError('не удалось показать уведомление', err);
        }
    }

    // --- Сохранение
    //
    // Пишем после каждой догадки и при закрытии окна. Доигранная партия не хранится:
    // открывать окно с законченным словом бессмысленно, игрок ждёт новое.

    function persist() {
        try {
            settings.savedGame = state.status === PLAYING ? serialize(state) : null;
            save();
        } catch (err) {
            logError('не удалось сохранить партию «Слов»', err);
        }
    }

    function restoreGame() {
        try {
            const saved = deserialize(settings.savedGame);
            if (!saved || saved.status !== PLAYING) return null;
            return saved;
        } catch (err) {
            logError('не удалось восстановить партию «Слов»', err);
            return null;
        }
    }

    // --- Статистика
    //
    // Побочная запись, а не ход: если она упадёт, партия должна продолжаться как ни в
    // чём не бывало.

    function countPlayed() {
        try {
            recordPlayed(settings.stats);
            save();
            api.renderAllStats?.();
        } catch (err) {
            logError('не удалось обновить статистику «Слов»', err);
        }
    }

    function record() {
        if (recorded) return;
        recorded = true;
        try {
            const { streakRecord } = recordResult(settings.stats, winningAttempt(state));
            save();
            api.renderAllStats?.();
            if (streakRecord) notify(`Новая рекордная серия: ${settings.stats.maxStreak}`, 'success');
        } catch (err) {
            logError('не удалось записать результат партии «Слов»', err);
        }
    }

    function save() {
        try {
            api.save();
        } catch (err) {
            logError('не удалось сохранить настройки «Слов»', err);
        }
    }

    function clearReveal() {
        if (revealTimer !== null) {
            clearTimeout(revealTimer);
            revealTimer = null;
        }
    }

    // --- Связки

    const physical = attachKeyboard({
        onLetter: typeLetter,
        onEnter: submit,
        onBackspace: erase,
    });

    actionBtn.addEventListener('click', () => {
        actionBtn.blur();
        if (state.status === PLAYING) surrenderGame();
        else startGame();
    });

    // Восстановленная партия повторно не считается — она уже посчитана там, где началась.
    if (restored) render();

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            clearReveal();
            cancelShake?.();
            cancelShake = null;
            physical.destroy();
            keyboard.destroy();
            // Сохранение — до вырывания экрана из DOM: закрытие попапа не должно стоить
            // игроку партии, а другого шанса записать её у игры не будет.
            persist();
        },
        // Единственный канал «настройки изменились»: режим дальтоника читается при
        // каждой отрисовке, но без пинка ждал бы следующей буквы.
        refresh() {
            if (destroyed) return;
            render();
        },
    };
}
