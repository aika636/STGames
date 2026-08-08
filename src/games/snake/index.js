// Змейка как игра хаба: объект по контракту реестра (src/registry.js). Экран собирает
// createSnakeScreen — canvas (ui/view.js) плюс клавиатура/d-pad/свайпы (ui/controls.js);
// цикл — requestAnimationFrame с накоплением времени вместо setInterval: интервал плывёт
// и не переживает переключение вкладки.

import { createSnake, setDirection, step, speedMs } from './core/engine.js';
import { readStats, recordPlayed, recordResult, resetStats } from './core/stats.js';
import { logError } from '../../log.js';
import { checkbox } from '../../shell/settings-ui.js';
import { createView } from './ui/view.js';
import { attachKeyboard, createDPad, attachSwipe } from './ui/controls.js';

// Сквозные стены включены по умолчанию: без них проигрыш чаще всего приходит от
// случайного касания края, а не от собственного хвоста. Кому нужна классика — чекбокс
// в панели настроек, он действует сразу, не дожидаясь новой партии.
const DEFAULTS = Object.freeze({ stats: {}, showGrid: false, wrapWalls: true });

export default {
    id: 'snake',
    title: 'Змейка',
    tagline: 'Аркада: ешь, расти, не врезайся',
    icon: 'fa-worm',
    defaults: DEFAULTS,
    slash: { name: 'snake', help: 'Открыть игру «Змейка»' },
    mount(root, api) {
        return createSnakeScreen(root, api);
    },
    renderSettings(container, api) {
        // Общий хелпер оболочки, а не своя разметка: он даёт ту же обёртку
        // .checkbox_label, что и у судоку, — блоки игр в одной панели должны
        // выглядеть одинаково, и клик по подписи должен переключать чекбокс.
        container.appendChild(checkbox('snake_show_grid', 'Показывать сетку', api.settings.showGrid, (checked) => {
            api.settings.showGrid = checked;
            api.save();
        }));
        container.appendChild(checkbox('snake_wrap_walls', 'Сквозные стены (выход с другой стороны)', api.settings.wrapWalls !== false, (checked) => {
            api.settings.wrapWalls = checked;
            api.save();
        }));
    },
    renderStats(container, api) {
        const stats = readStats(api.settings.stats);
        container.innerHTML = '';

        const played = document.createElement('div');
        played.textContent = `Сыграно: ${stats.played}`;
        const bestScore = document.createElement('div');
        bestScore.textContent = `Лучший счёт: ${stats.bestScore}`;
        const bestLength = document.createElement('div');
        bestLength.textContent = `Лучшая длина: ${stats.bestLength}`;
        container.appendChild(played);
        container.appendChild(bestScore);
        container.appendChild(bestLength);

        if (stats.played || stats.bestScore || stats.bestLength) {
            const btn = document.createElement('button');
            btn.className = 'menu_button';
            btn.textContent = 'Сбросить';
            btn.addEventListener('click', () => {
                resetStats(api.settings.stats);
                api.save();
                api.renderAllStats();
            });
            container.appendChild(btn);
        }
    },
};

