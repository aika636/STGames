// Общая панель настроек хаба: каркас из settings.html + по блоку на каждую
// зарегистрированную игру. Игры рисуют свои контролы и статистику сами
// (renderSettings/renderStats из контракта реестра), а этот модуль только создаёт
// контейнеры и раздаёт api.

import { toast } from '../ctx.js';
import { logError, logInfo } from '../log.js';
import { getAppearance, getGameSettings, saveSettings, setAppearance } from '../settings.js';
import { list } from '../registry.js';
import { APPEARANCE_OPTIONS } from './appearance.js';

// onSettingsChanged из index.js: открытое окно игры перерисовывается после каждого
// изменения настроек. Держится на уровне модуля, чтобы попасть в каждый api.
let settingsChanged = null;

export async function initSettingsUI(onSettingsChanged) {
    settingsChanged = onSettingsChanged;

    try {
        // import.meta.url внутри src/shell/settings-ui.js резолвится относительно
        // src/shell/, поэтому путь к settings.html (лежит в корне расширения) —
        // на два уровня выше.
        const settingsHtml = await $.get(new URL('../../settings.html', import.meta.url).href);
        $('#extensions_settings').append(settingsHtml);
    } catch (err) {
        logError('не удалось загрузить settings.html', err);
        return;
    }

    renderCommonSettings(document.getElementById('stgames_settings_common'));

    const container = document.getElementById('stgames_settings_games');
    if (!container) return;

    for (const game of list()) {
        try {
            const section = document.createElement('div');
            section.className = 'stg-game-settings';

            const heading = document.createElement('b');
            heading.textContent = game.title;
            section.appendChild(heading);

            // Настройки и статистика — в отдельных контейнерах: renderAllStats()
            // перерисовывает только статистику, не трогая контролы.
            const settingsBox = document.createElement('div');
            const statsBox = document.createElement('div');
            statsBox.id = `stg_stats_${game.id}`;
            section.append(settingsBox, statsBox);

            game.renderSettings?.(settingsBox, makeApi(game));
            game.renderStats?.(statsBox, makeApi(game));
            container.appendChild(section);
        } catch (err) {
            // Сломанная панель одной игры не должна ронять панель целиком.
            logError(`не удалось отрисовать настройки игры ${game.id}`, err);
        }
    }

    logInfo('панель настроек инициализирована');
}

// Общий блок настроек — то, что относится ко всем играм сразу. Пока в нём одно
// оформление; лежит выше блоков игр, потому что это единственная настройка, которую
// ищут, когда игру физически не видно на своей теме ST.
//
// Экспортируется ради тестов: панель целиком требует $.get и #extensions_settings, а
// этот блок — обычный контейнер.
export function renderCommonSettings(container) {
    if (!container) return;
    container.textContent = '';

    const section = document.createElement('div');
    section.className = 'stg-common-settings';

    const heading = document.createElement('b');
    heading.textContent = 'Оформление';
    section.appendChild(heading);

    const control = select('stgames_appearance', APPEARANCE_OPTIONS, getAppearance(), (value) => {
        if (!setAppearance(value)) return;
        // Окно могло быть открыто в этот момент — тот же пинок, что и у настроек игр.
        settingsChanged?.();
    });
    section.appendChild(row('Палитра игр', control));

    const hint = document.createElement('small');
    hint.className = 'stg-settings-hint';
    hint.textContent = 'Авто выбирает светлую или тёмную палитру по яркости темы таверны. '
        + '«Цвета таверны» — оформление как раньше, цветами темы ST.';
    section.appendChild(hint);

    container.appendChild(section);
}

// Перерисовывает блоки статистики всех игр. Окно игры зовёт её после каждой
// засчитанной партии — как раньше звал renderStats().
export function renderAllStats() {
    for (const game of list()) {
        const statsBox = document.getElementById(`stg_stats_${game.id}`);
        if (!statsBox) continue;
        try {
            game.renderStats?.(statsBox, makeApi(game));
        } catch (err) {
            logError(`не удалось отрисовать статистику игры ${game.id}`, err);
        }
    }
}

function makeApi(game) {
    return {
        settings: getGameSettings(game.id, game.defaults),
        save: saveSettings,
        toast,
        renderAllStats,
        onSettingsChanged: settingsChanged,
    };
}

// --- Помощники разметки
//
// Строят те же контролы, что были в старом settings.html (.checkbox_label,
// .text_pole, .menu_button — классы SillyTavern), чтобы игры собирали панель
// без дублирования разметки.

export function row(labelText, control) {
    const div = document.createElement('div');
    div.className = 'stg-row';
    const label = document.createElement('label');
    label.setAttribute('for', control.id);
    label.textContent = labelText;
    div.append(label, control);
    return div;
}

export function checkbox(id, labelText, checked, onChange) {
    const div = document.createElement('div');
    div.className = 'stg-row';

    const label = document.createElement('label');
    label.className = 'checkbox_label';
    label.setAttribute('for', id);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    input.addEventListener('change', () => onChange?.(input.checked));

    const span = document.createElement('span');
    span.textContent = labelText;

    label.append(input, span);
    div.appendChild(label);
    return div;
}

export function select(id, options, value, onChange) {
    const el = document.createElement('select');
    el.id = id;
    el.className = 'text_pole';
    for (const [optionValue, optionLabel] of options) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionLabel;
        el.appendChild(option);
    }
    el.value = value;
    el.addEventListener('change', () => onChange?.(el.value));
    return el;
}
