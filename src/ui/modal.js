// Модальное окно с игрой. Здесь живёт вся связь с SillyTavern: попап, настройки, тосты.
//
// Основной путь — ctx.callGenericPopup(..., POPUP_TYPE.DISPLAY): попап без кнопок, с
// крестиком в углу и закрытием по Esc. Если попапа в этой версии ST нет (или он упал),
// показывается собственный оверлей .sudoku-overlay — расширение не должно зависеть от
// того, что внутренний API таверны останется прежним.

import { getCtx, toast } from '../ctx.js';
import { logError, logInfo } from '../log.js';
import { LEVEL_LABELS, getSettings, renderStats, saveSettings } from '../settings.js';
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

// Открытая партия. Второй попап не открываем: две доски с одним состоянием разъехались
// бы, а игроку и одной достаточно.
let session = null;

export function isOpen() {
    return session !== null;
}

// Перерисовывает открытое окно. Нужно, когда настройки поменяли прямо во время партии:
// redraw() читает их сам, но без внешнего пинка ждал бы следующего хода.
export function refresh() {
    if (session?.state) redraw(session);
}

export async function openSudoku({ difficulty } = {}) {
    if (session) {
        logInfo('окно уже открыто');
        return;
    }

    const settings = getSettings();
    const level = difficulty || settings.difficulty;

    // Уровень указан явно (`/sudoku hard`) — игрок просит новую партию. Без аргумента
    // (кнопка в wand-меню, голая /sudoku) продолжаем незаконченную, если она есть.
    session = buildSession(level, { resume: !difficulty });

    // Попап ST раздаёт фокус уже после того, как вставит содержимое, поэтому свой
    // фокус ставим следующим тиком — иначе его перебьёт select уровня.
    setTimeout(() => session?.root.focus?.(), 0);

    try {
        await showPopup(session.root);
    } catch (err) {
        logError('не удалось показать попап', err);
    } finally {
        closeSession();
    }
}

function closeSession() {
    if (!session) return;
    clearInterval(session.timerId);
    session.detach?.();
    // Порядок важен: сначала останавливаем таймер, потом сохраняем — иначе в
    // extensionSettings уедет партия с «бегущим» startedAt, и время между закрытием
    // окна и следующим открытием засчиталось бы игроку.
    pauseTimer(session.state);
    persist(session);
    session = null;
}

// --- Сохранение партии
//
// Пишем после каждого хода и при закрытии окна. Сохранение идёт в extensionSettings
// через saveSettingsDebounced, поэтому серия быстрых ходов не превращается в серию
// записей на диск. Ошибка сохранения не должна ронять партию — только лог.

function persist(local) {
    if (!local?.state) return;
    try {
        const settings = getSettings();
        settings.savedGame = serializeGame(local.state);
        saveSettings();
    } catch (err) {
        logError('не удалось сохранить партию', err);
    }
}

// Возвращает незаконченную сохранённую партию или null. Решённую не восстанавливаем:
// открывать окно с уже собранной доской бессмысленно, игрок ждёт новую.
function restoreGame() {
    try {
        const saved = getSettings().savedGame;
        const state = deserializeGame(saved);
        if (!state || state.completedAt) return null;
        return state;
    } catch (err) {
        logError('не удалось восстановить партию', err);
        return null;
    }
}

function countGivens(state) {
    let givens = 0;
    for (const value of state.puzzle) if (value) givens++;
    return givens;
}

// --- Статистика по уровням
//
// Считается по заказанному уровню (`state.difficulty`), а не по оценённому генератором
// (`state.level`): в панели настроек игрок ищет ту строку, которую сам выбрал в
// селекторе, и не должен гадать, куда уехала партия из-за фолбэка генератора.
//
// Обновление статистики — побочная запись, а не ход: если оно упадёт, партия должна
// продолжаться как ни в чём не бывало, поэтому всё обёрнуто в try/catch.

function countGame(record) {
    try {
        const settings = getSettings();
        const result = record(settings.stats);
        saveSettings();
        renderStats();
        return result;
    } catch (err) {
        logError('не удалось обновить статистику', err);
        return null;
    }
}

// --- Сборка окна

