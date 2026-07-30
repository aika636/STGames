// Точка входа Sudoku. Тонкий файл: только связывает модули, вся логика — в src/.

import { getCtx, getEventTypes } from './src/ctx.js';
import { logError, logInfo } from './src/log.js';
import { initSettingsUI } from './src/settings.js';
import { initSlashCommand, initWandButton } from './src/ui/launcher.js';

const VERSION = '0.3.0';

function onSettingsChanged() {
    // Фаза 4: пробросить изменения в открытую партию (подсветка, таймер).
}

// Панель настроек и кнопка в wand-меню появляются только после того, как ST отрисовал
// свой интерфейс, — это APP_READY. Если событие уже прошло (или его имени нет в этой
// версии ST), страхуемся отложенной попыткой, чтобы не потерять UI совсем.
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
            initSlashCommand();
        } catch (err) {
            logError('initSlashCommand упал', err);
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

jQuery(async () => {
    try {
        initUI();
        logInfo(`v${VERSION} загружен`);
    } catch (err) {
        logError('инициализация упала', err);
    }
});
