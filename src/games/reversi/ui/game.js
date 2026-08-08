// Экран реверси. Оболочка (src/shell/modal.js) создаёт контейнер root и зовёт
// createReversiScreen(root, api); про попап и SillyTavern этот модуль ничего не знает.
//
// Главное здесь — не доска, а асинхронность: ход соперника считается синхронно, но
// откладывается через setTimeout, и между постановкой таймера и его срабатыванием игрок
// может закрыть окно или уйти в хаб. Оболочка игру не ждёт: unmount() синхронный. Поэтому
// два локальных флага:
//   destroyed — экрана больше нет; отложенный колбэк обязан выйти, ничего не рисуя;
//   thinking  — соперник думает; клики по доске в это время игнорируются.
// Без них отложенный ход писал бы в вырванный из DOM экран.

import { logError } from '../../../log.js';
import {
    BLACK, EMPTY,
    applyMove, createGame, deserialize, idx as cellIdx, legalMoves, score, serialize, winner,
} from '../core/engine.js';
import { chooseMove, depthForLevel, mulberry32 } from '../core/ai.js';
import { DRAW, LOSS, WIN, recordPlayed, recordResult } from '../core/stats.js';
import { COLOR_LABELS, LEVEL_LABELS, humanColor, normalizeLevel } from '../settings.js';
import { createBoard } from './board.js';

// Минимальная пауза перед ходом соперника. Без неё перерисовка своего хода и ответ
// сливаются в один кадр, и игрок не видит, что вообще сделал. Заодно читается как
// «соперник думает».
const THINK_MS = 300;

const SIZE = 8;

const KEY_DELTA = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
};

