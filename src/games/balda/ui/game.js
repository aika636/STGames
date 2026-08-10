// Экран балды. Оболочка (src/shell/modal.js) создаёт контейнер root и зовёт
// createBaldaScreen(root, api); про попап и SillyTavern этот модуль ничего не знает.
//
// Здесь сходятся две особенности игры.
//
// 1. Асинхронный старт. Словарь существительных весит треть мегабайта и грузится
//    динамическим import() при первом открытии, а не приезжает с каждой загрузкой
//    таверны; из него ещё строится бор (несколько десятков миллисекунд). mount() при
//    этом остаётся СИНХРОННЫМ по контракту реестра: окно сразу показывает «Загружаю
//    словарь…», а отложенный колбэк первой строкой проверяет, жив ли экран (правило 9
//    и правило 7 из docs/games.md).
//
// 2. Ход соперника. Считается синхронно, но откладывается на THINK_MS через setTimeout —
//    без паузы свой ход и ответ сливаются в один кадр. Между постановкой таймера и его
//    срабатыванием игрок может закрыть окно, поэтому два флага: destroyed (колбэк выходит,
//    ничего не рисуя) и thinking (поле смотрит, но не слушает).
//
// Ход игрока набирается в двух шагах и живёт в трёх переменных экрана: selected — пустая
// клетка под новую букву, pendingLetter — сама буква, path — набранный путь. Пока ход не
// подтверждён, состояние партии не трогается вовсе: движок узнаёт о ходе один раз,
// в applyMove().

import { logError } from '../../../log.js';
import {
    BAD_CELL, BAD_LETTER, BAD_PATH, CELL_TAKEN, DEFAULT_SIZE, FIRST, GAME_OVER,
    NOT_ADJACENT, NOT_IN_DICTIONARY, PATH_MISSES_LETTER, SECOND, TOO_SHORT, WORD_USED,
    applyMove, createGame, deserialize, isPlayable, letterAt, neighbourTable, pass,
    scoreOf, serialize, winner,
} from '../core/engine.js';
import { chooseMove, mulberry32 } from '../core/ai.js';
import { createDictionary } from '../core/dictionary.js';
import { DRAW, LOSS, WIN, recordPlayed, recordResult } from '../core/stats.js';
import { LEVEL_LABELS, normalizeLevel, normalizeStart } from '../settings.js';
import { createBoard } from './board.js';
import { attachKeyboard, createKeyboard } from './keyboard.js';

// Минимальная пауза перед ходом соперника — столько же, сколько в реверси. Сам расчёт
// укладывается в единицы миллисекунд, пауза нужна глазу, а не перебору.
const THINK_MS = 300;

// Словарь грузится один раз на сессию: import() кэширует модуль сам, а бор из двадцати
// тысяч слов незачем строить на каждое открытие окна.
let dictionaryPromise = null;

function loadDictionary() {
    if (!dictionaryPromise) {
        dictionaryPromise = import('../data/words.js')
            .then((module) => createDictionary(module.default))
            .catch((err) => {
                // Неудачную загрузку не кэшируем: следующее открытие окна должно
                // пробовать снова, иначе одна осечка ломает игру до перезагрузки страницы.
                dictionaryPromise = null;
                throw err;
            });
    }
    return dictionaryPromise;
}

// Слова, которыми можно загадать средний ряд. Отбираются один раз на размер поля:
// словарь неизменен, а фильтровать двадцать тысяч слов на каждую партию незачем.
const startWordCache = new Map();

function startWords(dictionary, size) {
    let list = startWordCache.get(size);
    if (!list) {
        list = dictionary.words().filter((word) => word.length === size);
        startWordCache.set(size, list);
    }
    return list;
}

// Коды отказа из ядра — в человеческие формулировки. Ядро языка интерфейса не знает
// (тот же приём, что в «Словах»), поэтому таблица живёт здесь.
const REASON_TEXT = Object.freeze({
    [GAME_OVER]: 'Партия окончена',
    [BAD_CELL]: 'Такой клетки на поле нет',
    [CELL_TAKEN]: 'Клетка уже занята',
    [NOT_ADJACENT]: 'Букву можно ставить только рядом с занятой клеткой',
    [BAD_LETTER]: 'Сначала выберите букву',
    [TOO_SHORT]: 'Слово короче двух букв',
    [BAD_PATH]: 'Такое слово здесь не набирается',
    [PATH_MISSES_LETTER]: 'Слово должно проходить через новую букву',
    [NOT_IN_DICTIONARY]: 'Нет в словаре',
    [WORD_USED]: 'Это слово уже собрано',
});

