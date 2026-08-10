// Экран сапёра. Оболочка (src/shell/modal.js) создаёт контейнер root и зовёт
// createMinesweeperScreen(root, api); про попап и SillyTavern этот модуль ничего не знает.
//
// Две вещи, которых нет у соседних игр:
//   * поле рождается не вместе с партией, а с первым кликом — мины расставляются вокруг
//     него (generator.js). До этого доска настоящая, но пустая, и «сыграно» ещё не
//     засчитано: игрок, открывший окно и передумавший, партии не начинал;
//   * доска пересоздаётся при смене уровня — размер поля у сапёра меняется вместе с ним.
//     Остальные игры строят сетку один раз за экран.
//
// Время считается по часам (elapsed + сейчас − отметка старта), а не тиком таймера:
// фоновая вкладка в браузере получает свой интервал раз в минуту, и партия, свёрнутая
// на десять минут, насчитала бы десять секунд. Тик здесь нужен только чтобы перерисовать
// подпись.

import { logError } from '../../../log.js';
import {
    boardFor,
    chord,
    createGame,
    deserialize,
    openCell,
    plant,
    remainingMines,
    serialize,
    toggleFlag,
    wrongFlags,
} from '../core/engine.js';
import { generateField } from '../core/generator.js';
import { recordPlayed, recordResult } from '../core/stats.js';
import { LEVELS, formatTime, levelLabel, normalizeLevel } from '../settings.js';
import { createBoard } from './board.js';

const TICK_MS = 1000;

const KEY_DELTA = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
};

// Флажок с клавиатуры: F в латинской раскладке и та же клавиша в ЙЦУКЕН — приём из
// судоку, где так же сделан режим заметок.
const FLAG_KEYS = new Set(['f', 'а']);