function createSnakeScreen(root, api) {
    root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'snake-root';
    root.appendChild(screen);
    root = screen;

    const header = document.createElement('div');
    header.className = 'snake-header';
    const scoreEl = document.createElement('span');
    const lengthEl = document.createElement('span');
    const bestEl = document.createElement('span');
    header.appendChild(scoreEl);
    header.appendChild(lengthEl);
    header.appendChild(bestEl);
    root.appendChild(header);

    const stage = document.createElement('div');
    stage.className = 'snake-stage';
    const view = createView({ cols: 21, rows: 21 });
    stage.appendChild(view.root);

    // Оверлей висит на обёртке канваса (position: relative), а не на корне: он должен
    // лежать ровно поверх поля, не накрывая шапку и d-pad.
    const overlay = document.createElement('div');
    overlay.className = 'snake-over';
    overlay.innerHTML = '<div class="snake-over-content"></div>';
    overlay.style.display = 'none';
    stage.appendChild(overlay);
    root.appendChild(stage);

    const dpad = createDPad({
        onDirection: (dir) => {
            if (state) setDirection(state, dir);
        },
        onPause: () => {
            manualPaused = !manualPaused;
            updateStatus();
        },
    });
    root.appendChild(dpad.root);

    const status = document.createElement('div');
    status.className = 'snake-status';
    root.appendChild(status);

    const settings = api.settings;
    const wrapEnabled = () => settings.wrapWalls !== false;

    let state = createSnake({ rng: Math.random, wrap: wrapEnabled() });
    let manualPaused = false;
    let autoPaused = false;
    let paused = () => manualPaused || autoPaused;
    let lastStep = 0;
    let rafId = null;
    let overRecorded = false;

    function updateHeader() {
        const best = readStats(settings.stats);
        scoreEl.textContent = `Счёт: ${state.score}`;
        lengthEl.textContent = `Длина: ${state.snake.length}`;
        bestEl.textContent = `Рекорд: ${best.bestScore}`;
    }

    function updateStatus() {
        if (!state.alive || state.won) {
            status.textContent = state.won ? 'Победа! Нажмите Enter для новой игры.' : 'Конец игры. Нажмите Enter для новой игры.';
        } else if (paused()) {
            status.textContent = 'Пауза';
        } else {
            status.textContent = '';
        }
    }

    function showOver() {
        overlay.style.display = 'flex';
        const content = overlay.querySelector('.snake-over-content');
        const best = readStats(settings.stats);
        const isBest = state.score > best.bestScore || state.snake.length > best.bestLength;
        let html = state.won
            ? `<div>Победа! Счёт ${state.score}</div>`
            : `<div>Счёт ${state.score}</div>`;
        if (isBest) html += '<div>Новый рекорд!</div>';
        html += '<button class="snake-over-restart menu_button">Ещё раз</button>';
        content.innerHTML = html;
        const restartBtn = content.querySelector('.snake-over-restart');
        if (restartBtn) {
            restartBtn.addEventListener('click', () => {
                restartBtn.blur();
                restart();
            });
        }
        updateStatus();
    }

    // Запись результата — строго один раз за заезд, на каком бы из путей (смерть или
    // победа) заезд ни закончился.
    function record() {
        if (overRecorded) return;
        overRecorded = true;
        try {
            const result = recordResult(settings.stats, { score: state.score, length: state.snake.length });
            api.save();
            api.renderAllStats();
            if (result.bestScore || result.bestLength) api.toast('success', 'Новый рекорд в Змейке!');
        } catch (err) {
            logError('не удалось записать результат змейки', err);
        }
    }

    function restart() {
        state = createSnake({ rng: Math.random, wrap: wrapEnabled() });
        manualPaused = false;
        autoPaused = false;
        lastStep = performance.now();
        overRecorded = false;
        overlay.style.display = 'none';
        overlay.querySelector('.snake-over-content').innerHTML = '';
        try {
            recordPlayed(settings.stats);
            api.save();
            api.renderAllStats();
        } catch (e) {
            logError('не удалось обновить статистику змейки при рестарте', e);
        }
        updateHeader();
        updateStatus();
        view.draw({ ...state, showGrid: settings.showGrid });
    }

    function tick() {
        // Настройку правят в другой панели, при открытом экране: подхватываем её перед
        // ходом, чтобы переключатель не ждал новой партии.
        state.wrap = wrapEnabled();
        if (!paused() && state.alive && !state.won) {
            const res = step(state, Math.random);
            // Флаги alive/won выставляет сам step() — перезаписывать их здесь нельзя:
            // на победе res.dead === false вернул бы alive в true при уже законченном заезде.
            if (res.dead || res.won) {
                showOver();
                record();
            }
        }
        updateHeader();
        updateStatus();
        view.draw({ ...state, showGrid: settings.showGrid });
    }

    function onFrame(now) {
        if (now - lastStep >= speedMs(state)) {
            lastStep = now;
            tick();
        }
        rafId = requestAnimationFrame(onFrame);
    }

    const keyboard = attachKeyboard({
        onDirection: (dir) => {
            if (state) setDirection(state, dir);
        },
        onPause: () => {
            manualPaused = !manualPaused;
            updateStatus();
        },
        onRestart: () => {
            if (!state.alive || state.won) restart();
        },
    });

    const swipe = attachSwipe(view.canvas, (dir) => {
        if (state) setDirection(state, dir);
    });

    // Уходя со вкладки — пауза: вернувшись, игрок не должен обнаружить труп.
    // lastStep сбрасывается на текущий now, чтобы пропущенные тики не доигрывались
    // разом и первый кадр после возврата не убил змейку.
    function onVisibility() {
        if (document.hidden) {
            autoPaused = true;
        } else {
            autoPaused = false;
            lastStep = performance.now();
        }
        updateStatus();
    }
    function onBlur() {
        autoPaused = true;
        updateStatus();
    }
    function onFocus() {
        autoPaused = false;
        lastStep = performance.now();
        updateStatus();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    // «Сыграно» растёт в момент старта заезда, а не при его конце: брошенные партии
    // иначе нигде бы не отражались.
    try {
        recordPlayed(settings.stats);
        api.save();
        api.renderAllStats();
    } catch (e) {
        logError('не удалось обновить статистику змейки при старте', e);
    }

    updateHeader();
    view.draw({ ...state, showGrid: settings.showGrid });
    rafId = requestAnimationFrame(onFrame);

    return {
        destroy() {
            if (rafId) cancelAnimationFrame(rafId);
            keyboard.destroy();
            swipe.destroy();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
            root.innerHTML = '';
        },
    };
}