export function createBaldaScreen(root, api) {
    root.innerHTML = '';

    const screen = document.createElement('div');
    screen.className = 'balda-root';
    screen.tabIndex = -1;
    root.appendChild(screen);

    const loading = document.createElement('div');
    loading.className = 'balda-loading';
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
            logError('не удалось построить экран балды', err);
            screen.textContent = 'Игра не открылась';
        }
    }).catch((err) => {
        if (destroyed) return;
        logError('не удалось загрузить словарь балды', err);
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
    const size = DEFAULT_SIZE;
    const neighbours = neighbourTable(size);

    // Уровень из слэш-команды (`/balda hard`) пишется в настройки, а не живёт отдельным
    // локальным значением: соперник читает уровень при каждом ходе, и второй источник
    // правды разъехался бы с панелью. Явный уровень означает новую партию, вход без
    // аргумента (хаб, wand-меню) продолжает сохранённую.
    const requestedLevel = api.args?.level;
    const resume = !requestedLevel;
    if (requestedLevel) {
        settings.level = normalizeLevel(requestedLevel);
        save();
    }

    // --- Разметка

    const header = document.createElement('div');
    header.className = 'balda-header';

    const scoreEl = document.createElement('span');
    scoreEl.className = 'balda-score';
    const turnEl = document.createElement('span');
    turnEl.className = 'balda-turn';
    const levelEl = document.createElement('span');
    levelEl.className = 'balda-level';

    const info = document.createElement('div');
    info.className = 'balda-info';
    info.append(scoreEl, turnEl, levelEl);

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.className = 'balda-btn menu_button';
    newGameBtn.textContent = 'Новая игра';

    header.append(info, newGameBtn);

    const board = createBoard({ size, onTap, onDrag });

    // ОДИН живой регион на всё: набираемое слово, отказы и итог партии. Живой регион на
    // каждой клетке заспамил бы скринридер.
    const status = document.createElement('div');
    status.className = 'balda-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'balda-actions';
    const submitBtn = actionButton('Готово', 'balda-submit', submit);
    const undoBtn = actionButton('Отменить', 'balda-undo', undo);
    const passBtn = actionButton('Пас', 'balda-pass', passTurn);
    actions.append(submitBtn, undoBtn, passBtn);

    const keyboard = createKeyboard({ onLetter: typeLetter });

    const words = document.createElement('div');
    words.className = 'balda-words';
    const myWords = wordColumn('Вы');
    const theirWords = wordColumn('Соперник');
    words.append(myWords.root, theirWords.root);

    screen.append(header, board.root, status, actions, keyboard.root, words);

    // --- Состояние экрана

    let destroyed = false;
    let thinking = false;
    let timerId = null;
    // Уровень, под которым партия учтена в статистике. Замораживается на старте: «сыграно»
    // пишется в начале, результат — в конце, и уехать в разные строки таблицы они не должны,
    // даже если игрок посреди партии сменил уровень в панели.
    let statsLevel = normalizeLevel(settings.level);
    let recorded = false;

    // Незавершённый ход игрока. Партия о нём не знает, пока не нажато «Готово».
    let selected = null;
    let pendingLetter = '';
    let path = [];
    // Разовое сообщение поверх строки статуса (отказ, подсказка). Гасится следующим
    // действием игрока — иначе «нет в словаре» висело бы до конца партии.
    let notice = '';

    // Семя разное на каждую партию: без него слабый и средний уровни выбирали бы из
    // группы найденных слов всегда одно и то же (та же причина, что в реверси).
    const rng = mulberry32((Math.random() * 0x100000000) >>> 0);

    const restored = resume ? restoreGame() : null;
    let state = restored?.state ?? newGame();
    if (restored) statsLevel = restored.level;

    // --- Ввод
    //
    // Ход состоит из двух разных действий, и оба начинаются одинаково — нажатием на
    // клетку (см. шапку ui/board.js). Пустая клетка выбирает место под букву, занятая
    // начинает или продолжает путь; тап и росчерк приходят сюда одной и той же цепочкой
    // вызовов, поэтому веток управления ровно две, а не четыре.

    function onTap(index) {
        const isPendingCell = index === selected && pendingLetter !== '';
        if (!isPendingCell && letterAt(state, index) === '') selectCell(index);
        else stepPath(index);
    }

    function onDrag(index) {
        // Росчерк по пустым клеткам ничего не выбирает: иначе рука, ведя слово,
        // переставляла бы новую букву на каждую задетую дырку.
        stepPath(index);
    }

    function selectCell(index) {
        if (!interactive()) return;
        notice = '';

        if (!isPlayable(state.board, size, index)) {
            announce(REASON_TEXT[NOT_ADJACENT]);
            return;
        }
        // Повторное нажатие на выбранную клетку снимает выбор целиком — это самый
        // короткий способ отменить начатый ход.
        if (index === selected) {
            resetMove();
            render();
            return;
        }

        // Уже набранная буква переезжает на новую клетку, а путь сбрасывается: он вёл
        // через старое место и стал бессмысленным.
        selected = index;
        path = [];
        render();
    }

    function typeLetter(letter) {
        if (!interactive()) return;
        notice = '';

        if (selected === null) {
            announce('Сначала выберите пустую клетку на поле');
            return;
        }
        pendingLetter = letter;
        render();
    }

    // Один шаг пути. Правила одни и для тапа, и для росчерка.
    function stepPath(index) {
        if (!interactive()) return;
        notice = '';

        const isPendingCell = index === selected && pendingLetter !== '';
        if (!isPendingCell && letterAt(state, index) === '') return;

        const last = path.length ? path[path.length - 1] : null;
        if (index === last) return;
        // Шаг назад по своему же следу — отмена последнего шага: рука, ведя росчерк
        // мимо, поправляет его тем же движением, а не кнопкой.
        if (path.length >= 2 && path[path.length - 2] === index) {
            path.pop();
            render();
            return;
        }
        if (path.includes(index)) return;
        if (last !== null && !neighbours[last].includes(index)) return;

        path.push(index);
        render();
    }

    // Отмена по шагам: сначала снимаются буквы пути, потом поставленная буква, потом
    // выбор клетки. Отдельной кнопки «сбросить всё» нет — три нажатия на «Отменить»
    // разбирают самый длинный незавершённый ход.
    function undo() {
        if (!interactive()) return;
        notice = '';

        if (path.length) path.pop();
        else if (pendingLetter) pendingLetter = '';
        else if (selected !== null) selected = null;
        render();
    }

    function submit() {
        if (!interactive()) return;
        notice = '';

        if (selected === null || pendingLetter === '') {
            announce('Поставьте букву в пустую клетку');
            return;
        }
        if (path.length < 2) {
            announce('Наберите слово: ведите по буквам или нажимайте на них подряд');
            return;
        }

        const result = applyMove(state, { index: selected, letter: pendingLetter, path }, dictionary);
        if (!result.ok) {
            // Негодный ход не меняет партию вообще — набранное остаётся на поле, чтобы
            // игрок мог поправить путь, а не набирать слово заново.
            reject(result.reason);
            return;
        }

        resetMove();
        render();
        persist();
        notify(`«${result.word}» — плюс ${result.score}`, 'success');

        if (result.over) {
            finish();
            return;
        }
        scheduleAi();
    }

    function passTurn() {
        if (!interactive()) return;
        notice = '';

        resetMove();
        const result = pass(state);
        render();
        persist();
        notify('Вы пропустили ход');

        if (result.over) {
            finish();
            return;
        }
        scheduleAi();
    }

    function reject(reason) {
        const message = REASON_TEXT[reason] ?? 'Так походить нельзя';
        announce(message);
        notify(message, 'error');
    }

    function resetMove() {
        selected = null;
        pendingLetter = '';
        path = [];
    }

    // --- Ход соперника

    function scheduleAi() {
        if (destroyed || thinking || state.over || state.turn === state.human) return;

        thinking = true;
        render();

        timerId = setTimeout(() => {
            timerId = null;
            // Первым делом — проверка «экран ещё жив». Оболочка размонтирует игру
            // синхронно и таймера не ждёт: за эти 300 мс окно могло закрыться.
            if (destroyed) return;
            thinking = false;

            try {
                aiMove();
            } catch (err) {
                // Упавший расчёт не должен оставлять экран в «думает» навсегда.
                logError('соперник балды не смог сделать ход', err);
                render();
            }
        }, THINK_MS);
    }

    function aiMove() {
        const move = chooseMove(state, dictionary, { level: normalizeLevel(settings.level), rng });
        const result = move ? applyMove(state, move, dictionary) : { ok: false };

        if (!result.ok) {
            // Слов не нашлось (или ход почему-то не принят) — соперник пасует. Пас надо
            // объявить: иначе ход «сам собой» возвращается игроку и выглядит багом.
            const passed = pass(state);
            render();
            persist();
            notify('У соперника нет ходов — он пасует');
            if (passed.over) finish();
            return;
        }

        render();
        persist();
        notify(`Соперник: «${result.word}» — ${result.score}`);
        if (result.over) finish();
    }

    // --- Партия

    function finish() {
        render();
        persist();

        const outcome = winner(state);
        notify(resultText(), outcome === state.human ? 'success' : 'info');
        recordOutcome(outcome);
    }

    // Новая партия: загаданное слово берётся из словаря, сторона игрока — из настроек
    // в момент старта (менять очередь посреди партии бессмысленно).
    function newGame() {
        const list = startWords(dictionary, size);
        if (!list.length) throw new Error(`балда: в словаре нет слов длиной ${size}`);
        const startWord = list[Math.floor(rng() * list.length)];

        return createGame({
            size,
            startWord,
            human: normalizeStart(settings.playFirst) === 'ai' ? SECOND : FIRST,
        });
    }

    function startNewGame() {
        state = newGame();
        resetMove();
        notice = '';
        thinking = false;
        recorded = false;
        statsLevel = normalizeLevel(settings.level);
        clearTimer();
        countPlayed();
        persist();
        render();
        // Игра вторым номером — это просто «соперник ходит первым», отдельной ветки нет.
        scheduleAi();
    }

    // --- Отрисовка

    function render() {
        const mine = scoreOf(state, state.human);
        const theirs = scoreOf(state, state.human === FIRST ? SECOND : FIRST);

        scoreEl.textContent = `Вы ${mine} : ${theirs} соперник`;
        levelEl.textContent = LEVEL_LABELS[normalizeLevel(settings.level)];
        turnEl.textContent = turnLabel();

        board.render(state, { selected, pendingLetter, path });

        const playable = interactive();
        keyboard.setEnabled(playable);
        submitBtn.disabled = !playable;
        undoBtn.disabled = !playable;
        passBtn.disabled = !playable;

        myWords.render(state.words[state.human], mine);
        theirWords.render(state.words[state.human === FIRST ? SECOND : FIRST], theirs);

        status.textContent = statusText();
    }

    function turnLabel() {
        if (state.over) return 'Партия окончена';
        if (thinking) return 'Соперник думает…';
        return state.turn === state.human ? 'Ваш ход' : 'Ход соперника';
    }

    function statusText() {
        if (state.over) return resultText();
        if (notice) return notice;
        if (thinking) return 'Соперник думает…';
        if (state.turn !== state.human) return '';
        if (path.length) return `Слово: ${draftWord()}`;
        if (pendingLetter) return `Буква ${pendingLetter} поставлена — наберите слово через неё`;
        if (selected !== null) return 'Выберите букву на клавиатуре';
        return 'Выберите пустую клетку рядом с занятой';
    }

    function draftWord() {
        let word = '';
        for (const index of path) {
            word += index === selected ? pendingLetter : letterAt(state, index);
        }
        return word;
    }

    function resultText() {
        const mine = scoreOf(state, state.human);
        const theirs = scoreOf(state, state.human === FIRST ? SECOND : FIRST);
        const outcome = winner(state);
        const verdict = outcome === null ? 'Ничья' : outcome === state.human ? 'Победа' : 'Поражение';
        return `${verdict}: ${mine} : ${theirs}. Нажмите «Новая игра».`;
    }

    function announce(text) {
        notice = text;
        status.textContent = text;
    }

    function notify(message, kind = 'info') {
        try {
            api.toast(kind, message);
        } catch (err) {
            logError('не удалось показать уведомление', err);
        }
    }

    function interactive() {
        return !destroyed && !thinking && !state.over && state.turn === state.human;
    }

    // --- Сохранение партии
    //
    // Пишем после каждого хода и при закрытии окна. Уровень статистики едет вместе с
    // полем, как в реверси: партия, начатая на «сложном» и продолженная после перезагрузки
    // страницы, обязана дописать результат в ту же строку таблицы. Движок про статистику
    // не знает, поэтому ключ добавляется здесь, поверх serialize().
    //
    // Множество собранных слов (state.used) в настройки не уходит вовсе: Set в JSON не
    // сериализуется, а deserialize() восстанавливает его по спискам слов сторон.

    function persist() {
        try {
            settings.savedGame = { ...serialize(state), level: statsLevel };
            save();
        } catch (err) {
            logError('не удалось сохранить партию балды', err);
        }
    }

    // Возвращает { state, level } или null. Доигранную партию не восстанавливаем:
    // открывать окно с законченным полем бессмысленно, игрок ждёт новое слово.
    function restoreGame() {
        try {
            const saved = settings.savedGame;
            const restoredState = deserialize(saved);
            if (!restoredState || restoredState.over) return null;
            return { state: restoredState, level: normalizeLevel(saved.level) };
        } catch (err) {
            logError('не удалось восстановить партию балды', err);
            return null;
        }
    }

    // --- Статистика
    //
    // Побочная запись, а не ход: если она упадёт, партия должна продолжаться как ни в чём
    // не бывало, поэтому всё обёрнуто в try/catch.

    function countPlayed() {
        try {
            recordPlayed(settings.stats, statsLevel);
            save();
            api.renderAllStats?.();
        } catch (err) {
            logError('не удалось обновить статистику балды', err);
        }
    }

    // Результат пишется строго один раз за партию: finish() зовётся и с хода игрока,
    // и с хода соперника, и с обоюдного паса.
    function recordOutcome(outcome) {
        if (recorded) return;
        recorded = true;

        const mine = scoreOf(state, state.human);
        const result = outcome === null ? DRAW : outcome === state.human ? WIN : LOSS;

        try {
            const { bestScore } = recordResult(settings.stats, statsLevel, result, mine);
            save();
            api.renderAllStats?.();
            if (bestScore) notify(`Новый рекорд очков: ${mine}`, 'success');
        } catch (err) {
            logError('не удалось записать результат партии балды', err);
        }
    }

    function save() {
        try {
            api.save();
        } catch (err) {
            logError('не удалось сохранить настройки балды', err);
        }
    }

    function clearTimer() {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    }

    // --- Связки

    const physical = attachKeyboard({
        onLetter: typeLetter,
        onSubmit: submit,
        onUndo: undo,
    });

    newGameBtn.addEventListener('click', () => {
        newGameBtn.blur();
        startNewGame();
    });

    // «Сыграно» растёт в момент старта партии, а не в её конце: брошенные партии иначе
    // нигде бы не отражались. Восстановленная партия повторно не считается — она уже
    // посчитана там, где началась.
    if (!restored) {
        countPlayed();
        persist();
    }

    render();
    scheduleAi();

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            thinking = false;
            clearTimer();
            physical.destroy();
            keyboard.destroy();
            board.destroy();
            // Сохранение — до вырывания экрана из DOM: закрытие попапа не должно стоить
            // игроку партии, а другого шанса записать её у игры не будет.
            persist();
        },
        // Единственный канал «настройки изменились»: уровень читается при каждой
        // отрисовке, но без пинка ждал бы следующего хода.
        refresh() {
            if (destroyed) return;
            render();
        },
    };
}

function actionButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `balda-action menu_button ${className}`;
    button.textContent = label;
    // Кнопка не должна забирать фокус у корня окна: следующая физическая клавиша
    // ушла бы ей, а не слушателю игры (грабля из ряда цифр судоку).
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
        button.blur();
        onClick();
    });
    return button;
}

// Столбец собранных слов. Без него партия нечитаема: очки меняются, а откуда они
// взялись — не видно, и повтор чужого слова выглядит придиркой движка.
function wordColumn(title) {
    const root = document.createElement('div');
    root.className = 'balda-words-col';

    const head = document.createElement('b');
    head.className = 'balda-words-title';

    const list = document.createElement('div');
    list.className = 'balda-words-list';

    root.append(head, list);

    return {
        root,
        render(items, score) {
            head.textContent = `${title} — ${score}`;
            list.textContent = items.join(', ');
        },
    };
}
