// Настройки балды: дефолты, подписи, панель и таблица статистики. Общий модуль
// настроек хаба остаётся игро-агностичным — всё, что знает про эту игру, живёт здесь.

import { getGameSettings } from '../../settings.js';
import { row, select } from '../../shell/settings-ui.js';
import { isEmpty, readEntry, resetStats } from './core/stats.js';

export const LEVELS = Object.freeze(['easy', 'medium', 'hard']);
export const STARTS = Object.freeze(['human', 'ai']);

// Замораживает реестр при регистрации; Object.freeze здесь — для симметрии с остальными
// играми и чтобы модуль был честен сам по себе.
export const BALDA_DEFAULTS = Object.freeze({
    level: 'medium',
    // Кто ходит первым. Размер поля настройкой не сделан намеренно: 5×5 — канон балды,
    // а поле 7×7 требует семибуквенного загаданного слова и не помещается на телефоне
    // вместе с клавиатурой (грабли Фазы 5 — см. блок .balda-root в style.css).
    playFirst: 'human',
    // Статистика по уровням: { [level]: { played, wins, losses, draws, bestScore } }.
    stats: {},
    // Текущая партия. null = партии нет.
    savedGame: null,
});

export const LEVEL_LABELS = Object.freeze({
    easy: 'Лёгкий',
    medium: 'Средний',
    hard: 'Сложный',
});

export const START_LABELS = Object.freeze({
    human: 'Вы',
    ai: 'Соперник',
});

export function getBaldaSettings() {
    return getGameSettings('balda', BALDA_DEFAULTS);
}

// Уровень, пригодный для настроек: чужое значение (правка файла руками, аргумент
// слэш-команды) сводится к дефолту, а не уезжает в настройки и в ключи статистики.
export function normalizeLevel(value) {
    return LEVELS.includes(value) ? value : BALDA_DEFAULTS.level;
}

export function normalizeStart(value) {
    return STARTS.includes(value) ? value : BALDA_DEFAULTS.playFirst;
}

// --- Панель настроек
//
// Контролы строятся хелперами оболочки, а не своей разметкой: блоки игр в одной панели
// должны выглядеть одинаково.

export function renderBaldaSettings(container, api) {
    if (!container) return;
    const settings = getBaldaSettings();

    container.appendChild(row('Уровень соперника', select(
        'balda_level',
        LEVELS.map((level) => [level, LEVEL_LABELS[level]]),
        settings.level,
        (value) => {
            const s = getBaldaSettings();
            s.level = normalizeLevel(value);
            api.save();
            // Уровень применяется к текущей партии сразу: он влияет только на выбор слова
            // соперником, а не на позицию.
            api.onSettingsChanged?.(s);
        },
    )));

    container.appendChild(row('Первый ход', select(
        'balda_play_first',
        STARTS.map((who) => [who, START_LABELS[who]]),
        settings.playFirst,
        (value) => {
            const s = getBaldaSettings();
            s.playFirst = normalizeStart(value);
            api.save();
            // Очередь подхватит следующая партия: менять её посреди игры бессмысленно.
            api.onSettingsChanged?.(s);
        },
    )));
}

// --- Статистика
//
// renderAllStats() зовёт этот рендер заново после каждой засчитанной партии, поэтому
// блок строится целиком с нуля. Если панели в DOM нет, функция молча ничего не делает.

export function renderBaldaStats(container, api) {
    if (!container) return;
    container.textContent = '';

    const stats = getBaldaSettings().stats;

    const header = document.createElement('div');
    header.className = 'stg-row balda-stats-header';

    const title = document.createElement('b');
    title.textContent = 'Статистика';

    const reset = document.createElement('div');
    reset.id = 'balda_stats_reset';
    reset.className = 'menu_button';
    reset.title = 'Обнулить статистику';
    reset.textContent = 'Сбросить';
    reset.addEventListener('click', () => {
        const s = getBaldaSettings();
        resetStats(s.stats);
        api.save();
        api.renderAllStats();
    });

    header.append(title, reset);

    const table = document.createElement('div');
    table.id = 'balda_stats';
    table.className = 'balda-stats';

    const hint = document.createElement('small');
    hint.id = 'balda_stats_hint';
    hint.textContent = 'Партия засчитывается в «сыграно», как только слово загадано, — и доигранная, и брошенная.';

    container.append(header, table, hint);

    table.appendChild(buildRow(['Уровень', 'Сыграно', 'Побед', 'Поражений', 'Ничьих', 'Рекорд'], 'balda-stats-head'));
    for (const level of LEVELS) {
        const { played, wins, losses, draws, bestScore } = readEntry(stats, level);
        table.appendChild(buildRow([
            LEVEL_LABELS[level] ?? level,
            String(played),
            String(wins),
            String(losses),
            String(draws),
            bestScore === null ? '—' : String(bestScore),
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
    div.className = className ? `balda-stats-row ${className}` : 'balda-stats-row';
    for (const text of cells) {
        const cell = document.createElement('span');
        cell.textContent = text;
        div.appendChild(cell);
    }
    return div;
}
