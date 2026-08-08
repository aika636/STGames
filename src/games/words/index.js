// «Слова» как игра хаба: объект по контракту реестра (src/registry.js). Экран —
// createWordsScreen из ui/game.js, дефолты, панель настроек и статистика — из settings.js.
//
// Аргументов у слэш-команды нет: режим один (бесконечный), длина слова не настраивается,
// а жёсткий режим — переключатель в панели, который применяется к следующей партии, и
// подсовывать его аргументом значило бы менять сложность идущей игры со стороны.

import { WORDS_DEFAULTS, renderWordsSettings, renderWordsStats } from './settings.js';
import { createWordsScreen } from './ui/game.js';

const wordsGame = {
    id: 'words',
    title: 'Слова',
    tagline: 'Угадай слово из пяти букв за шесть попыток',
    icon: 'fa-font',
    defaults: WORDS_DEFAULTS,
    slash: {
        name: 'words',
        help: 'Открывает «Слова» — угадать слово из пяти букв за шесть попыток.',
    },
    mount: createWordsScreen,
    renderSettings: renderWordsSettings,
    renderStats: renderWordsStats,
};

export default wordsGame;
