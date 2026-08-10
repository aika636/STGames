// Сапёр как игра хаба: объект по контракту реестра (src/registry.js). Экран игры —
// createMinesweeperScreen из ui/game.js, дефолты, панель настроек и статистика —
// из settings.js.

import {
    LEVELS,
    MINESWEEPER_DEFAULTS,
    renderMinesweeperSettings,
    renderMinesweeperStats,
} from './settings.js';
import { createMinesweeperScreen } from './ui/game.js';

const minesweeperGame = {
    id: 'minesweeper',
    title: 'Сапёр',
    tagline: 'Логика по цифрам: разминируй поле',
    icon: 'fa-bomb',
    defaults: MINESWEEPER_DEFAULTS,
    slash: {
        name: 'minesweeper',
        help: `Открывает сапёра. Необязательный аргумент — уровень: ${LEVELS.join(', ')}.`,
        enumValues: LEVELS,
        // Незнакомый уровень не пускаем дальше: parse вернёт level: undefined, и окно
        // продолжит сохранённую партию, как вход без аргумента. Явный уровень, наоборот,
        // означает новое поле — его применяет экран.
        parse: (value) => {
            const requested = String(value || '').trim().toLowerCase();
            return { level: LEVELS.includes(requested) ? requested : undefined };
        },
    },
    mount: createMinesweeperScreen,
    renderSettings: renderMinesweeperSettings,
    renderStats: renderMinesweeperStats,
};

export default minesweeperGame;
