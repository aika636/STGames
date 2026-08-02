// Судоку как игра хаба: объект по контракту реестра (src/registry.js). Экран игры —
// createGameScreen из ui/game.js, настройки и статистика — из settings.js.

import {
    DIFFICULTIES,
    SUDOKU_DEFAULTS,
    renderSudokuSettings,
    renderSudokuStats,
} from './settings.js';
import { createGameScreen } from './ui/game.js';

const sudokuGame = {
    id: 'sudoku',
    title: 'Судоку',
    tagline: 'Логическая головоломка 9×9',
    icon: 'fa-table-cells',
    defaults: SUDOKU_DEFAULTS,
    slash: {
        name: 'sudoku',
        help: `Открывает судоку. Необязательный аргумент — уровень: ${DIFFICULTIES.join(', ')}.`,
        enumValues: DIFFICULTIES,
        // Незнакомый уровень не пускаем в настройки: parse вернёт difficulty: undefined,
        // и окно просто продолжит сохранённую партию, как вход без аргумента.
        parse: (value) => {
            const requested = String(value || '').trim().toLowerCase();
            return { difficulty: DIFFICULTIES.includes(requested) ? requested : undefined };
        },
    },
    mount: createGameScreen,
    renderSettings: renderSudokuSettings,
    renderStats: renderSudokuStats,
};

export default sudokuGame;