function buildSession(level, { resume = false } = {}) {
    const root = document.createElement('div');
    root.className = 'sudoku-root';
    // Фокусируемый корень: попап ST при открытии сам ставит фокус на первый подходящий
    // элемент внутри, и без этого им оказывался select уровня.
    root.tabIndex = -1;

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

    const newGameBtn = document.createElement('div');
    newGameBtn.className = 'sudoku-btn menu_button';
    newGameBtn.textContent = 'Новая игра';

    header.append(levelSelect, timer, newGameBtn);

    const board = createBoard();

    const status = document.createElement('div');
    status.className = 'sudoku-status';

    const local = {
        root,
        board,
        timer,
        status,
        pad: null,
        remaining: null,
        state: null,
        timerId: null,
        // Выбранная клетка (индекс или null) и режим заметок — состояние ввода, а не
        // партии: в сохранение (Фаза 4) оно не уходит.
        selected: null,
        notesMode: false,
        givens: 0,
        detach: null,
    };

    // --- Ходы. Каждый меняет состояние и перерисовывает окно; проверка победы — в одном
    // --- месте, чтобы её нельзя было забыть в новой ветке ввода.

    const play = (mutate) => {
        if (!local.state || local.state.completedAt) return;
        if (mutate() === false) return;
        checkWin(local);
        redraw(local);
        persist(local);
    };

    const inputDigit = (digit) => play(() => {
        if (local.selected === null) return false;
        const settings = getSettings();
        if (local.notesMode) return toggleNote(local.state, local.selected, digit);
        return setValue(local.state, local.selected, digit, {
            autoCleanNotes: settings.autoCleanNotes,
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

    root.append(header, board.root, remaining.root, pad.root, status);

    const select = (idx) => {
        // Повторный клик по выбранной клетке снимает выделение — так проще убрать
        // подсветку, не целясь в пустое место за доской.
        local.selected = local.selected === idx ? null : idx;
        // Клик по клетке фокус не переносит (mousedown отменён, чтобы не выделялся
        // текст), поэтому уводим его на корень руками — иначе он останется на select.
        root.focus?.();
        redraw(local);
    };

    const detachPointer = attachPointer(board.root, select);
    const detachKeyboard = attachKeyboard(root, handlers);
    local.detach = () => {
        detachPointer();
        detachKeyboard();
    };

    // Общий вход и для новой партии, и для восстановленной: одинаково сбрасывает
    // состояние ввода, запускает таймер и сохраняется.
    const startGame = (state, givens) => {
        local.state = state;
        local.givens = givens;
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
        countGame((stats) => recordPlayed(stats, state.difficulty));
        startGame(state, generated.givens);
    };

    levelSelect.addEventListener('change', () => {
        const requested = levelSelect.value;
        const current = getSettings();
        current.difficulty = requested;
        saveSettings();
        startNewGame(requested);
    });

    newGameBtn.addEventListener('click', () => startNewGame(levelSelect.value));

    const restored = resume ? restoreGame() : null;
    if (restored) {
        // Селектор показывает уровень восстановленной партии, а не тот, что лежит
        // в настройках: иначе подпись врала бы про доску на экране.
        if (restored.difficulty in LEVEL_LABELS) levelSelect.value = restored.difficulty;
        startGame(restored, countGivens(restored));
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
    const isBest = countGame((stats) => recordSolved(stats, difficulty, elapsed));

    const time = formatElapsed(elapsed);
    toast('success', isBest ? `Решено за ${time} — лучшее время!` : `Решено за ${time}`);
    logInfo(`партия решена (${local.state.level}, ${time}${isBest ? ', рекорд' : ''})`);
}

function redraw(local) {
    const settings = getSettings();
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
    const parts = [`${level} · подсказок: ${local.givens}`];
    if (local.notesMode) parts.push('режим заметок');
    return parts.join(' · ');
}

function updateTimer(local) {
    const settings = getSettings();
    local.timer.classList.toggle('sudoku-hidden', !settings.showTimer);
    if (!settings.showTimer) return;
    local.timer.textContent = formatElapsed(getElapsedMs(local.state));
}

// --- Попап

async function showPopup(content) {
    const ctx = getCtx();

    if (typeof ctx.callGenericPopup === 'function') {
        // DISPLAY — попап без кнопок, только крестик в углу; числовое значение на случай,
        // если POPUP_TYPE в этой версии ST не экспортирован.
        const DISPLAY = ctx.POPUP_TYPE?.DISPLAY ?? 4;
        return ctx.callGenericPopup(content, DISPLAY, '', {
            wider: true,
            allowVerticalScrolling: true,
            animation: 'fast',
        });
    }

    return showFallbackOverlay(content);
}

// Свой оверлей на случай, когда попапа ST нет. Умеет ровно то же, что нужно игре:
// закрытие по крестику, по клику мимо доски и по Esc.
function showFallbackOverlay(content) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'sudoku-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'sudoku-dialog';

        const close = document.createElement('div');
        close.className = 'sudoku-close fa-solid fa-circle-xmark';
        close.setAttribute('role', 'button');
        close.setAttribute('aria-label', 'Закрыть');

        dialog.append(close, content);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const finish = () => {
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
            resolve();
        };

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                finish();
            }
        }

        close.addEventListener('click', finish);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) finish();
        });
        document.addEventListener('keydown', onKeyDown, true);
    });
}
