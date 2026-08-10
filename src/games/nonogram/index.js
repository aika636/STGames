// Нонограмма как игра хаба: объект по контракту реестра (src/registry.js). Экран игры —
// createNonogramScreen из ui/game.js, дефолты, панель настроек и статистика —
// из settings.js.

import {
    LEVELS,
    NONOGRAM_DEFAULTS,
    renderNonogramSettings,
    renderNonogramStats,
} from './settings.js';
import { createNonogramScreen } from './ui/game.js';

const nonogramGame = {
    id: 'nonogram',
    title: 'Нонограмма',
    tagline: 'Японский кроссворд: собери картинку по числам',
    icon: 'fa-table-cells',
    defaults: NONOGRAM_DEFAULTS,
    slash: {
        name: 'nonogram',
        help: `Открывает нонограмму. Необязательный аргумент — размер: ${LEVELS.join(', ')}.`,
        enumValues: LEVELS,
        // Незнакомый уровень не пускаем дальше: parse вернёт level: undefined, и окно
        // продолжит сохранённую партию, как вход без аргумента.
        parse: (value) => {
            const requested = String(value || '').trim().toLowerCase();
            return { level: LEVELS.includes(requested) ? requested : undefined };
        },
    },
    mount: createNonogramScreen,
    renderSettings: renderNonogramSettings,
    renderStats: renderNonogramStats,
};

export default nonogramGame;
