// Настройки Sudoku: extensionSettings.Sudoku (camelCase-поле контекста ST),
// с мержем недостающих ключей при апгрейде.

import { getCtx } from './ctx.js';
import { logError, logInfo } from './log.js';
import { formatElapsed } from './core/game.js';
import { isEmpty, readEntry, resetStats } from './core/stats.js';

export const MODULE_NAME = 'Sudoku';

export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'expert']);

// Подписи уровней живут здесь, а не в modal.js: их показывают оба — и окно игры,
// и таблица статистики в панели настроек.
export const LEVEL_LABELS = Object.freeze({
    easy: 'Лёгкий',
    medium: 'Средний',
    hard: 'Сложный',
    expert: 'Эксперт',
});

export const DEFAULT_SETTINGS = Object.freeze({
    // Уровень, с которым стартует новая партия из кнопки запуска.
    difficulty: 'medium',
    // Подсвечивать клетки, конфликтующие по строке/столбцу/боксу.
    highlightConflicts: true,
    // Подсвечивать цифры, не совпадающие с решением. По умолчанию выключено: это
    // подсказка от игры, а не свойство доски — конфликт игрок может увидеть сам,
    // а ошибку в непротиворечивой позиции — нет.
    highlightMistakes: false,
    // Убирать цифру из заметок соседних клеток, когда она проставлена как значение.
    autoCleanNotes: true,
    showTimer: true,
    // Текущая партия (см. Фазу 4). null = партии нет.
    savedGame: null,
    // Статистика по уровням: { [difficulty]: { played, solved, bestTimeMs } }.
    stats: {},
});

// Возвращает живой (не клонированный) объект настроек, создавая его при первом
// обращении и добавляя недостающие ключи после апгрейдов, чтобы никогда не остаться
// с undefined-полями.
export function getSettings() {
    const ctx = getCtx();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const settings = ctx.extensionSettings[MODULE_NAME];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = structuredClone(DEFAULT_SETTINGS[key]);
        }
    }
    return settings;
}

export function saveSettings() {
    getCtx().saveSettingsDebounced();
}

// Загружает settings.html и подключает контролы. onSettingsChanged(settings) вызывается
// после каждого изменения — чтобы UI игры мог отреагировать, не импортируя settings.js
// в обратную сторону.
export async function initSettingsUI(onSettingsChanged) {
    try {
        // import.meta.url внутри src/settings.js резолвится относительно src/, поэтому
        // путь к settings.html (лежит в корне расширения) — на уровень выше.
        const settingsHtml = await $.get(new URL('../settings.html', import.meta.url).href);
        $('#extensions_settings').append(settingsHtml);
    } catch (err) {
        logError('не удалось загрузить settings.html', err);
        return;
    }

    const settings = getSettings();

    const bindCheckbox = (selector, key) => {
        const $el = $(selector);
        $el.prop('checked', settings[key]);
        $el.on('change', function () {
            const s = getSettings();
            s[key] = this.checked;
            saveSettings();
            onSettingsChanged?.(s);
        });
    };

    const $difficulty = $('#sudoku_difficulty');
    $difficulty.val(settings.difficulty);
    $difficulty.on('change', function () {
        const s = getSettings();
        // Значение из <select> приходит строкой; чужие значения не пускаем в настройки.
        s.difficulty = DIFFICULTIES.includes(this.value) ? this.value : DEFAULT_SETTINGS.difficulty;
        saveSettings();
        onSettingsChanged?.(s);
    });

    bindCheckbox('#sudoku_highlight_conflicts', 'highlightConflicts');
    bindCheckbox('#sudoku_highlight_mistakes', 'highlightMistakes');
    bindCheckbox('#sudoku_auto_clean_notes', 'autoCleanNotes');
    bindCheckbox('#sudoku_show_timer', 'showTimer');

    $('#sudoku_stats_reset').on('click', () => {
        const s = getSettings();
        resetStats(s.stats);
        saveSettings();
        renderStats();
    });

    renderStats();

    logInfo('панель настроек инициализирована');
}

// --- Статистика
//
// Панель настроек рисуется один раз при загрузке, а статистика меняется по ходу игры,
// поэтому окно игры зовёт renderStats() после каждой засчитанной партии. Если панели
// в DOM нет (settings.html не загрузился), функция молча ничего не делает.

export function renderStats() {
    const table = document.getElementById('sudoku_stats');
    if (!table) return;

    const stats = getSettings().stats;
    const rows = DIFFICULTIES.map((difficulty) => {
        const { played, solved, bestTimeMs } = readEntry(stats, difficulty);
        return [
            LEVEL_LABELS[difficulty] ?? difficulty,
            String(played),
            String(solved),
            bestTimeMs === null ? '—' : formatElapsed(bestTimeMs),
        ];
    });

    table.textContent = '';
    table.appendChild(buildRow(['Уровень', 'Сыграно', 'Решено', 'Лучшее'], 'sudoku-stats-head'));
    for (const row of rows) table.appendChild(buildRow(row));

    // Кнопка сброса без единой партии бессмысленна и только сбивает с толку; вместо
    // неё показывается пояснение, что именно считается сыгранной партией.
    // Здесь голый DOM, а не jQuery: renderStats() зовёт и окно игры, и хочется, чтобы
    // функция работала (и тестировалась) без предположений про глобальный $.
    const empty = isEmpty(stats);
    toggleVisible(document.getElementById('sudoku_stats_reset'), !empty);
    toggleVisible(document.getElementById('sudoku_stats_hint'), empty);
}

function toggleVisible(element, visible) {
    if (element) element.style.display = visible ? '' : 'none';
}

function buildRow(cells, className) {
    const row = document.createElement('div');
    row.className = className ? `sudoku-stats-row ${className}` : 'sudoku-stats-row';
    for (const text of cells) {
        const cell = document.createElement('span');
        cell.textContent = text;
        row.appendChild(cell);
    }
    return row;
}
