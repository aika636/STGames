// Попап и сессия оболочки: одно открытое окно на всё расширение. Хаб (список игр),
// экраны игр и их монтирование живут здесь; сам попап показывается через
// ctx.callGenericPopup, а если его в этой версии ST нет — через собственный оверлей.

import { getCtx, toast } from '../ctx.js';
import { logError, logInfo } from '../log.js';
import { get, list } from '../registry.js';
import { getGameSettings, getSettings, saveSettings } from '../settings.js';
import { renderAllStats } from './settings-ui.js';
import { createHub } from './hub.js';

// Открытая сессия. Второй попап не открываем: два окна с одним состоянием разъехались
// бы, а игроку и одного достаточно.
let session = null;

export function isOpen() {
    return session !== null;
}

// Перерисовывает текущий экран. Нужно, когда настройки поменяли прямо во время
// партии: экран игры читает их при каждой отрисовке, но без внешнего пинка ждал бы
// следующего хода.
export function refresh() {
    if (session?.current?.refresh) {
        try {
            session.current.refresh();
        } catch (err) {
            logError('не удалось перерисовать экран', err);
        }
    }
}

// gameId — открыть игру сразу, минуя хаб; args — аргументы из слэш-команды игры.
export async function openShell({ gameId = null, args = {} } = {}) {
    if (session) {
        logInfo('окно уже открыто');
        return;
    }

    const root = document.createElement('div');
    root.className = 'stg-root';
    // Фокусируемый корень: попап ST при открытии сам ставит фокус на первый подходящий
    // элемент внутри, и без этого им оказывался select уровня судоку.
    root.tabIndex = -1;

    const topbar = document.createElement('div');
    topbar.className = 'stg-topbar';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'stg-back';
    backBtn.textContent = '← Игры';
    backBtn.title = 'Вернуться к списку игр';

    const title = document.createElement('span');
    title.className = 'stg-title';

    topbar.append(backBtn, title);

    const screen = document.createElement('div');
    screen.className = 'stg-screen';

    root.append(topbar, screen);

    session = { root, screen, backBtn, current: null };

    const unmount = () => {
        if (!session.current) return;
        try {
            session.current.destroy();
        } catch (err) {
            logError('не удалось размонтировать экран', err);
        }
        session.current = null;
    };

    const showHub = () => {
        unmount();
        screen.textContent = '';
        title.textContent = 'STGames';
        backBtn.hidden = true;

        const hub = createHub({
            games: list(),
            onPick: (id) => showGame(id, {}),
            lastGameId: getSettings().lastGame,
        });
        screen.appendChild(hub.root);
        session.current = { destroy: hub.destroy };
        // Переход между экранами теряет фокус. Первую плитку или сам хаб фокусируем,
        // чтобы клавиатурные и скринридерные пользователи оказались в новом экране.
        const firstTile = hub.root.querySelector('.stg-tile');
        setTimeout(() => {
            if (firstTile) firstTile.focus({ preventScroll: true });
            else hub.root.focus?.({ preventScroll: true });
        }, 0);
    };

    const showGame = (id, args) => {
        const game = get(id);
        if (!game) {
            logError(`игра ${id} не найдена в реестре`);
            showHub();
            return;
        }
        unmount();
        screen.textContent = '';
        title.textContent = game.title;

        const api = {
            settings: getGameSettings(id, game.defaults),
            args,
            save: saveSettings,
            toast,
            exitToHub: showHub,
            isSoloGame: () => list().length === 1,
            renderAllStats,
        };

        let mounted;
        try {
            mounted = game.mount(screen, api);
        } catch (err) {
            // Сломанная игра не должна оставлять пустой экран и убивать попап.
            logError(`не удалось запустить игру ${id}`, err);
            showHub();
            return;
        }
        session.current = { ...mounted, id };
        // «← Игры» предлагает выйти в список из одного пункта — прячем её.
        backBtn.hidden = list().length === 1;
        // После смены экрана уводим фокус внутрь игры, иначе Tab уйдёт в затенённую
        // страницу таверны за попапом.
        screen.tabIndex = -1;
        setTimeout(() => screen.focus({ preventScroll: true }), 0);

        const settings = getSettings();
        settings.lastGame = id;
        saveSettings();
    };

    // Фокус ставим следующим тиком: попап ST раздаёт фокус уже после вставки
    // содержимого, и свой вызов он бы перебил.
    setTimeout(() => session?.root.focus?.(), 0);

    backBtn.addEventListener('click', showHub);

    if (gameId) showGame(gameId, args);
    else showHub();

    try {
        await showPopup(root);
    } catch (err) {
        logError('не удалось показать попап', err);
    } finally {
        // Закрытие попапа гарантированно размонтирует текущий экран: сохранение
        // партии судоку живёт в destroy() игры, потерять его нельзя.
        unmount();
        session = null;
    }
}

// --- Попап

async function showPopup(content) {
    const ctx = getCtx();

    if (typeof ctx.callGenericPopup === 'function') {
        // DISPLAY — попап без кнопок, только крестик в углу; числовое значение на случай,
        // если POPUP_TYPE в этой версии ST не экспортирован.
        const DISPLAY = ctx.POPUP_TYPE?.DISPLAY ?? 4;
        return ctx.callGenericPopup(content, DISPLAY, '', {
            wider: true,
            allowVerticalScrolling: true,
            animation: 'fast',
        });
    }

    return showFallbackOverlay(content);
}

// Свой оверлей на случай, когда попапа ST нет. Умеет ровно то же, что нужно оболочке:
// закрытие по крестику, по клику мимо окна и по Esc.
function showFallbackOverlay(content) {
    return new Promise((resolve) => {
        const previousActive = document.activeElement;
        const overlay = document.createElement('div');
        overlay.className = 'stg-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'stg-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', 'STGames');

        const close = document.createElement('div');
        close.className = 'stg-close fa-solid fa-circle-xmark';
        close.setAttribute('role', 'button');
        close.setAttribute('tabindex', '0');
        close.setAttribute('aria-label', 'Закрыть');

        dialog.append(close, content);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const focusable = () => Array.from(dialog.querySelectorAll('button, [tabindex]:not([tabindex="-1"])'));

        const finish = () => {
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
            if (previousActive) previousActive.focus?.({ preventScroll: true });
            resolve();
        };

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                finish();
            } else if (event.key === 'Enter' || event.key === ' ') {
                if (event.target === close) {
                    event.preventDefault();
                    finish();
                }
            } else if (event.key === 'Tab') {
                const list = focusable();
                if (list.length === 0) return;
                const first = list[0];
                const last = list[list.length - 1];
                if (event.shiftKey && event.target === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && event.target === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }

        close.addEventListener('click', finish);
        close.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                finish();
            }
        });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) finish();
        });
        document.addEventListener('keydown', onKeyDown, true);
        setTimeout(() => close.focus({ preventScroll: true }), 0);
    });
}
