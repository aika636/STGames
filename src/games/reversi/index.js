// Реверси как игра хаба: объект по контракту реестра (src/registry.js). Экран игры —
// createReversiScreen из ui/game.js, дефолты, панель настроек и статистика — из settings.js.

import {
    LEVELS,
    REVERSI_DEFAULTS,
    renderReversiSettings,
    renderReversiStats,
} from './settings.js';
import { createReversiScreen } from './ui/game.js';

const reversiGame = {
    id: 'reversi',
    title: 'Реверси',
    tagline: 'Партия против соперника: захвати доску',
    icon: 'fa-circle-half-stroke',
    defaults: REVERSI_DEFAULTS,
    slash: {
        name: 'reversi',
        help: `Открывает реверси. Необязательный аргумент — уровень соперника: ${LEVELS.join(', ')}.`,
        enumValues: LEVELS,
        // Незнакомый уровень не пускаем дальше: parse вернёт level: undefined, и окно
        // продолжит сохранённую партию, как вход без аргумента. Явный уровень, наоборот,
        // означает новую партию — его применяет экран.
        parse: (value) => {
            const requested = String(value || '').trim().toLowerCase();
            return { level: LEVELS.includes(requested) ? requested : undefined };
        },
    },
    mount: createReversiScreen,
    renderSettings: renderReversiSettings,
    renderStats: renderReversiStats,
};

export default reversiGame;
