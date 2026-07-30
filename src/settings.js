// Настройки Sudoku: extensionSettings.Sudoku (camelCase-поле контекста ST),
// с мержем недостающих ключей при апгрейде.

import { getCtx } from './ctx.js';
import { logError, logInfo } from './log.js';

export const MODULE_NAME = 'Sudoku';

export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'expert']);

export const DEFAULT_SETTINGS = Object.freeze({
    // Уровень, с которым стартует новая партия из кнопки запуска.
    difficulty: 'medium',
    // Подсвечивать клетки, конфликтующие по строке/столбцу/боксу.
    highlightConflicts: true,
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
    bindCheckbox('#sudoku_auto_clean_notes', 'autoCleanNotes');
    bindCheckbox('#sudoku_show_timer', 'showTimer');

    logInfo('панель настроек инициализирована');
}
