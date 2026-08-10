// Балда как игра хаба: объект по контракту реестра (src/registry.js). Экран игры —
// createBaldaScreen из ui/game.js, дефолты, панель настроек и статистика — из settings.js.

import {
    BALDA_DEFAULTS,
    LEVELS,
    renderBaldaSettings,
    renderBaldaStats,
} from './settings.js';
import { createBaldaScreen } from './ui/game.js';

const baldaGame = {
    id: 'balda',
    title: 'Балда',
    tagline: 'Слова на поле: буква за ход, очки за длину',
    // Не повторяет ни fa-font «Слов», ни клетчатые иконки судоку с нонограммой:
    // в хабе плитки различаются в первую очередь значком.
    icon: 'fa-spell-check',
    defaults: BALDA_DEFAULTS,
    slash: {
        name: 'balda',
        help: `Открывает балду. Необязательный аргумент — уровень соперника: ${LEVELS.join(', ')}.`,
        enumValues: LEVELS,
        // Незнакомый уровень не пускаем дальше: parse вернёт level: undefined, и окно
        // продолжит сохранённую партию, как вход без аргумента. Явный уровень, наоборот,
        // означает новую партию — его применяет экран.
        parse: (value) => {
            const requested = String(value || '').trim().toLowerCase();
            return { level: LEVELS.includes(requested) ? requested : undefined };
        },
    },
    mount: createBaldaScreen,
    renderSettings: renderBaldaSettings,
    renderStats: renderBaldaStats,
};

export default baldaGame;
