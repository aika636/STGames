// Настройки судоку: дефолты, подписи уровней и отрисовка панели. Всё, что знало
// о судоку в старом src/settings.js, переехало сюда — общий модуль настроек хаба
// остался игро-агностичным.

import { getGameSettings } from '../../settings.js';
import { checkbox, row, select } from '../../shell/settings-ui.js';
import { formatElapsed } from './core/game.js';
import { isEmpty, readEntry, resetStats } from './core/stats.js';

export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'expert']);

// Подписи уровней живут здесь, а не в ui/game.js: их показывают оба — и окно игры,
// и таблица статистики в панели настроек.
export const LEVEL_LABELS = Object.freeze({
    easy: 'Лёгкий',
    medium: 'Средний',
    hard: 'Сложный',
    expert: 'Эксперт',
});

// Бывший DEFAULT_SETTINGS из src/settings.js: тот же набор ключей, ничего не убрано.
export const SUDOKU_DEFAULTS = Object.freeze({
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
    // Текущая партия. null = партии нет.
    savedGame: null,
    // Статистика по уровням: { [difficulty]: { played, solved, bestTimeMs } }.
    stats: {},
});

export function getSudokuSettings() {
    return getGameSettings('sudoku', SUDOKU_DEFAULTS);
}

// --- Панель настроек
//
// Контролы строятся в JS, а не читаются из settings.html: панель собирается из
// блоков зарегистрированных игр, и держать разметку каждой игры в общем HTML
// значило бы править один файл при добавлении новой игры.

export function renderSudokuSettings(container, api) {
    if (!container) return;
    const settings = getSudokuSettings();

    container.appendChild(row('Уровень сложности', select(
        'sudoku_difficulty',
        DIFFICULTIES.map((difficulty) => [difficulty, LEVEL_LABELS[difficulty]]),
        settings.difficulty,
        (value) => {
            const s = getSudokuSettings();
            // Значение из <select> приходит строкой; чужие значения не пускаем в настройки.
            s.difficulty = DIFFICULTIES.includes(value) ? value : SUDOKU_DEFAULTS.difficulty;
            api.save();
            api.onSettingsChanged?.(s);
        },
    )));

    container.appendChild(checkbox('sudoku_highlight_conflicts', 'Подсвечивать конфликты', settings.highlightConflicts, (checked) => {
        const s = getSudokuSettings();
        s.highlightConflicts = checked;
        api.save();
        api.onSettingsChanged?.(s);
    }));

    container.appendChild(checkbox('sudoku_highlight_mistakes', 'Подсвечивать ошибочные цифры', settings.highlightMistakes, (checked) => {
        const s = getSudokuSettings();
        s.highlightMistakes = checked;
        api.save();
        api.onSettingsChanged?.(s);
    }));

    container.appendChild(checkbox('sudoku_auto_clean_notes', 'Автоматически убирать заметки', settings.autoCleanNotes, (checked) => {
        const s = getSudokuSettings();
        s.autoCleanNotes = checked;
        api.save();
        api.onSettingsChanged?.(s);
    }));

    container.appendChild(checkbox('sudoku_show_timer', 'Показывать таймер', settings.showTimer, (checked) => {
        const s = getSudokuSettings();
        s.showTimer = checked;
        api.save();
        api.onSettingsChanged?.(s);
    }));
}

// --- Статистика
//
// renderAllStats() зовёт этот рендер заново после каждой засчитанной партии,
// поэтому блок строится целиком с нуля (контейнер очищается), а не доклеивается.
// Если панели в DOM нет, функция молча ничего не делает.

export function renderSudokuStats(container, api) {
    if (!container) return;
    container.textContent = '';

    const stats = getSudokuSettings().stats;

    const header = document.createElement('div');
    header.className = 'stg-row sudoku-stats-header';

    const title = document.createElement('b');
    title.textContent = 'Статистика';

    const reset = document.createElement('div');
    reset.id = 'sudoku_stats_reset';
    reset.className = 'menu_button';
    reset.title = 'Обнулить статистику';
    reset.textContent = 'Сбросить';
    reset.addEventListener('click', () => {
        const s = getSudokuSettings();
        resetStats(s.stats);
        api.save();
        api.renderAllStats();
    });

    header.append(title, reset);

    const table = document.createElement('div');
    table.id = 'sudoku_stats';
    table.className = 'sudoku-stats';

    const hint = document.createElement('small');
    hint.id = 'sudoku_stats_hint';
    hint.textContent = 'Партия засчитывается в «сыграно», как только доска создана, — и решённая, и брошенная.';

    container.append(header, table, hint);

    const rows = DIFFICULTIES.map((difficulty) => {
        const { played, solved, bestTimeMs } = readEntry(stats, difficulty);
        return [
            LEVEL_LABELS[difficulty] ?? difficulty,
            String(played),
            String(solved),
            bestTimeMs === null ? '—' : formatElapsed(bestTimeMs),
        ];
    });

    table.appendChild(buildRow(['Уровень', 'Сыграно', 'Решено', 'Лучшее'], 'sudoku-stats-head'));
    for (const row of rows) table.appendChild(buildRow(row));

    // Кнопка сброса без единой партии бессмысленна и только сбивает с толку; вместо
    // неё показывается пояснение, что именно считается сыгранной партией.
    // Здесь голый DOM, а не jQuery: рендер зовёт и окно игры, и хочется, чтобы
    // функция работала без предположений про глобальный $.
    const empty = isEmpty(stats);
    toggleVisible(reset, !empty);
    toggleVisible(hint, empty);
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
