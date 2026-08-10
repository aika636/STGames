// Экран нонограммы. Оболочка (src/shell/modal.js) создаёт контейнер root и зовёт
// createNonogramScreen(root, api); про попап и SillyTavern этот модуль ничего не знает.
//
// Отличий от соседних игр два. Первое — ход делается росчерком, а не кликом: всю работу
// с указателем держит ui/board.js, экран получает от неё готовое «клетке index поставить
// метку mark». Второе — поле пересобирается при смене уровня: размер картинки и есть
// уровень, а вместе с ним меняются и подсказки по краям.
//
// Время считается по часам (elapsed + сейчас − отметка старта), а не тиком таймера:
// фоновая вкладка получает свой интервал раз в минуту, и партия, свёрнутая на десять
// минут, насчитала бы десять секунд.

import { logError } from '../../../log.js';
import {
    CROSS,
    EMPTY,
    FILLED,
    checkWin,
    colDone,
    createGame,
    deserialize,
    remaining,
    rowDone,
    serialize,
    setMark,
    wrongMarks,
} from '../core/game.js';
import { boardFor, generatePuzzle } from '../core/generator.js';
import { recordPlayed, recordSolved } from '../core/stats.js';
import { LEVELS, formatTime, levelLabel, normalizeLevel } from '../settings.js';
import { createBoard } from './board.js';

const TICK_MS = 1000;

const KEY_DELTA = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
};

// Крестик с клавиатуры: X в латинской раскладке и та же клавиша в ЙЦУКЕН — приём из
// судоку, где так же сделан режим заметок.
const CROSS_KEYS = new Set(['x', 'ч']);

