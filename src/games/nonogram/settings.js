// Настройки нонограммы: дефолты, подписи и отрисовка панели. Общий модуль настроек
// хаба остаётся игро-агностичным, всё, что знает о нонограмме, живёт здесь.

import { getGameSettings } from '../../settings.js';
import { checkbox, row, select } from '../../shell/settings-ui.js';
import { BOARDS } from './core/generator.js';
import { isEmpty, readEntry, resetStats } from './core/stats.js';

export const LEVELS = Object.freeze(Object.keys(BOARDS));

export const NONOGRAM_DEFAULTS = Object.freeze({
    level: 'easy',
    showTimer: true,
    // Подсветка неверно закрашенных клеток. По умолчанию выключена: нонограмма решается
    // рассуждением, и красная клетка выдаёт вывод, до которого игрок ещё не дошёл.
    highlightMistakes: false,
    // Статистика по уровням: { [level]: { played, wins, bestTime } }.
    stats: {},
    // Текущая партия. null = партии нет.
    savedGame: null,
});

export const LEVEL_LABELS = Object.freeze({
    easy: 'Лёгкий',
    medium: 'Средний',
    hard: 'Сложный',
});

export function getNonogramSettings() {
    return getGameSettings('nonogram', NONOGRAM_DEFAULTS);
}

export function normalizeLevel(value) {
    return LEVELS.includes(value) ? value : NONOGRAM_DEFAULTS.level;
}

// Подпись уровня вместе с размером поля: у нонограммы уровень — это ровно размер, и без
// него выбор делается вслепую.
export function levelLabel(level) {
    const board = BOARDS[level];
    const name = LEVEL_LABELS[level] ?? level;
    return board ? `${name} (${board.cols}×${board.rows})` : name;
}

export function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

// --- Панель настроек

export function renderNonogramSettings(container, api) {
    if (!container) return;
    const settings = getNonogramSettings();

    container.appendChild(row('Размер', select(
        'nonogram_level',
        LEVELS.map((level) => [level, levelLabel(level)]),
        settings.level,
        (value) => {
            const s = getNonogramSettings();
            s.level = normalizeLevel(value);
            api.save();
            api.onSettingsChanged?.(s);
        },
    )));

    container.appendChild(checkbox(
        'nonogram_highlight_mistakes',
        'Подсвечивать неверные клетки',
        settings.highlightMistakes,
        (checked) => {
            const s = getNonogramSettings();
            s.highlightMistakes = checked;
            api.save();
            api.onSettingsChanged?.(s);
        },
    ));

    container.appendChild(checkbox('nonogram_show_timer', 'Показывать таймер', settings.showTimer, (checked) => {
        const s = getNonogramSettings();
        s.showTimer = checked;
        api.save();
        api.onSettingsChanged?.(s);
    }));
}

// --- Статистика

export function renderNonogramStats(container, api) {
    if (!container) return;
    container.textContent = '';

    const stats = getNonogramSettings().stats;

    const header = document.createElement('div');
    header.className = 'stg-row nonogram-stats-header';

    const title = document.createElement('b');
    title.textContent = 'Статистика';

    const reset = document.createElement('div');
    reset.id = 'nonogram_stats_reset';
    reset.className = 'menu_button';
    reset.title = 'Обнулить статистику';
    reset.textContent = 'Сбросить';
    reset.addEventListener('click', () => {
        const s = getNonogramSettings();
        resetStats(s.stats);
        api.save();
        api.renderAllStats();
    });

    header.append(title, reset);

    const table = document.createElement('div');
    table.id = 'nonogram_stats';
    table.className = 'nonogram-stats';

    const hint = document.createElement('small');
    hint.id = 'nonogram_stats_hint';
    hint.textContent = 'Партия засчитывается в «сыграно» с первой отметки на поле — и собранная, и брошенная.';

    container.append(header, table, hint);

    table.appendChild(buildRow(['Размер', 'Сыграно', 'Собрано', 'Лучшее время'], 'nonogram-stats-head'));
    for (const level of LEVELS) {
        const { played, wins, bestTime } = readEntry(stats, level);
        table.appendChild(buildRow([
            LEVEL_LABELS[level] ?? level,
            String(played),
            String(wins),
            bestTime === null ? '—' : formatTime(bestTime),
        ]));
    }

    const empty = isEmpty(stats);
    toggleVisible(reset, !empty);
    toggleVisible(hint, empty);
}

function toggleVisible(element, visible) {
    if (element) element.style.display = visible ? '' : 'none';
}

function buildRow(cells, className) {
    const div = document.createElement('div');
    div.className = className ? `nonogram-stats-row ${className}` : 'nonogram-stats-row';
    for (const text of cells) {
        const cell = document.createElement('span');
        cell.textContent = text;
        div.appendChild(cell);
    }
    return div;
}
