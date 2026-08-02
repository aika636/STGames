// Экран игры судоку. Хаб (src/shell/modal.js) создаёт контейнер root и зовёт
// createGameScreen(root, api); про попап и SillyTavern этот модуль ничего не знает.
//
// destroy() делает ровно то, что делал closeSession() в старом modal.js, и в том же
// порядке: остановить таймер, отцепить слушатели, поставить таймер на паузу и
// сохранить партию. persist() обязан прийти после pauseTimer() — иначе в настройки
// уедет партия с «бегущим» startedAt, и пауза между сессиями засчитается игроку.

import { logError, logInfo } from '../../../log.js';
import { LEVEL_LABELS } from '../settings.js';
import { generatePuzzle } from '../core/generator.js';
import { recordPlayed, recordSolved } from '../core/stats.js';
import {
    canRedo,
    canUndo,
    clearCell,
    complete,
    createGame,
    deserializeGame,
    formatElapsed,
    getElapsedMs,
    pauseTimer,
    redo,
    remainingCounts,
    serializeGame,
    setValue,
    startTimer,
    toggleNote,
    undo,
} from '../core/game.js';
import { createBoard, createRemainingCounter } from './board.js';
import { attachKeyboard, attachPointer, createControls, moveSelection } from './input.js';

const TIMER_TICK_MS = 1000;

// api.args — аргументы точки запуска ({ difficulty } у слэш-команды). Явно указанный
// уровень (`/sudoku hard`) означает новую партию, вход без аргумента (кнопка в
// wand-меню, хаб) продолжает незаконченную, если она есть.
export function createGameScreen(root, api) {
    const requested = api.args?.difficulty;
    const level = requested || api.settings.difficulty;

    const local = buildScreen(root, api, { resume: !requested, level });

    return {
        destroy: () => destroy(local),
        refresh: () => {
            if (local.state) redraw(local);
        },
    };
}

function destroy(local) {
    clearInterval(local.timerId);
    local.detach?.();
    pauseTimer(local.state);
    persist(local);
}

// --- Сохранение партии
//
// Пишем после каждого хода и при закрытии окна. Сохранение идёт в extensionSettings
// через saveSettingsDebounced, поэтому серия быстрых ходов не превращается в серию
// записей на диск. Ошибка сохранения не должна ронять партию — только лог.

function persist(local) {
    if (!local?.state) return;
    try {
        local.api.settings.savedGame = serializeGame(local.state);
        local.api.save();
    } catch (err) {
        logError('не удалось сохранить партию', err);
    }
}

// Возвращает незаконченную сохранённую партию или null. Решённую не восстанавливаем:
// открывать окно с уже собранной доской бессмысленно, игрок ждёт новую.
function restoreGame(api) {
    try {
        const saved = api.settings.savedGame;
        const state = deserializeGame(saved);
        if (!state || state.completedAt) return null;
        return state;
    } catch (err) {
        logError('не удалось восстановить партию', err);
        return null;
    }
}

// --- Статистика по уровням
//
// Считается по заказанному уровню (`state.difficulty`), а не по оценённому генератором
// (`state.level`): в панели настроек игрок ищет ту строку, которую сам выбрал в
// селекторе, и не должен гадать, куда уехала партия из-за фолбэка генератора.
//
// Обновление статистики — побочная запись, а не ход: если оно упадёт, партия должна
// продолжаться как ни в чём не бывало, поэтому всё обёрнуто в try/catch.

function countGame(local, record) {
    try {
        const result = record(local.api.settings.stats);
        local.api.save();
        local.api.renderAllStats();
        return result;
    } catch (err) {
        logError('не удалось обновить статистику', err);
        return null;
    }
}

// --- Сборка экрана