export function createReversiScreen(root, api) {
    const settings = api.settings;

    // Уровень из слэш-команды (`/reversi hard`) пишется в настройки, а не живёт отдельным
    // локальным значением: соперник читает уровень из настроек при каждом ходе, и второй
    // источник правды разъехался бы с панелью. Явный уровень означает новую партию, вход
    // без аргумента (хаб, wand-меню) продолжает сохранённую.
    const requestedLevel = api.args?.level;
    const resume = !requestedLevel;
    if (requestedLevel) {
        settings.level = normalizeLevel(requestedLevel);
        saveSettings();
    }

    root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'reversi-root';
    screen.tabIndex = -1;
    root.appendChild(screen);

    // --- Разметка

    const header = document.createElement('div');
    header.className = 'reversi-header';

    const scoreEl = document.createElement('span');
    scoreEl.className = 'reversi-score';
    const turnEl = document.createElement('span');
    turnEl.className = 'reversi-turn';
    const levelEl = document.createElement('span');
    levelEl.className = 'reversi-level';

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.className = 'reversi-btn menu_button';
    newGameBtn.textContent = 'Новая игра';

    // Текстовая часть шапки — отдельным блоком: в ширину доски счёт, очередь и уровень
    // одной строкой не помещаются, и без обёртки перенос уносил бы кнопку под текст,
    // а её подпись ломал бы на две строки.
    const info = document.createElement('div');
    info.className = 'reversi-info';
    info.append(scoreEl, turnEl, levelEl);

    header.append(info, newGameBtn);

    const board = createBoard(onPick);

    const status = document.createElement('div');
    status.className = 'reversi-status';

    screen.append(header, board.root, status);

    // --- Состояние экрана

    let destroyed = false;
    let thinking = false;
    let timerId = null;
    // Уровень, под которым партия учтена в статистике. Замораживается на старте: «сыграно»
    // пишется в начале, результат — в конце, и уехать в разные строки таблицы они не должны,
    // даже если игрок посреди партии сменил уровень в панели.
    let statsLevel = normalizeLevel(settings.level);
    let recorded = false;

    const restored = resume ? restoreGame() : null;
    let state = restored?.state ?? createGame({ human: humanColor(settings.playAs) });
    if (restored) statsLevel = restored.level;

    // Курсор клавиатуры стартует в центре доски: оттуда до любого первого хода один шаг.
    let cursor = cellIdx(3, 3);
    let lastMove = null;
    // Семя разное на каждую партию: без него лёгкий соперник (глубина 1 + выбор из
    // нескольких лучших ходов) играл бы из раза в раз одну и ту же партию.
    const rng = mulberry32((Math.random() * 0x100000000) >>> 0);

    // --- Отрисовка

    // Ходы того, чья сейчас очередь. Считаются один раз на отрисовку: тем же списком
    // подсвечиваются подсказки и проверяется клик — правила не пересчитываются дважды.
    let moves = new Map();

    function refreshMoves() {
        moves = new Map();
        if (state.over) return;
        for (const move of legalMoves(state.board, state.turn)) moves.set(move.idx, move);
    }

    function render() {
        const counts = score(state.board);
        const human = state.human;
        const mine = human === BLACK ? counts.black : counts.white;
        const theirs = human === BLACK ? counts.white : counts.black;

        scoreEl.textContent = `Вы ${mine} : ${theirs} соперник`;
        levelEl.textContent = LEVEL_LABELS[settings.level] ?? LEVEL_LABELS.medium;
        turnEl.textContent = turnLabel();

        board.render(state, {
            cursor,
            // Подсказки — только на своём ходу: на ходу соперника они показывали бы
            // игроку его собственные ходы в чужой очереди.
            moves: state.turn === human && !thinking ? moves : new Map(),
            showHints: settings.showHints !== false,
            lastMove,
        });

        status.textContent = statusText();
    }

    function turnLabel() {
        if (state.over) return 'Партия окончена';
        return state.turn === state.human
            ? `Ваш ход (${COLOR_LABELS[state.human === BLACK ? 'black' : 'white'].toLowerCase()})`
            : 'Ход соперника';
    }

    function statusText() {
        if (state.over) return resultText();
        if (thinking) return 'Соперник думает…';
        if (state.turn === state.human) {
            return moves.size ? '' : 'Ходов нет — ход переходит сопернику';
        }
        return '';
    }

    function resultText() {
        const counts = score(state.board);
        const mine = state.human === BLACK ? counts.black : counts.white;
        const theirs = state.human === BLACK ? counts.white : counts.black;
        const outcome = winner(state.board);
        const verdict = outcome === state.human ? 'Победа' : outcome === EMPTY ? 'Ничья' : 'Поражение';
        return `${verdict}: ${mine} : ${theirs}. Нажмите «Новая игра».`;
    }

    // --- Ход игрока

    function onPick(idx) {
        // Пока соперник думает, доска смотрит, но не слушает: иначе игрок успел бы
        // сходить за него, и партия разъехалась бы с расчётом.
        if (destroyed || thinking || state.over) return;
        if (state.turn !== state.human) return;

        const move = moves.get(idx);
        cursor = idx;
        if (!move) {
            render();
            focusCursor();
            return;
        }

        play(move.x, move.y, 'human');
        focusCursor();
    }

    // who нужен только для формулировки паса: «у соперника нет ходов» и «у вас нет ходов» —
    // это одно и то же событие движка, но разные сообщения игроку.
    function play(x, y, who) {
        const res = applyMove(state, x, y);
        if (!res.ok) return;

        lastMove = cellIdx(x, y);
        refreshMoves();
        render();
        persist();

        if (res.over) {
            finish();
            return;
        }
        if (res.passed) {
            // Пас автоматический — его делает движок. Если о нём не сказать, ход
            // «сам собой» возвращается назад и выглядит как баг.
            notify(who === 'human'
                ? 'У соперника нет ходов — вы ходите снова'
                : 'У вас нет ходов — соперник ходит снова');
        }

        scheduleAi();
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
                const move = chooseMove(state.board, state.turn, {
                    depth: depthForLevel(settings.level),
                    rng,
                });
                if (move) play(move.x, move.y, 'ai');
                else render();
            } catch (err) {
                // Упавший расчёт не должен оставлять экран в «думает» навсегда.
                logError('соперник не смог сделать ход', err);
                render();
            }
        }, THINK_MS);
    }

    // --- Партия

    function finish() {
        refreshMoves();
        render();
        persist();

        const outcome = winner(state.board);
        notify(resultText(), outcome === state.human ? 'success' : 'info');
        recordOutcome(outcome);
    }

    function startNewGame() {
        // Цвет игрока берётся из настроек в момент старта: менять сторону посреди партии
        // бессмысленно, а на новой она должна примениться сразу.
        state = createGame({ human: humanColor(settings.playAs) });
        lastMove = null;
        cursor = cellIdx(3, 3);
        thinking = false;
        recorded = false;
        statsLevel = normalizeLevel(settings.level);
        clearTimer();
        countPlayed();
        persist();
        refreshMoves();
        render();
        scheduleAi();
    }

    // --- Сохранение партии
    //
    // Пишем после каждого хода и при закрытии окна. Сохранение идёт в extensionSettings
    // через saveSettingsDebounced, поэтому серия быстрых ходов не превращается в серию
    // записей на диск. Ошибка сохранения не должна ронять партию — только лог.
    //
    // Уровень статистики едет вместе с доской: партия, начатая на «сложном» и продолженная
    // после перезагрузки страницы, обязана дописать результат в ту же строку таблицы.
    // Движок про статистику не знает, поэтому ключ добавляется здесь, поверх serialize().

    function persist() {
        try {
            settings.savedGame = { ...serialize(state), level: statsLevel };
            saveSettings();
        } catch (err) {
            logError('не удалось сохранить партию реверси', err);
        }
    }

    // Возвращает { state, level } или null. Доигранную партию не восстанавливаем: открывать
    // окно с законченной позицией бессмысленно, игрок ждёт новую.
    function restoreGame() {
        try {
            const saved = settings.savedGame;
            const restoredState = deserialize(saved);
            if (!restoredState || restoredState.over) return null;
            return { state: restoredState, level: normalizeLevel(saved.level) };
        } catch (err) {
            logError('не удалось восстановить партию реверси', err);
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
            saveSettings();
            api.renderAllStats?.();
        } catch (err) {
            logError('не удалось обновить статистику реверси', err);
        }
    }

    // Результат пишется строго один раз за партию: finish() зовётся из play(), а тот —
    // и с хода игрока, и с хода соперника.
    function recordOutcome(outcome) {
        if (recorded) return;
        recorded = true;

        const counts = score(state.board);
        const mine = state.human === BLACK ? counts.black : counts.white;
        const theirs = state.human === BLACK ? counts.white : counts.black;
        const result = outcome === state.human ? WIN : outcome === EMPTY ? DRAW : LOSS;

        try {
            const { bestDiff } = recordResult(settings.stats, statsLevel, result, mine - theirs);
            saveSettings();
            api.renderAllStats?.();
            if (bestDiff) notify(`Новый рекорд разрыва: +${mine - theirs}`, 'success');
        } catch (err) {
            logError('не удалось записать результат партии реверси', err);
        }
    }

    function saveSettings() {
        try {
            api.save();
        } catch (err) {
            logError('не удалось сохранить настройки реверси', err);
        }
    }

    // --- Клавиатура
    //
    // Слушатель на доске, а не на document: игра событийная и полностью локальная, ей
    // хватает своих клавиш. Локальный слушатель автоматически соблюдает правило «глушить
    // только обработанные клавиши», а Esc не трогается вообще — его получает попап.

    function onKey(event) {
        if (destroyed) return;

        const delta = KEY_DELTA[event.key];
        if (delta) {
            event.preventDefault();
            event.stopPropagation();
            const x = Math.min(SIZE - 1, Math.max(0, (cursor % SIZE) + delta.x));
            const y = Math.min(SIZE - 1, Math.max(0, Math.floor(cursor / SIZE) + delta.y));
            cursor = cellIdx(x, y);
            render();
            focusCursor();
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onPick(cursor);
        }
    }

    function focusCursor() {
        board.cells[cursor]?.cell.focus?.({ preventScroll: true });
    }

    function notify(message, kind = 'info') {
        try {
            api.toast(kind, message);
        } catch (err) {
            logError('не удалось показать уведомление', err);
        }
    }

    function clearTimer() {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    }

    board.root.addEventListener('keydown', onKey);
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

    refreshMoves();
    render();
    // Игра белыми — это просто «соперник ходит первым», отдельной ветки не требуется.
    scheduleAi();

    return {
        destroy() {
            // Идемпотентен: оболочка зовёт destroy() и при выходе в хаб, и в finally
            // закрытия попапа.
            if (destroyed) return;
            destroyed = true;
            thinking = false;
            clearTimer();
            board.root.removeEventListener('keydown', onKey);
            // Сохранение — до вырывания экрана из DOM: закрытие попапа не должно стоить
            // игроку партии, а другого шанса записать её у игры не будет.
            persist();
            root.innerHTML = '';
        },
        // Единственный канал «настройки изменились»: подсветка ходов и уровень читаются
        // при каждой отрисовке, но без пинка ждали бы следующего хода.
        refresh() {
            if (destroyed) return;
            render();
        },
    };
}
