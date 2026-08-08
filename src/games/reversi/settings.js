// Настройки реверси: дефолты, подписи и отрисовка панели — контролы и таблица
// статистики. Общий модуль настроек хаба остаётся игро-агностичным, всё, что знает
// о реверси, живёт здесь.

import { getGameSettings } from '../../settings.js';
import { checkbox, row, select } from '../../shell/settings-ui.js';
import { BLACK, WHITE } from './core/engine.js';
import { isEmpty, readEntry, resetStats } from './core/stats.js';

export const LEVELS = Object.freeze(['easy', 'medium', 'hard']);
export const COLORS = Object.freeze(['black', 'white']);

// Замораживает реестр при регистрации; здесь Object.freeze стоит для симметрии с
// остальными играми и чтобы модуль был честен сам по себе.
export const REVERSI_DEFAULTS = Object.freeze({
    level: 'medium',
    playAs: 'black',
    showHints: true,
    // Статистика по уровням: { [level]: { played, wins, losses, draws, bestDiff } }.
    stats: {},
    // Текущая партия. null = партии нет.
    savedGame: null,
});

export const LEVEL_LABELS = Object.freeze({
    easy: 'Лёгкий',
    medium: 'Средний',
    hard: 'Сложный',
});

export const COLOR_LABELS = Object.freeze({
    black: 'Чёрными',
    white: 'Белыми',
});

// Цвет игрока из настройки. Всё, что не 'white', — чёрные: чёрные ходят первыми, и это
// же поведение достаётся битому значению в settings.json.
export function humanColor(playAs) {
    return playAs === 'white' ? WHITE : BLACK;
}

export function getReversiSettings() {
    return getGameSettings('reversi', REVERSI_DEFAULTS);
}

// Уровень, пригодный для настроек: чужое значение (правка файла руками, аргумент
// слэш-команды) сводится к дефолту, а не уезжает в настройки и в ключи статистики.
export function normalizeLevel(value) {
    return LEVELS.includes(value) ? value : REVERSI_DEFAULTS.level;
}

// --- Панель настроек
//
// Контролы строятся хелперами оболочки, а не своей разметкой: блоки игр в одной панели
// должны выглядеть одинаково.

export function renderReversiSettings(container, api) {
    if (!container) return;
    const settings = getReversiSettings();

    container.appendChild(row('Уровень соперника', select(
        'reversi_level',
        LEVELS.map((level) => [level, LEVEL_LABELS[level]]),
        settings.level,
        (value) => {
            const s = getReversiSettings();
            s.level = normalizeLevel(value);
            api.save();
            // Уровень применяется к текущей партии сразу: он влияет только на глубину
            // перебора соперника, а не на позицию.
            api.onSettingsChanged?.(s);
        },
    )));

    container.appendChild(row('Играть', select(
        'reversi_play_as',
        COLORS.map((color) => [color, COLOR_LABELS[color]]),
        settings.playAs,
        (value) => {
            const s = getReversiSettings();
            s.playAs = COLORS.includes(value) ? value : REVERSI_DEFAULTS.playAs;
            api.save();
            // Цвет подхватит следующая партия: менять сторону посреди игры бессмысленно.
            api.onSettingsChanged?.(s);
        },
    )));

    container.appendChild(checkbox('reversi_show_hints', 'Подсвечивать доступные ходы', settings.showHints, (checked) => {
        const s = getReversiSettings();
        s.showHints = checked;
        api.save();
        api.onSettingsChanged?.(s);
    }));
}

// --- Статистика
//
// renderAllStats() зовёт этот рендер заново после каждой засчитанной партии, поэтому
// блок строится целиком с нуля. Если панели в DOM нет, функция молча ничего не делает.

export function renderReversiStats(container, api) {
    if (!container) return;
    container.textContent = '';

    const stats = getReversiSettings().stats;

    const header = document.createElement('div');
    header.className = 'stg-row reversi-stats-header';

    const title = document.createElement('b');
    title.textContent = 'Статистика';

    const reset = document.createElement('div');
    reset.id = 'reversi_stats_reset';
    reset.className = 'menu_button';
    reset.title = 'Обнулить статистику';
    reset.textContent = 'Сбросить';
    reset.addEventListener('click', () => {
        const s = getReversiSettings();
        resetStats(s.stats);
        api.save();
        api.renderAllStats();
    });

    header.append(title, reset);

    const table = document.createElement('div');
    table.id = 'reversi_stats';
    table.className = 'reversi-stats';

    const hint = document.createElement('small');
    hint.id = 'reversi_stats_hint';
    hint.textContent = 'Партия засчитывается в «сыграно», как только доска создана, — и доигранная, и брошенная.';

    container.append(header, table, hint);

    table.appendChild(buildRow(['Уровень', 'Сыграно', 'Побед', 'Поражений', 'Ничьих', 'Разрыв'], 'reversi-stats-head'));
    for (const level of LEVELS) {
        const { played, wins, losses, draws, bestDiff } = readEntry(stats, level);
        table.appendChild(buildRow([
            LEVEL_LABELS[level] ?? level,
            String(played),
            String(wins),
            String(losses),
            String(draws),
            bestDiff === null ? '—' : `+${bestDiff}`,
        ]));
    }

    // Кнопка сброса без единой партии бессмысленна и только сбивает с толку; вместо неё
    // показывается пояснение, что именно считается сыгранной партией.
    const empty = isEmpty(stats);
    toggleVisible(reset, !empty);
    toggleVisible(hint, empty);
}

function toggleVisible(element, visible) {
    if (element) element.style.display = visible ? '' : 'none';
}

function buildRow(cells, className) {
    const div = document.createElement('div');
    div.className = className ? `reversi-stats-row ${className}` : 'reversi-stats-row';
    for (const text of cells) {
        const cell = document.createElement('span');
        cell.textContent = text;
        div.appendChild(cell);
    }
    return div;
}
