// Настройки кроссворда-скелета: дефолты, подписи и отрисовка панели. Общий модуль
// настроек хаба остаётся игро-агностичным, всё, что знает о кроссворде, живёт здесь.
//
// Размеры уровней продублированы здесь константой, а не читаются из пула: панель
// настроек рисуется при загрузке ST, а пул (82 КБ) грузится динамическим import()
// только при первом открытии игры. Тянуть данные ради подписи «7×7» незачем;
// сходимость с пулом проверяется тестом.

import { getGameSettings } from '../../settings.js';
import { checkbox, row, select } from '../../shell/settings-ui.js';
import { LEVELS } from './core/puzzles.js';
import { isEmpty, readEntry, resetStats } from './core/stats.js';

export { LEVELS };

export const LEVEL_SIZES = Object.freeze({ easy: 7, medium: 9, hard: 11 });

export const CROSSWORD_DEFAULTS = Object.freeze({
    level: 'easy',
    showTimer: true,
    // Подсветка слов и клеток, расходящихся с решением. По умолчанию выключена:
    // кроссворд-скелет решается рассуждением, и красная клетка выдаёт вывод, до
    // которого игрок ещё не дошёл. Тот же уговор, что в судоку и нонограмме.
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

export function getCrosswordSettings() {
    return getGameSettings('crossword', CROSSWORD_DEFAULTS);
}

export function normalizeLevel(value) {
    return LEVELS.includes(value) ? value : CROSSWORD_DEFAULTS.level;
}

// Подпись уровня вместе с размером сетки: уровень у кроссворда — это ровно размер,
// и без него выбор делается вслепую (как у нонограммы и сапёра).
export function levelLabel(level) {
    const name = LEVEL_LABELS[level] ?? level;
    const side = LEVEL_SIZES[level];
    return side ? `${name} (${side}×${side})` : name;
}

export function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

// --- Панель настроек

export function renderCrosswordSettings(container, api) {
    if (!container) return;
    const settings = getCrosswordSettings();

    container.appendChild(row('Размер', select(
        'crossword_level',
        LEVELS.map((level) => [level, levelLabel(level)]),
        settings.level,
        (value) => {
            const s = getCrosswordSettings();
            s.level = normalizeLevel(value);
            api.save();
            api.onSettingsChanged?.(s);
        },
    )));

    container.appendChild(checkbox(
        'crossword_highlight_mistakes',
        'Подсвечивать неверные слова',
        settings.highlightMistakes,
        (checked) => {
            const s = getCrosswordSettings();
            s.highlightMistakes = checked;
            api.save();
            api.onSettingsChanged?.(s);
        },
    ));

    container.appendChild(checkbox('crossword_show_timer', 'Показывать таймер', settings.showTimer, (checked) => {
        const s = getCrosswordSettings();
        s.showTimer = checked;
        api.save();
        api.onSettingsChanged?.(s);
    }));
}

// --- Статистика

export function renderCrosswordStats(container, api) {
    if (!container) return;
    container.textContent = '';

    const stats = getCrosswordSettings().stats;

    const header = document.createElement('div');
    header.className = 'stg-row crossword-stats-header';

    const title = document.createElement('b');
    title.textContent = 'Статистика';

    const reset = document.createElement('div');
    reset.id = 'crossword_stats_reset';
    reset.className = 'menu_button';
    reset.title = 'Обнулить статистику';
    reset.textContent = 'Сбросить';
    reset.addEventListener('click', () => {
        const s = getCrosswordSettings();
        resetStats(s.stats);
        api.save();
        api.renderAllStats();
    });

    header.append(title, reset);

    const table = document.createElement('div');
    table.id = 'crossword_stats';
    table.className = 'crossword-stats';

    const hint = document.createElement('small');
    hint.id = 'crossword_stats_hint';
    hint.textContent = 'Партия засчитывается в «сыграно» с первого разложенного слова — и собранная, и брошенная.';

    container.append(header, table, hint);

    table.appendChild(buildRow(['Размер', 'Сыграно', 'Собрано', 'Лучшее время'], 'crossword-stats-head'));
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
    div.className = className ? `crossword-stats-row ${className}` : 'crossword-stats-row';
    for (const text of cells) {
        const cell = document.createElement('span');
        cell.textContent = text;
        div.appendChild(cell);
    }
    return div;
}
