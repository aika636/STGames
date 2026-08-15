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
            container.appendChild(renderGameSection(game));
        } catch (err) {
            // Сломанная панель одной игры не должна ронять панель целиком.
            logError(`не удалось отрисовать настройки игры ${game.id}`, err);
        }
    }

    logInfo('панель настроек инициализирована');
}

// Блок одной игры — сворачиваемая секция: шапка с иконкой, названием и подзаголовком
// из реестра, внутри — контролы и статистика. Свёрнуто по умолчанию: восемь игр,
// развёрнутых разом, и были той «стеной настроек», в которой ничего не найти.
//
// Свой тоггл, а не .inline-drawer таверны: панель собирается в голом DOM и должна
// открываться в тестах под jsdom, где обработчиков ST нет.
//
// Экспортируется ради тестов — так же, как renderCommonSettings.
export function renderGameSection(game) {
    const section = document.createElement('div');
    section.className = 'stg-game-settings';
    section.dataset.gameId = game.id;

    const body = document.createElement('div');
    body.className = 'stg-game-body';
    body.id = `stg_game_body_${game.id}`;
    body.hidden = true;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'stg-game-toggle';
    toggle.id = `stg_game_toggle_${game.id}`;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', body.id);

    const icon = document.createElement('i');
    icon.className = `fa-solid ${game.icon ?? 'fa-gamepad'} stg-game-icon`;
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'stg-game-label';

    const title = document.createElement('b');
    title.textContent = game.title;
    label.appendChild(title);

    if (game.tagline) {
        const tagline = document.createElement('small');
        tagline.className = 'stg-game-tagline';
        tagline.textContent = game.tagline;
        label.appendChild(tagline);
    }

    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-down stg-game-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    toggle.append(icon, label, chevron);
    toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        body.hidden = open;
        section.classList.toggle('stg-game-open', !open);
    });

    // Настройки и статистика — в отдельных контейнерах: renderAllStats()
    // перерисовывает только статистику, не трогая контролы.
    const settingsBox = document.createElement('div');
    settingsBox.className = 'stg-game-controls';
    const statsBox = document.createElement('div');
    statsBox.className = 'stg-game-stats';
    statsBox.id = `stg_stats_${game.id}`;
    body.append(settingsBox, statsBox);

    game.renderSettings?.(settingsBox, makeApi(game));
    game.renderStats?.(statsBox, makeApi(game));

    section.append(toggle, body);
    return section;
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

    const heading = document.createElement('div');
    heading.className = 'stg-section-heading';

    const headingIcon = document.createElement('i');
    headingIcon.className = 'fa-solid fa-palette';
    headingIcon.setAttribute('aria-hidden', 'true');

    const headingText = document.createElement('b');
    headingText.textContent = 'Оформление';

    heading.append(headingIcon, headingText);
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
