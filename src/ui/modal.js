// Модальное окно с игрой. Здесь живёт вся связь с SillyTavern: попап, настройки, тосты.
//
// Основной путь — ctx.callGenericPopup(..., POPUP_TYPE.DISPLAY): попап без кнопок, с
// крестиком в углу и закрытием по Esc. Если попапа в этой версии ST нет (или он упал),
// показывается собственный оверлей .sudoku-overlay — расширение не должно зависеть от
// того, что внутренний API таверны останется прежним.

import { getCtx } from '../ctx.js';
import { logError, logInfo } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { generatePuzzle } from '../core/generator.js';
import {
    createGame,
    formatElapsed,
    getElapsedMs,
    pauseTimer,
    startTimer,
} from '../core/game.js';
import { createBoard } from './board.js';

const LEVEL_LABELS = Object.freeze({
    easy: 'Лёгкий',
    medium: 'Средний',
    hard: 'Сложный',
    expert: 'Эксперт',
});

const TIMER_TICK_MS = 1000;

// Открытая партия. Второй попап не открываем: две доски с одним состоянием разъехались
// бы, а игроку и одной достаточно.
let session = null;

export function isOpen() {
    return session !== null;
}

export async function openSudoku({ difficulty } = {}) {
    if (session) {
        logInfo('окно уже открыто');
        return;
    }

    const settings = getSettings();
    const level = difficulty || settings.difficulty;

    session = buildSession(level);

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
    pauseTimer(session.state);
    session = null;
}

// --- Сборка окна

function buildSession(level) {
    const root = document.createElement('div');
    root.className = 'sudoku-root';

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

    root.append(header, board.root, status);

    const local = {
        root,
        board,
        timer,
        status,
        state: null,
        timerId: null,
    };

    const startNewGame = (requested) => {
        const generated = generatePuzzle({ difficulty: requested });
        local.state = createGame(generated);
        startTimer(local.state);

        if (!generated.exact) {
            // Генератор не смог попасть в заказанный уровень за отведённые попытки и
            // отдал ближайший. Молчать нельзя: игрок выбирал другую сложность.
            logInfo(`заказан уровень ${requested}, получен ${generated.level}`);
        }
        redraw(local, generated);
    };

    levelSelect.addEventListener('change', () => {
        const requested = levelSelect.value;
        const current = getSettings();
        current.difficulty = requested;
        saveSettings();
        startNewGame(requested);
    });

    newGameBtn.addEventListener('click', () => startNewGame(levelSelect.value));

    startNewGame(level);

    local.timerId = setInterval(() => {
        if (!local.state) return;
        updateTimer(local);
    }, TIMER_TICK_MS);

    return local;
}

function redraw(local, generated = null) {
    const settings = getSettings();
    local.board.render(local.state, { highlightConflicts: settings.highlightConflicts });
    updateTimer(local);

    const level = LEVEL_LABELS[local.state.level] ?? local.state.level;
    const givens = generated ? generated.givens : local.state.puzzle.filter(Boolean).length;
    local.status.textContent = `${level} · подсказок: ${givens}`;
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
