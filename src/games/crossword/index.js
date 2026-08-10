// Кроссворд-скелет как игра хаба: объект по контракту реестра (src/registry.js).
// Экран игры — createCrosswordScreen из ui/game.js, дефолты, панель настроек
// и статистика — из settings.js.

import {
    CROSSWORD_DEFAULTS,
    LEVELS,
    renderCrosswordSettings,
    renderCrosswordStats,
} from './settings.js';
import { createCrosswordScreen } from './ui/game.js';

const crosswordGame = {
    id: 'crossword',
    title: 'Кроссворд',
    tagline: 'Скелет: разложи банк слов по сетке',
    icon: 'fa-puzzle-piece',
    defaults: CROSSWORD_DEFAULTS,
    slash: {
        name: 'crossword',
        help: `Открывает кроссворд. Необязательный аргумент — размер: ${LEVELS.join(', ')}.`,
        enumValues: LEVELS,
        // Незнакомый уровень не пускаем дальше: parse вернёт level: undefined, и окно
        // продолжит сохранённую партию, как вход без аргумента.
        parse: (value) => {
            const requested = String(value || '').trim().toLowerCase();
            return { level: LEVELS.includes(requested) ? requested : undefined };
        },
    },
    mount: createCrosswordScreen,
    renderSettings: renderCrosswordSettings,
    renderStats: renderCrosswordStats,
};

export default crosswordGame;
