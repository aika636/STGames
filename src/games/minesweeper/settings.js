// Настройки сапёра: дефолты, подписи и отрисовка панели — контролы и таблица
// статистики. Общий модуль настроек хаба остаётся игро-агностичным, всё, что знает
// о сапёре, живёт здесь.

import { getGameSettings } from '../../settings.js';
import { checkbox, row, select } from '../../shell/settings-ui.js';
import { BOARDS } from './core/engine.js';
import { isEmpty, readEntry, resetStats } from './core/stats.js';

export const LEVELS = Object.freeze(Object.keys(BOARDS));

export const MINESWEEPER_DEFAULTS = Object.freeze({
    level: 'easy',
    // Поле, которое берётся логикой целиком: концовка «пятьдесят на пятьдесят» —
    // единственное, за что сапёра ругают заслуженно. Выключатель всё же есть: кому-то
    // классическое поле дороже гарантии.
    noGuess: true,
    showTimer: true,
    // Клик по открытой цифре, вокруг которой уже стоят все флажки, открывает остальных
    // соседей. На тач-экране это единственный удобный способ сделать аккорд — средней
    // кнопки там нет.
    autoChord: true,
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

export function getMinesweeperSettings() {
    return getGameSettings('minesweeper', MINESWEEPER_DEFAULTS);
}

// Уровень, пригодный для настроек: чужое значение (правка файла руками, аргумент
// слэш-команды) сводится к дефолту, а не уезжает в настройки и в ключи статистики.
export function normalizeLevel(value) {
    return LEVELS.includes(value) ? value : MINESWEEPER_DEFAULTS.level;
}

// Подпись уровня вместе с размером поля: «Средний (12×12, 20 мин)». Без размера выбор
// вслепую — уровни у сапёра отличаются не только плотностью мин.
export function levelLabel(level) {
    const board = BOARDS[level];
    const name = LEVEL_LABELS[level] ?? level;
    return board ? `${name} (${board.cols}×${board.rows}, ${board.mines})` : name;
}

export function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

// --- Панель настроек

export function renderMinesweeperSettings(container, api) {
    if (!container) return;
    const settings = getMinesweeperSettings();

    container.appendChild(row('Уровень', select(
        'minesweeper_level',
        LEVELS.map((level) => [level, levelLabel(level)]),
        settings.level,
        (value) => {
            const s = getMinesweeperSettings();
            s.level = normalizeLevel(value);
            api.save();
            // Уровень меняет размер поля, поэтому текущей партии он не касается —
            // подхватит следующая. Экран всё же дёргаем: в шапке живёт тот же селектор.
            api.onSettingsChanged?.(s);
        },
    )));

    container.appendChild(checkbox(
        'minesweeper_no_guess',
        'Поле без угадывания',
        settings.noGuess,
        (checked) => {
            const s = getMinesweeperSettings();
            s.noGuess = checked;
            api.save();
            api.onSettingsChanged?.(s);
        },
    ));

    container.appendChild(checkbox(
        'minesweeper_auto_chord',
        'Клик по цифре открывает соседей',
        settings.autoChord,
        (checked) => {
            const s = getMinesweeperSettings();
            s.autoChord = checked;
            api.save();
            api.onSettingsChanged?.(s);
        },
    ));

    container.appendChild(checkbox('minesweeper_show_timer', 'Показывать таймер', settings.showTimer, (checked) => {
        const s = getMinesweeperSettings();
        s.showTimer = checked;
        api.save();
        api.onSettingsChanged?.(s);
    }));
}

// --- Статистика

export function renderMinesweeperStats(container, api) {
    if (!container) return;
    container.textContent = '';

    const stats = getMinesweeperSettings().stats;

    const header = document.createElement('div');
    header.className = 'stg-row minesweeper-stats-header';

    const title = document.createElement('b');
    title.textContent = 'Статистика';

    const reset = document.createElement('div');
    reset.id = 'minesweeper_stats_reset';
    reset.className = 'menu_button';
    reset.title = 'Обнулить статистику';
    reset.textContent = 'Сбросить';
    reset.addEventListener('click', () => {
        const s = getMinesweeperSettings();
        resetStats(s.stats);
        api.save();
        api.renderAllStats();
    });

    header.append(title, reset);

    const table = document.createElement('div');
    table.id = 'minesweeper_stats';
    table.className = 'minesweeper-stats';

    const hint = document.createElement('small');
    hint.id = 'minesweeper_stats_hint';
    hint.textContent = 'Партия засчитывается в «сыграно» с первой открытой клетки — и доигранная, и брошенная.';

    container.append(header, table, hint);

    table.appendChild(buildRow(['Уровень', 'Сыграно', 'Разминировано', 'Лучшее время'], 'minesweeper-stats-head'));
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
    div.className = className ? `minesweeper-stats-row ${className}` : 'minesweeper-stats-row';
    for (const text of cells) {
        const cell = document.createElement('span');
        cell.textContent = text;
        div.appendChild(cell);
    }
    return div;
}
