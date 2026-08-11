// Точка входа STGames. Тонкий файл: только связывает модули, вся логика — в src/.

import { getCtx, getEventTypes } from './src/ctx.js';
import { logError, logInfo } from './src/log.js';
import { register } from './src/registry.js';
import sudokuGame from './src/games/sudoku/index.js';
import snakeGame from './src/games/snake/index.js';
import reversiGame from './src/games/reversi/index.js';
import wordsGame from './src/games/words/index.js';
import minesweeperGame from './src/games/minesweeper/index.js';
import nonogramGame from './src/games/nonogram/index.js';
import crosswordGame from './src/games/crossword/index.js';
import baldaGame from './src/games/balda/index.js';
import { initSettingsUI } from './src/shell/settings-ui.js';
import { initSlashCommands, initWandButton } from './src/shell/launcher.js';
import { refresh } from './src/shell/modal.js';

const VERSION = '0.10.0';

// Подсветка и таймер читаются из настроек при каждой отрисовке — открытому окну
// достаточно сказать «перерисуйся».
function onSettingsChanged() {
    try {
        refresh();
    } catch (err) {
        logError('не удалось применить настройки к открытому окну', err);
    }
}

// Панель настроек, кнопка в wand-меню и слэш-команды появляются только после того, как
// ST отрисовал свой интерфейс, — это APP_READY. Если событие уже прошло (или его имени
// нет в этой версии ST), страхуемся отложенной попыткой, чтобы не потерять UI совсем.
function initUI() {
    let done = false;
    const run = async () => {
        if (done) return;
        done = true;

        try {
            await initSettingsUI(onSettingsChanged);
        } catch (err) {
            logError('initSettingsUI упал', err);
        }

        try {
            initWandButton();
        } catch (err) {
            logError('initWandButton упал', err);
        }

        try {
            initSlashCommands();
        } catch (err) {
            logError('initSlashCommands упал', err);
        }
    };

    try {
        const ctx = getCtx();
        const et = getEventTypes(ctx);
        if (et.APP_READY) ctx.eventSource.on(et.APP_READY, run);
    } catch (err) {
        logError('не удалось подписаться на APP_READY', err);
    }

    setTimeout(run, 3000);
}

register(sudokuGame);
register(snakeGame);
register(reversiGame);
register(wordsGame);
register(minesweeperGame);
register(nonogramGame);
register(crosswordGame);
register(baldaGame);

jQuery(async () => {
    try {
        initUI();
        logInfo(`v${VERSION} загружен`);
    } catch (err) {
        logError('инициализация упала', err);
    }
});