export function createNonogramScreen(root, api) {
    const settings = api.settings;

    const requestedLevel = api.args?.level;
    const resume = !requestedLevel;
    if (requestedLevel) {
        settings.level = normalizeLevel(requestedLevel);
        save();
    }

    root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'nonogram-root';
    screen.tabIndex = -1;
    root.appendChild(screen);

    // --- Разметка

    const header = document.createElement('div');
    header.className = 'nonogram-header';

    const levelSelect = document.createElement('select');
    levelSelect.className = 'nonogram-select text_pole';
    for (const level of LEVELS) {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = levelLabel(level);
        levelSelect.appendChild(option);
    }
    levelSelect.value = normalizeLevel(settings.level);

    const leftEl = document.createElement('span');
    leftEl.className = 'nonogram-left';
    const timerEl = document.createElement('span');
    timerEl.className = 'nonogram-timer';

    const info = document.createElement('div');
    info.className = 'nonogram-info';
    info.append(leftEl, timerEl);

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.className = 'nonogram-btn menu_button';
    newGameBtn.textContent = 'Новая';

    header.append(levelSelect, info, newGameBtn);

    const boardBox = document.createElement('div');
    boardBox.className = 'nonogram-board-box';

    // Переключатель режима — единственный способ ставить крестики пальцем: правой
    // кнопки на тач-экране нет.
    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'nonogram-mode menu_button';
    modeBtn.setAttribute('aria-pressed', 'false');

    const status = document.createElement('div');
    status.className = 'nonogram-status';

    const tools = document.createElement('div');
    tools.className = 'nonogram-tools';
    tools.append(modeBtn, status);

    screen.append(header, boardBox, tools);

    // --- Состояние экрана

    let destroyed = false;
    let board = null;
    let tickId = null;
    let statsLevel = normalizeLevel(settings.level);
    let recorded = false;
    let counted = false;
    let clockSince = null;
    let cursor = 0;
    let crossMode = false;

    const restored = resume ? restoreGame() : null;
    let state = restored?.state ?? newPuzzle(statsLevel);
    if (restored) {
        statsLevel = restored.level;
        levelSelect.value = statsLevel;
        // Восстановленная партия уже посчитана там, где началась. Пустое поле — ещё нет:
        // партия начинается с первой отметки.
        counted = hasMarks(state);
    }

    mountBoard();
    if (counted && !state.over) startClock();
    render();
    tickId = setInterval(() => {
        if (destroyed || clockSince === null) return;
        updateClock();
    }, TICK_MS);

    function newPuzzle(level) {
        const geometry = boardFor(level);
        const puzzle = generatePuzzle(geometry);
        return createGame({
            cols: geometry.cols,
            rows: geometry.rows,
            grid: puzzle.grid,
            rowClues: puzzle.rowClues,
            colClues: puzzle.colClues,
        });
    }

    function hasMarks(current) {
        for (const mark of current.marks) {
            if (mark !== EMPTY) return true;
        }
        return false;
    }

    // --- Поле
    //
    // Пересобирается при новой картинке: подсказки по краям принадлежат конкретной
    // партии, а не экрану.

    function mountBoard() {
        board?.destroy();
        boardBox.textContent = '';
        board = createBoard({
            cols: state.cols,
            rows: state.rows,
            rowClues: state.rowClues,
            colClues: state.colClues,
            crossMode: () => crossMode,
            onPaint: handlePaint,
        });
        board.setMarkProvider((index) => state.marks[index]);
        board.board.addEventListener('keydown', onKey);
        boardBox.appendChild(board.root);
        cursor = Math.min(cursor, state.cols * state.rows - 1);
    }

    // --- Отрисовка

    function render() {
        const left = remaining(state);
        leftEl.textContent = state.over ? 'Готово' : `Осталось: ${left}`;
        timerEl.textContent = formatTime(elapsed());
        timerEl.style.display = settings.showTimer === false ? 'none' : '';

        modeBtn.textContent = crossMode ? 'Режим: крестик' : 'Режим: закрасить';
        modeBtn.setAttribute('aria-pressed', crossMode ? 'true' : 'false');
        modeBtn.classList.toggle('nonogram-mode-cross', crossMode);

        board.render(state, {
            cursor,
            wrong: settings.highlightMistakes ? new Set(wrongMarks(state)) : undefined,
            rowDone: (y) => rowDone(state, y),
            colDone: (x) => colDone(state, x),
        });

        status.textContent = state.over ? `Картинка собрана за ${formatTime(elapsed())}` : '';
    }

    // --- Часы

    function elapsed() {
        if (clockSince === null) return state.elapsed;
        return state.elapsed + (Date.now() - clockSince) / 1000;
    }

    function startClock() {
        if (clockSince === null) clockSince = Date.now();
    }

    // Сворачивает набежавшее время в состояние. Зовётся перед каждым сохранением: иначе
    // в settings.json уехала бы партия с «бегущей» отметкой, и пауза между сессиями
    // засчиталась бы игроку (те же грабли, что в судоку).
    function stopClock() {
        if (clockSince === null) return;
        state.elapsed += (Date.now() - clockSince) / 1000;
        clockSince = null;
    }

    function updateClock() {
        timerEl.textContent = formatTime(elapsed());
    }

    // --- Ход

    function handlePaint(index, mark) {
        if (destroyed || state.over) return;
        cursor = index;
        if (!setMark(state, index, mark)) {
            render();
            return;
        }

        // Партия начинается с первой отметки, а не с открытия окна: игрок, заглянувший
        // на картинку и ушедший, партии не начинал.
        countPlayed();
        startClock();

        if (checkWin(state)) {
            stopClock();
            render();
            finish();
            return;
        }

        render();
        persist();
    }

    function finish() {
        persist();
        notify(`Картинка собрана за ${formatTime(elapsed())}`, 'success');
        recordOutcome();
    }

    function startNewGame() {
        statsLevel = normalizeLevel(levelSelect.value);
        settings.level = statsLevel;

        state = newPuzzle(statsLevel);
        clockSince = null;
        recorded = false;
        counted = false;
        cursor = 0;
        // Поле пересобирается всегда, а не только при смене размера: подсказки по краям
        // принадлежат картинке, и у новой они другие даже на том же уровне.
        mountBoard();
        persist();
        render();
    }

    // --- Сохранение партии

    function persist() {
        try {
            const running = clockSince !== null;
            stopClock();
            settings.savedGame = { ...serialize(state), level: statsLevel };
            save();
            if (running && !state.over) startClock();
        } catch (err) {
            logError('не удалось сохранить партию нонограммы', err);
        }
    }

    // Возвращает { state, level } или null. Собранную картинку не восстанавливаем:
    // открывать окно с готовой картинкой бессмысленно, игрок ждёт новую.
    function restoreGame() {
        try {
            const saved = settings.savedGame;
            const restoredState = deserialize(saved);
            if (!restoredState || restoredState.over) return null;
            return { state: restoredState, level: normalizeLevel(saved.level) };
        } catch (err) {
            logError('не удалось восстановить партию нонограммы', err);
            return null;
        }
    }

    // --- Статистика
    //
    // Побочная запись, а не ход: если она упадёт, партия должна продолжаться как ни в чём
    // не бывало, поэтому всё обёрнуто в try/catch.

    function countPlayed() {
        if (counted) return;
        counted = true;
        try {
            recordPlayed(settings.stats, statsLevel);
            save();
            api.renderAllStats?.();
        } catch (err) {
            logError('не удалось обновить статистику нонограммы', err);
        }
    }

    function recordOutcome() {
        if (recorded) return;
        recorded = true;
        try {
            const { bestTime } = recordSolved(settings.stats, statsLevel, Math.round(elapsed()));
            save();
            api.renderAllStats?.();
            if (bestTime) notify(`Новый рекорд уровня: ${formatTime(elapsed())}`, 'success');
        } catch (err) {
            logError('не удалось записать результат партии нонограммы', err);
        }
    }

    function save() {
        try {
            api.save();
        } catch (err) {
            logError('не удалось сохранить настройки нонограммы', err);
        }
    }

    function notify(message, kind = 'info') {
        try {
            api.toast(kind, message);
        } catch (err) {
            logError('не удалось показать уведомление', err);
        }
    }

    // --- Клавиатура
    //
    // Слушатель на поле, а не на document: игра событийная и полностью локальная.
    // Глушим только обработанные клавиши, Esc не трогаем — его получает попап.

    function onKey(event) {
        if (destroyed) return;

        const delta = KEY_DELTA[event.key];
        if (delta) {
            event.preventDefault();
            event.stopPropagation();
            const x = Math.min(state.cols - 1, Math.max(0, (cursor % state.cols) + delta.x));
            const y = Math.min(state.rows - 1, Math.max(0, Math.floor(cursor / state.cols) + delta.y));
            cursor = y * state.cols + x;
            render();
            focusCursor();
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            toggle(cursor, FILLED);
            focusCursor();
            return;
        }

        if (CROSS_KEYS.has(event.key.toLowerCase())) {
            event.preventDefault();
            event.stopPropagation();
            toggle(cursor, CROSS);
            focusCursor();
        }
    }

    // С клавиатуры метка переключается, а не ставится: иначе снять ошибочную закраску
    // было бы нечем.
    function toggle(index, mark) {
        handlePaint(index, state.marks[index] === mark ? EMPTY : mark);
    }

    function focusCursor() {
        board.cells[cursor]?.focus?.({ preventScroll: true });
    }

    levelSelect.addEventListener('change', () => {
        settings.level = normalizeLevel(levelSelect.value);
        save();
        startNewGame();
    });

    newGameBtn.addEventListener('click', () => {
        newGameBtn.blur();
        startNewGame();
    });

    modeBtn.addEventListener('click', () => {
        modeBtn.blur();
        crossMode = !crossMode;
        render();
    });

    return {
        destroy() {
            // Идемпотентен: оболочка зовёт destroy() и при выходе в хаб, и в finally
            // закрытия попапа.
            if (destroyed) return;
            destroyed = true;
            clearInterval(tickId);
            tickId = null;
            board?.board.removeEventListener('keydown', onKey);
            board?.destroy();
            // Сохранение — до вырывания экрана из DOM: закрытие окна не должно стоить
            // игроку партии.
            stopClock();
            persist();
            root.innerHTML = '';
        },
        refresh() {
            if (destroyed) return;
            const level = normalizeLevel(settings.level);
            // Уровень мог смениться в панели настроек: селектор в шапке — тот же
            // источник правды, но другой элемент. Начатую партию не трогаем.
            if (levelSelect.value !== level && !counted) {
                levelSelect.value = level;
                startNewGame();
                return;
            }
            render();
        },
    };
}
