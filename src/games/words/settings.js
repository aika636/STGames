// Настройки «Слов»: дефолты, панель и статистика. Общий модуль настроек хаба остаётся
// игро-агностичным — всё, что знает про эту игру, живёт здесь.

import { getGameSettings } from '../../settings.js';
import { checkbox } from '../../shell/settings-ui.js';
import { MAX_ATTEMPTS } from './core/engine.js';
import { isEmpty, readStats, resetStats, winRate } from './core/stats.js';

// Замораживается реестром при регистрации; Object.freeze здесь — для симметрии с
// остальными играми и чтобы модуль был честен сам по себе.
export const WORDS_DEFAULTS = Object.freeze({
    // Жёсткий режим применяется к СЛЕДУЮЩЕЙ партии: в текущей он заморожен в savedGame
    // (см. core/engine.js), иначе переключатель посреди игры ретроактивно менял бы
    // сложность внутри одной строки статистики.
    hardMode: false,
    colorBlind: false,
    // { played, wins, losses, currentStreak, maxStreak, distribution: [6] }
    stats: {},
    // Текущая партия. null = партии нет.
    savedGame: null,
});

export function getWordsSettings() {
    return getGameSettings('words', WORDS_DEFAULTS);
}

// --- Панель настроек

export function renderWordsSettings(container, api) {
    if (!container) return;
    const settings = getWordsSettings();

    const hard = checkbox('words_hard_mode', 'Жёсткий режим', settings.hardMode, (checked) => {
        const s = getWordsSettings();
        s.hardMode = checked;
        api.save();
        api.onSettingsChanged?.(s);
    });
    // Подпись обязана сказать, что смена не действует на идущую партию: иначе игрок
    // жмёт галку, ничего не происходит, и это выглядит поломкой.
    hard.appendChild(hint('Раскрытые буквы обязательны в следующих догадках. Применится к следующему слову.'));

    const colorBlind = checkbox('words_color_blind', 'Режим для дальтоников', settings.colorBlind, (checked) => {
        const s = getWordsSettings();
        s.colorBlind = checked;
        api.save();
        api.onSettingsChanged?.(s);
    });
    colorBlind.appendChild(hint('Оранжевый и синий вместо зелёного с жёлтым, плюс значки на плитках.'));

    container.append(hard, colorBlind);
}

function hint(text) {
    const small = document.createElement('small');
    small.className = 'words-settings-hint';
    small.textContent = text;
    return small;
}

// --- Статистика
//
// renderAllStats() зовёт этот рендер заново после каждой засчитанной партии, поэтому
// блок строится целиком с нуля.

export function renderWordsStats(container, api) {
    if (!container) return;
    container.textContent = '';

    const settings = getWordsSettings();
    const stats = readStats(settings.stats);

    const header = document.createElement('div');
    header.className = 'stg-row words-stats-header';

    const title = document.createElement('b');
    title.textContent = 'Статистика';

    const reset = document.createElement('div');
    reset.id = 'words_stats_reset';
    reset.className = 'menu_button';
    reset.title = 'Обнулить статистику';
    reset.textContent = 'Сбросить';
    reset.addEventListener('click', () => {
        const s = getWordsSettings();
        resetStats(s.stats);
        api.save();
        api.renderAllStats();
    });

    header.append(title, reset);

    const summary = document.createElement('div');
    summary.id = 'words_stats';
    summary.className = 'words-stats-summary';
    // Процент побед считается здесь и не хранится: производная величина в settings.json
    // рассинхронизируется с исходными при первой же ручной правке.
    summary.append(
        metric('Сыграно', stats.played),
        metric('Побед', `${stats.wins} (${winRate(settings.stats)}%)`),
        metric('Серия', stats.currentStreak),
        metric('Рекорд', stats.maxStreak),
    );

    const chart = document.createElement('div');
    chart.className = 'words-stats-chart';

    // Масштаб — по самой высокой полосе, включая поражения: иначе шесть побед с первой
    // попытки и двадцать поражений рисуются одинаковой длины.
    const peak = Math.max(1, ...stats.distribution, stats.losses);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        chart.appendChild(bar(String(i + 1), stats.distribution[i], peak));
    }
    // Поражения — отдельная строка, а не седьмая попытка: их «номер попытки» не
    // существует, и в распределении им места нет.
    chart.appendChild(bar('×', stats.losses, peak, 'words-stats-loss'));

    const note = document.createElement('small');
    note.id = 'words_stats_hint';
    note.textContent = 'Партия засчитывается в «сыграно», как только слово загадано, — и доигранная, и брошенная.';

    container.append(header, summary, chart, note);

    // Кнопка сброса без единой партии бессмысленна и только сбивает с толку; вместо неё
    // показывается пояснение, что именно считается сыгранной партией.
    const empty = isEmpty(settings.stats);
    toggleVisible(reset, !empty);
    toggleVisible(note, empty);
}

function toggleVisible(element, visible) {
    if (element) element.style.display = visible ? '' : 'none';
}

function metric(label, value) {
    const box = document.createElement('div');
    box.className = 'words-stats-metric';
    const number = document.createElement('b');
    number.textContent = String(value);
    const caption = document.createElement('span');
    caption.textContent = label;
    box.append(number, caption);
    return box;
}

function bar(label, count, peak, extraClass) {
    const row = document.createElement('div');
    row.className = extraClass ? `words-stats-bar ${extraClass}` : 'words-stats-bar';

    const key = document.createElement('span');
    key.className = 'words-stats-bar-key';
    key.textContent = label;

    const track = document.createElement('span');
    track.className = 'words-stats-bar-track';

    const fill = document.createElement('span');
    fill.className = 'words-stats-bar-fill';
    // Нулевая полоса всё равно занимает несколько процентов: строка без полосы читается
    // как «этой попытки не бывает», а не как «ни разу не случилось».
    fill.style.width = `${count === 0 ? 0 : Math.max(6, Math.round((count / peak) * 100))}%`;

    const value = document.createElement('span');
    value.className = 'words-stats-bar-value';
    value.textContent = String(count);

    track.appendChild(fill);
    row.append(key, track, value);
    return row;
}