function buildScreen(root, api, { level, resume = false } = {}) {
    const screen = document.createElement('div');
    screen.className = 'sudoku-root';
    // Фокусируемый корень: попап ST при открытии сам ставит фокус на первый подходящий
    // элемент внутри, и без этого им оказывался select уровня.
    screen.tabIndex = -1;
    root.appendChild(screen);

    const header = document.createElement('div');
    header.className = 'sudoku-header';

    const levelSelect = document.createElement('select');
    levelSelect.className = 'sudoku-select text_pole';
    for (const [value, label] of Object.entries(LEVEL_LABELS)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        levelSelect.appendChild(option);
    }
    levelSelect.value = level;

    const timer = document.createElement('span');
    timer.className = 'sudoku-timer';

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.className = 'sudoku-btn menu_button';
    newGameBtn.textContent = 'Новая игра';

    header.append(levelSelect, timer, newGameBtn);

    const board = createBoard();

    const status = document.createElement('div');
    status.className = 'sudoku-status';

    const local = {
        api,
        root: screen,
        board,
        timer,
        status,
        pad: null,
        remaining: null,
        state: null,
        timerId: null,
        // Выбранная клетка (индекс или null) и режим заметок — состояние ввода, а не
        // партии: в сохранение оно не уходит.
        selected: null,
        notesMode: false,
        detach: null,
    };

    // --- Ходы. Каждый меняет состояние и перерисовывает экран; проверка победы — в
    // --- одном месте, чтобы её нельзя было забыть в новой ветке ввода.

    const play = (mutate) => {
        if (!local.state || local.state.completedAt) return;
        if (mutate() === false) return;
        checkWin(local);
        redraw(local);
        persist(local);
    };

    const inputDigit = (digit) => play(() => {
        if (local.selected === null) return false;
        if (local.notesMode) return toggleNote(local.state, local.selected, digit);
        return setValue(local.state, local.selected, digit, {
            autoCleanNotes: api.settings.autoCleanNotes,
        });
    });

    const handlers = {
        onDigit: inputDigit,
        onErase: () => play(() => local.selected !== null && clearCell(local.state, local.selected)),
        onUndo: () => play(() => undo(local.state)),
        onRedo: () => play(() => redo(local.state)),
        onToggleNotes: () => {
            local.notesMode = !local.notesMode;
            redraw(local);
        },
        onMove: (delta) => {
            local.selected = moveSelection(local.selected, delta);
            redraw(local);
        },
    };

    const pad = createControls(handlers);
    // Ряд цифр под доской кликабельный: на телефоне это единственный способ ввода —
    // системную клавиатуру попап ST не показывает (в окне нет полей ввода).
    const remaining = createRemainingCounter(inputDigit);
    local.pad = pad;
    local.remaining = remaining;

    screen.append(header, board.root, remaining.root, pad.root, status);

    const select = (idx) => {
        // Повторный клик по выбранной клетке снимает выделение — так проще убрать
        // подсветку, не целясь в пустое место за доской.
        local.selected = local.selected === idx ? null : idx;
        // Клик по клетке фокус не переносит (mousedown отменён, чтобы не выделялся
        // текст), поэтому уводим его на корень руками — иначе он останется на select.
        screen.focus?.();
        redraw(local);
    };

    const detachPointer = attachPointer(board.root, select);
    const detachKeyboard = attachKeyboard(screen, handlers);
    local.detach = () => {
        detachPointer();
        detachKeyboard();
    };

    // Общий вход и для новой партии, и для восстановленной: одинаково сбрасывает
    // состояние ввода, запускает таймер и сохраняется.
    const startGame = (state) => {
        local.state = state;
        local.selected = null;
        local.notesMode = false;
        startTimer(local.state);
        persist(local);
        redraw(local);
    };

    const startNewGame = (requested) => {
        const generated = generatePuzzle({ difficulty: requested });
        if (!generated.exact) {
            // Генератор не смог попасть в заказанный уровень за отведённые попытки и
            // отдал ближайший. Молчать нельзя: игрок выбирал другую сложность.
            logInfo(`заказан уровень ${requested}, получен ${generated.level}`);
        }
        const state = createGame(generated);
        // «Сыграно» растёт в момент создания доски: партия, брошенная на середине,
        // тоже сыграна, иначе «решено» всегда совпадало бы со «сыграно».
        countGame(local, (stats) => recordPlayed(stats, state.difficulty));
        startGame(state);
    };

    levelSelect.addEventListener('change', () => {
        const requested = levelSelect.value;
        api.settings.difficulty = requested;
        api.save();
        startNewGame(requested);
    });

    newGameBtn.addEventListener('click', () => startNewGame(levelSelect.value));

    const restored = resume ? restoreGame(api) : null;
    if (restored) {
        // Селектор показывает уровень восстановленной партии, а не тот, что лежит
        // в настройках: иначе подпись врала бы про доску на экране.
        if (restored.difficulty in LEVEL_LABELS) levelSelect.value = restored.difficulty;
        startGame(restored);
        logInfo(`партия восстановлена (${restored.level})`);
    } else {
        startNewGame(level);
    }

    local.timerId = setInterval(() => {
        if (!local.state) return;
        updateTimer(local);
    }, TIMER_TICK_MS);

    return local;
}

// Фиксирует победу ровно один раз: останавливает таймер, пишет статистику и
// поздравляет игрока. complete() идемпотентна, поэтому партия не может засчитаться дважды.
function checkWin(local) {
    if (!complete(local.state)) return;
    local.selected = null;

    const elapsed = getElapsedMs(local.state);
    const difficulty = local.state.difficulty;
    const isBest = countGame(local, (stats) => recordSolved(stats, difficulty, elapsed));

    const time = formatElapsed(elapsed);
    local.api.toast('success', isBest ? `Решено за ${time} — лучшее время!` : `Решено за ${time}`);
    logInfo(`партия решена (${local.state.level}, ${time}${isBest ? ', рекорд' : ''})`);
}

function redraw(local) {
    const settings = local.api.settings;
    local.board.render(local.state, {
        selected: local.selected,
        highlightConflicts: settings.highlightConflicts,
        highlightMistakes: settings.highlightMistakes,
    });
    local.board.root.classList.toggle('sudoku-board-notes', local.notesMode);
    updateTimer(local);

    local.remaining.update(remainingCounts(local.state));
    local.pad.update({
        notesMode: local.notesMode,
        canUndo: canUndo(local.state),
        canRedo: canRedo(local.state),
    });

    local.status.textContent = describeStatus(local);
}

function describeStatus(local) {
    const level = LEVEL_LABELS[local.state.level] ?? local.state.level;
    if (local.state.completedAt) {
        return `${level} · решено за ${formatElapsed(getElapsedMs(local.state))}`;
    }
    // Число подсказок в строке не показывается: сложность у нас определяется техникой,
    // которой хватает для решения, а не количеством заполненных клеток, — игроку это
    // число ничего не говорило.
    return local.notesMode ? `${level} · режим заметок` : level;
}

function updateTimer(local) {
    const settings = local.api.settings;
    local.timer.classList.toggle('sudoku-hidden', !settings.showTimer);
    if (!settings.showTimer) return;
    local.timer.textContent = formatElapsed(getElapsedMs(local.state));
}