export function createMinesweeperScreen(root, api) {
    const settings = api.settings;

    // Уровень из слэш-команды (`/minesweeper hard`) пишется в настройки, а не живёт
    // отдельным локальным значением: селектор в шапке и панель настроек читают одно и
    // то же место. Явный уровень означает новую партию, вход без аргумента продолжает
    // сохранённую.
    const requestedLevel = api.args?.level;
    const resume = !requestedLevel;
    if (requestedLevel) {
        settings.level = normalizeLevel(requestedLevel);
        save();
    }

    root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'minesweeper-root';
    screen.tabIndex = -1;
    root.appendChild(screen);

    // --- Разметка

    const header = document.createElement('div');
    header.className = 'minesweeper-header';

    const levelSelect = document.createElement('select');
    levelSelect.className = 'minesweeper-select text_pole';
    for (const level of LEVELS) {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = levelLabel(level);
        levelSelect.appendChild(option);
    }
    levelSelect.value = normalizeLevel(settings.level);

    const minesEl = document.createElement('span');
    minesEl.className = 'minesweeper-counter';
    const timerEl = document.createElement('span');
    timerEl.className = 'minesweeper-timer';

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.className = 'minesweeper-btn menu_button';
    newGameBtn.textContent = 'Новая игра';

    const info = document.createElement('div');
    info.className = 'minesweeper-info';
    info.append(minesEl, timerEl);

    header.append(levelSelect, info, newGameBtn);

    const boardBox = document.createElement('div');
    boardBox.className = 'minesweeper-board-box';

    const status = document.createElement('div');
    status.className = 'minesweeper-status';

    const hint = document.createElement('div');
    hint.className = 'minesweeper-hint';
    hint.textContent = 'Правая кнопка или долгое нажатие — флажок';

    screen.append(header, boardBox, status, hint);

    // --- Состояние экрана

    let destroyed = false;
    let board = null;
    let tickId = null;
    // Уровень, под которым партия учтена в статистике. Замораживается на старте: «сыграно»
    // пишется в начале, результат — в конце, и уехать в разные строки таблицы они не должны.
    let statsLevel = normalizeLevel(settings.level);
    let recorded = false;
    let counted = false;
    // Отметка запуска часов. null — часы стоят (партия не начата или окончена).
    let clockSince = null;
    let cursor = 0;

    const restored = resume ? restoreGame() : null;
    let state = restored?.state ?? createGame(boardFor(statsLevel));
    if (restored) {
        statsLevel = restored.level;
        levelSelect.value = statsLevel;
        // Восстановленная партия уже посчитана там, где началась.
        counted = state.started;
    }

    mountBoard();
    if (state.started && !state.over) startClock();
    render();
    tickId = setInterval(() => {
        if (destroyed || clockSince === null) return;
        updateClock();
    }, TICK_MS);

    // --- Доска
    //
    // Пересоздаётся при смене уровня: размер поля — часть уровня, а сетка строится
    // один раз на свой размер.

    function mountBoard() {
        board?.destroy();
        boardBox.textContent = '';
        board = createBoard({
            cols: state.cols,
            rows: state.rows,
            onOpen: handleOpen,
            onFlag: handleFlag,
            onChord: handleChord,
        });
        board.root.addEventListener('keydown', onKey);
        boardBox.appendChild(board.root);
        cursor = Math.min(cursor, state.cols * state.rows - 1);
    }

    // --- Отрисовка

    function render() {
        minesEl.textContent = `💣 ${remainingMines(state)}`;
        timerEl.textContent = formatTime(elapsed());
        timerEl.style.display = settings.showTimer === false ? 'none' : '';

        board.render(state, {
            cursor,
            reveal: state.over,
            wrong: state.over && !state.won ? new Set(wrongFlags(state)) : undefined,
        });

        status.textContent = statusText();
        // Подсказка про флажок нужна ровно один раз — пока партия не началась. Дальше
        // она занимает строку под доской, которой на телефоне и так мало.
        hint.style.display = state.started ? 'none' : '';
    }

    function statusText() {
        if (!state.over) return '';
        return state.won
            ? `Поле разминировано за ${formatTime(elapsed())}. Нажмите «Новая игра».`
            : 'Взрыв. Нажмите «Новая игра».';
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

    // --- Ходы

    // Первое открытие рождает поле: мины расставляются вокруг выбранной клетки, поэтому
    // первый клик безопасен по построению, а не по счастливой случайности.
    function ensureField(safeIndex) {
        if (state.started) return;
        try {
            const { mines } = generateField({
                cols: state.cols,
                rows: state.rows,
                mines: state.mines,
                safeIndex,
                noGuess: settings.noGuess !== false,
            });
            plant(state, mines);
        } catch (err) {
            logError('не удалось сгенерировать поле', err);
            return;
        }
        startClock();
        countPlayed();
    }

    function handleOpen(index) {
        if (destroyed || state.over) return;
        cursor = index;

        // Клик по открытой цифре — это аккорд, а не открытие: открывать там нечего.
        if (state.open[index]) {
            if (settings.autoChord !== false) handleChord(index);
            else render();
            return;
        }

        ensureField(index);
        if (!state.started) return;

        const res = openCell(state, index);
        if (!res.ok) {
            render();
            return;
        }
        afterMove();
    }

    function handleFlag(index) {
        if (destroyed || state.over) return;
        cursor = index;
        if (!toggleFlag(state, index)) {
            render();
            return;
        }
        render();
        persist();
    }

    function handleChord(index) {
        if (destroyed || state.over || !state.started) return;
        cursor = index;
        const res = chord(state, index);
        if (!res.ok && !res.exploded) {
            render();
            return;
        }
        afterMove();
    }

    function afterMove() {
        if (state.over) {
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
        const time = formatTime(elapsed());
        notify(state.won ? `Поле разминировано за ${time}` : 'Взрыв', state.won ? 'success' : 'info');
        recordOutcome();
    }

    function startNewGame() {
        statsLevel = normalizeLevel(levelSelect.value);
        settings.level = statsLevel;
        const geometry = boardFor(statsLevel);
        const sizeChanged = geometry.cols !== state.cols || geometry.rows !== state.rows;

        state = createGame(geometry);
        clockSince = null;
        recorded = false;
        counted = false;
        cursor = 0;
        if (sizeChanged) mountBoard();
        // «Сыграно» здесь не растёт: партия начинается с первой открытой клетки, а не с
        // нажатия «Новая игра». Пустое поле — это ещё не партия.
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
            logError('не удалось сохранить партию сапёра', err);
        }
    }

    // Возвращает { state, level } или null. Доигранную партию не восстанавливаем:
    // открывать окно с законченным полем бессмысленно, игрок ждёт новое.
    function restoreGame() {
        try {
            const saved = settings.savedGame;
            const restoredState = deserialize(saved);
            if (!restoredState || restoredState.over) return null;
            return { state: restoredState, level: normalizeLevel(saved.level) };
        } catch (err) {
            logError('не удалось восстановить партию сапёра', err);
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
            logError('не удалось обновить статистику сапёра', err);
        }
    }

    function recordOutcome() {
        if (recorded) return;
        recorded = true;
        try {
            const { bestTime } = recordResult(settings.stats, statsLevel, state.won, Math.round(elapsed()));
            save();
            api.renderAllStats?.();
            if (bestTime) notify(`Новый рекорд уровня: ${formatTime(elapsed())}`, 'success');
        } catch (err) {
            logError('не удалось записать результат партии сапёра', err);
        }
    }

    function save() {
        try {
            api.save();
        } catch (err) {
            logError('не удалось сохранить настройки сапёра', err);
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
    // Слушатель на доске, а не на document: игра событийная и полностью локальная.
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
            handleOpen(cursor);
            focusCursor();
            return;
        }

        if (FLAG_KEYS.has(event.key.toLowerCase())) {
            event.preventDefault();
            event.stopPropagation();
            handleFlag(cursor);
            focusCursor();
        }
    }

    function focusCursor() {
        board.cells[cursor]?.focus?.({ preventScroll: true });
    }

    levelSelect.addEventListener('change', () => {
        settings.level = normalizeLevel(levelSelect.value);
        save();
        // Смена уровня — это новое поле: старое ей не подходит по размеру.
        startNewGame();
    });

    newGameBtn.addEventListener('click', () => {
        newGameBtn.blur();
        startNewGame();
    });

    return {
        destroy() {
            // Идемпотентен: оболочка зовёт destroy() и при выходе в хаб, и в finally
            // закрытия попапа.
            if (destroyed) return;
            destroyed = true;
            clearInterval(tickId);
            tickId = null;
            board?.root.removeEventListener('keydown', onKey);
            board?.destroy();
            // Сохранение — до вырывания экрана из DOM: закрытие окна не должно стоить
            // игроку партии, а другого шанса записать её у игры не будет.
            stopClock();
            persist();
            root.innerHTML = '';
        },
        // Единственный канал «настройки изменились»: таймер, аккорд и уровень читаются
        // при отрисовке, но без пинка ждали бы следующего хода.
        refresh() {
            if (destroyed) return;
            const level = normalizeLevel(settings.level);
            // Уровень мог смениться в панели настроек: селектор в шапке — тот же
            // источник правды, но другой элемент.
            if (levelSelect.value !== level && !state.started) {
                levelSelect.value = level;
                startNewGame();
                return;
            }
            render();
        },
    };
}
