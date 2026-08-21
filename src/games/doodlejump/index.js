// «Дудл Джамп» как игра хаба: объект по контракту реестра (src/registry.js). Экран
// собирает createDoodleJumpScreen — canvas (ui/view.js) плюс клавиатура и экранные кнопки
// (ui/controls.js); цикл — requestAnimationFrame, а сколько физики прогнать за кадр,
// решает advance() движка (фиксированный подшаг с накопителем).
//
// Партия не сохраняется, как и у змейки: падение ниже экрана — естественный конец заезда,
// а пауза при потере вкладки делает персистентность ненужной. В settings живут только
// статистика и настройки.

import {
    advance, createGame, DEFAULT_DIFFICULTY, DIFFICULTY, PLAYER_H, PLAYER_W, setBoosters,
    setDifficulty, setInput, setMovingPlatforms,
} from './core/engine.js';
import { readStats, recordPlayed, recordResult, resetStats } from './core/stats.js';
import { addCoins, buySkin, readSkins, readWallet, wearSkin } from './core/wallet.js';
import { logError } from '../../log.js';
import { checkbox, row, select } from '../../shell/settings-ui.js';
import { createView } from './ui/view.js';
import { resolveColors, SKINS } from './ui/skins.js';
import { attachKeyboard, createButtons, createDrag } from './ui/controls.js';

const DEFAULTS = Object.freeze({
    stats: {},
    // Кошелёк и скины — рядом со stats, а не внутри: кнопка «Сбросить» в панели обнуляет
    // статистику, и заработанное она трогать не должна (docs/plan-doodlejump-fixes.md §G.1).
    wallet: { coins: 0 },
    skins: { owned: ['default'], current: 'default' },
    difficulty: DEFAULT_DIFFICULTY,
    movingPlatforms: true,
    boosters: true,
    showButtons: true,
});

// Подписи к ключам DIFFICULTY из движка: список уровней берётся оттуда, чтобы новый
// уровень не пришлось дублировать в двух местах.
const DIFFICULTY_LABELS = Object.freeze({
    easy: 'Лёгкая',
    normal: 'Обычная',
    hard: 'Сложная',
});

export default {
    id: 'doodlejump',
    title: 'Дудл Джамп',
    tagline: 'Прыгай выше — не упади',
    // Хаб и панель настроек сами дописывают fa-solid — здесь только имя глифа, как у
    // остальных игр. Наличие fa-shoe-prints в наборе ST 1.18.0 проверяется на живой
    // инсталляции (Фаза 5).
    icon: 'fa-shoe-prints',
    defaults: DEFAULTS,
    slash: { name: 'doodlejump', help: 'Открыть игру «Дудл Джамп»' },
    mount(root, api) {
        return createDoodleJumpScreen(root, api);
    },
    // Общие хелперы оболочки, а не своя разметка: блоки игр в одной панели должны
    // выглядеть одинаково (и клик по подписи — переключать чекбокс).
    renderSettings(container, api) {
        if (!container) return;
        const settings = api.settings;

        // Сложность и движущиеся платформы — живые: экран перечитывает их каждый кадр
        // и передаёт генератору, так что переключатель действует на идущую партию.
        container.appendChild(row('Сложность', select(
            'doodlejump_difficulty',
            Object.keys(DIFFICULTY).map((key) => [key, DIFFICULTY_LABELS[key] ?? key]),
            DIFFICULTY[settings.difficulty] ? settings.difficulty : DEFAULT_DIFFICULTY,
            (value) => {
                settings.difficulty = DIFFICULTY[value] ? value : DEFAULT_DIFFICULTY;
                api.save();
            },
        )));

        container.appendChild(checkbox(
            'doodlejump_moving_platforms',
            'Движущиеся платформы',
            settings.movingPlatforms !== false,
            (checked) => {
                settings.movingPlatforms = checked;
                api.save();
            },
        ));

        // Кнопки — единственная чисто визуальная настройка: сама собой открытый экран её
        // не заметит, поэтому пинаем окно через onSettingsChanged → refresh().
        container.appendChild(checkbox(
            'doodlejump_boosters',
            'Бустеры (пропеллер и ракета)',
            settings.boosters !== false,
            (checked) => {
                settings.boosters = checked;
                api.save();
            },
        ));

        container.appendChild(checkbox(
            'doodlejump_show_buttons',
            'Экранные кнопки влево/вправо',
            settings.showButtons !== false,
            (checked) => {
                settings.showButtons = checked;
                api.save();
                api.onSettingsChanged?.(settings);
            },
        ));
    },
    renderStats(container, api) {
        if (!container) return;
        container.innerHTML = '';
        const stats = readStats(api.settings.stats);

        // Та же шапка, что у остальных игр: «Статистика» слева, «Сбросить» справа.
        const header = document.createElement('div');
        header.className = 'stg-row doodlejump-stats-header';
        const heading = document.createElement('b');
        heading.textContent = 'Статистика';
        header.appendChild(heading);
        container.appendChild(header);

        const played = document.createElement('div');
        played.textContent = `Сыграно: ${stats.played}`;
        const bestScore = document.createElement('div');
        bestScore.textContent = `Лучшая высота: ${stats.bestScore}`;
        const bestPlatforms = document.createElement('div');
        bestPlatforms.textContent = `Лучший забег по платформам: ${stats.bestPlatforms}`;
        // Кошелёк живёт рядом со статистикой, но не внутри неё: «Сбросить» ниже чистит
        // только stats, монеты остаются.
        const coins = document.createElement('div');
        coins.textContent = `Монет в кошельке: ${readWallet(api.settings).coins}`;
        container.append(played, bestScore, bestPlatforms, coins);

        if (stats.played || stats.bestScore || stats.bestPlatforms) {
            const btn = document.createElement('button');
            btn.className = 'menu_button';
            btn.title = 'Обнулить статистику';
            btn.textContent = 'Сбросить';
            btn.addEventListener('click', () => {
                resetStats(api.settings.stats);
                api.save();
                api.renderAllStats();
            });
            header.appendChild(btn);
        }
    },
};

function createDoodleJumpScreen(root, api) {
    root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'doodlejump-root';
    root.appendChild(screen);
    root = screen;

    // Счёт — HTML-шапкой, а не текстом на канвасе: на канвасе он мылится при DPI-скейле и
    // не берёт цвета из палитры, а элемент решает обе проблемы бесплатно.
    const header = document.createElement('div');
    header.className = 'doodlejump-header';
    const scoreEl = document.createElement('span');
    const platformsEl = document.createElement('span');
    const coinsEl = document.createElement('span');
    const bestEl = document.createElement('span');
    header.appendChild(scoreEl);
    header.appendChild(platformsEl);
    header.appendChild(coinsEl);
    header.appendChild(bestEl);
    // Вход в магазин из шапки: он же доступен с экрана проигрыша — там момент «потратить»
    // самый естественный, но ждать падения ради переодевания игрок не обязан.
    const shopBtn = document.createElement('button');
    shopBtn.className = 'doodlejump-shop-open menu_button';
    shopBtn.textContent = 'Магазин';
    header.appendChild(shopBtn);
    root.appendChild(header);

    const settings = api.settings;

    const stage = document.createElement('div');
    stage.className = 'doodlejump-stage';
    // Скин перечитывается из настроек каждый кадр — покупка в магазине видна сразу.
    const view = createView({ getSkinId: () => readSkins(settings).current });
    stage.appendChild(view.root);

    // Оверлей висит на обёртке канваса (position: relative), а не на корне: он должен
    // лежать ровно поверх поля, не накрывая шапку и кнопки.
    const overlay = document.createElement('div');
    overlay.className = 'doodlejump-over';
    overlay.innerHTML = '<div class="doodlejump-over-content"></div>';
    overlay.style.display = 'none';
    stage.appendChild(overlay);

    // Магазин — второй оверлей на той же сцене, а не отдельная игра в хабе: покупают
    // скины для этой игры и надевают их тут же, уходить за этим некуда
    // (docs/plan-doodlejump-fixes.md §G.3). Лежит после оверлея падения, поэтому,
    // открытый с экрана проигрыша, честно накрывает его собой.
    const shop = document.createElement('div');
    shop.className = 'doodlejump-shop';
    shop.style.display = 'none';
    stage.appendChild(shop);
    root.appendChild(stage);

    // Клавиатура и кнопки держат СВОИ флаги и сообщают свой вклад по отдельности —
    // складываем их здесь, чтобы отпускание кнопки не сбрасывало зажатую клавишу.
    //
    // Ведение пальцем в эту сумму не входит: его значение дробное, и Math.sign() схлопнул
    // бы всю аналоговость обратно в ±1. Правило — побеждает последний активный источник:
    // палец на поле задаёт намерение целиком (dragDir — число), отпустили (null) —
    // вернулась сумма клавиатуры и кнопок.
    let keyDir = 0;
    let btnDir = 0;
    let dragDir = null;
    function applyInput() {
        const dir = dragDir === null ? Math.sign(keyDir + btnDir) : dragDir;
        if (state) setInput(state, dir);
    }

    const buttons = createButtons({
        onInput: (dir) => {
            btnDir = dir;
            applyInput();
        },
    });
    root.appendChild(buttons.root);

    const drag = createDrag({
        canvas: view.canvas,
        getPlayerX: () => state.player.x,
        onInput: (dir) => {
            dragDir = dir;
            applyInput();
        },
    });

    const status = document.createElement('div');
    status.className = 'doodlejump-status';
    root.appendChild(status);

    let state = newGame();
    let manualPaused = false;
    let autoPaused = false;
    // Пока магазин открыт, партия стоит на manualPaused — третий флаг паузы заводить не за
    // что. Запоминаем только, была ли пауза до открытия, чтобы закрытие магазина не сняло
    // паузу, поставленную игроком руками.
    let pausedBeforeShop = false;
    let lastFrame = null;
    let rafId = null;
    let overRecorded = false;
    let cashedOut = false;
    let destroyed = false;

    const paused = () => manualPaused || autoPaused;

    function newGame() {
        return createGame({
            rng: Math.random,
            difficulty: settings.difficulty,
            movingPlatforms: settings.movingPlatforms !== false,
            boosters: settings.boosters !== false,
        });
    }

    function applyVisibility() {
        buttons.root.style.display = settings.showButtons === false ? 'none' : '';
    }

    function updateHeader() {
        const best = readStats(settings.stats);
        scoreEl.textContent = `Высота: ${state.score}`;
        platformsEl.textContent = `Платформ: ${state.landings}`;
        // За заезд, а не всего: кошелёк — это накопленное, и путать одно с другим в
        // шапке нельзя. Итог заезда уезжает в кошелёк в cashOut().
        coinsEl.textContent = `Монеты: ${state.coins}`;
        bestEl.textContent = `Рекорд: ${best.bestScore}`;
    }

    function updateStatus() {
        if (shopOpen()) {
            status.textContent = 'Магазин — партия на паузе';
        } else if (!state.alive) {
            status.textContent = 'Падение. Нажмите Enter для новой игры.';
        } else if (paused()) {
            status.textContent = 'Пауза';
        } else {
            status.textContent = '';
        }
    }

    function showOver() {
        overlay.style.display = 'flex';
        const content = overlay.querySelector('.doodlejump-over-content');
        const best = readStats(settings.stats);
        const isBest = state.score > best.bestScore || state.landings > best.bestPlatforms;
        let html = `<div>Высота ${state.score}</div><div>Платформ ${state.landings}</div>`;
        if (isBest) html += '<div>Новый рекорд!</div>';
        html += '<button class="doodlejump-over-restart menu_button">Ещё раз</button>';
        // Монеты заезда уже в кошельке (record() → cashOut()), так что момент «потратить»
        // здесь самый естественный — вход в магазин прямо с экрана проигрыша.
        html += '<button class="doodlejump-over-shop menu_button">Магазин</button>';
        content.innerHTML = html;
        const restartBtn = content.querySelector('.doodlejump-over-restart');
        if (restartBtn) {
            restartBtn.addEventListener('click', () => {
                restartBtn.blur();
                restart();
            });
        }
        const overShopBtn = content.querySelector('.doodlejump-over-shop');
        if (overShopBtn) {
            overShopBtn.addEventListener('click', () => {
                overShopBtn.blur();
                openShop();
            });
        }
        updateStatus();
    }

    const shopOpen = () => shop.style.display !== 'none';

    // Превью скина — тот же draw, что и в игре, на маленьком канвасе: реестр для того и
    // сделан функцией отрисовки, чтобы картинку в магазине не рисовать вторым способом.
    function drawPreview(canvas, skin) {
        const ctx2d = canvas.getContext('2d');
        // jsdom без пакета canvas контекста не даёт — плитка остаётся без картинки, но
        // магазин работает: то же осознанное ограничение, что и у поля.
        if (!ctx2d) return;
        const style = getComputedStyle(canvas);
        const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
        const scale = Math.min(canvas.width / PLAYER_W, canvas.height / PLAYER_H) * 0.8;
        const w = PLAYER_W * scale;
        const h = PLAYER_H * scale;
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        skin.draw(ctx2d, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h, 1, resolveColors(skin, pick));
    }

    function renderShop() {
        const wallet = readWallet(settings);
        const { owned, current } = readSkins(settings);
        shop.innerHTML = '';

        const content = document.createElement('div');
        content.className = 'doodlejump-shop-content';

        const title = document.createElement('b');
        title.textContent = 'Магазин';
        const balance = document.createElement('div');
        balance.className = 'doodlejump-shop-balance';
        // Кошелёк, а не счётчик заезда: тратить можно только накопленное.
        balance.textContent = `Монет: ${wallet.coins}`;
        content.append(title, balance);

        const items = document.createElement('div');
        items.className = 'doodlejump-shop-items';
        for (const skin of SKINS) {
            const isOwned = owned.includes(skin.id);
            const isWorn = skin.id === current;

            const item = document.createElement('div');
            item.className = 'doodlejump-shop-item';
            item.dataset.skinId = skin.id;
            if (isWorn) item.classList.add('is-worn');

            const preview = document.createElement('canvas');
            preview.className = 'doodlejump-shop-preview';
            preview.width = 72;
            preview.height = 72;

            const name = document.createElement('div');
            name.className = 'doodlejump-shop-name';
            name.textContent = skin.title;

            const note = document.createElement('div');
            note.className = 'doodlejump-shop-note';
            if (isWorn) note.textContent = 'Надет';
            else if (isOwned) note.textContent = 'Куплен';
            else note.textContent = `Цена: ${skin.price}`;

            const btn = document.createElement('button');
            btn.className = 'doodlejump-shop-action menu_button';
            if (isWorn) {
                btn.textContent = 'Надет';
                btn.disabled = true;
            } else if (isOwned) {
                btn.textContent = 'Надеть';
                btn.addEventListener('click', () => {
                    wearSkin(settings, skin.id);
                    api.save();
                    renderShop();
                    view.draw(state);
                });
            } else {
                btn.textContent = `Купить за ${skin.price}`;
                btn.addEventListener('click', () => {
                    // Цену магазин передаёт сам: реестр скинов живёт в ui/, и ядро о нём
                    // знать не должно (docs/plan-doodlejump-fixes.md §G.3).
                    const res = buySkin(settings, skin.id, skin.price);
                    if (!res.ok) {
                        if (res.reason === 'poor') api.toast('info', 'Не хватает монет');
                        renderShop();
                        return;
                    }
                    api.save();
                    api.renderAllStats?.();
                    renderShop();
                    view.draw(state);
                });
            }

            item.append(preview, name, note, btn);
            items.appendChild(item);
            // Рисовать после вставки в документ: цвета берутся из палитры .stg-root
            // через getComputedStyle, а вне дерева наследовать их неоткуда.
            drawPreview(preview, skin);
        }
        content.appendChild(items);

        const close = document.createElement('button');
        close.className = 'doodlejump-shop-close menu_button';
        close.textContent = 'Закрыть';
        close.addEventListener('click', () => {
            close.blur();
            closeShop();
        });
        content.appendChild(close);

        shop.appendChild(content);
    }

    function openShop() {
        if (shopOpen()) return;
        pausedBeforeShop = manualPaused;
        manualPaused = true;
        shop.style.display = 'flex';
        renderShop();
        updateStatus();
    }

    function closeShop() {
        if (!shopOpen()) return;
        shop.style.display = 'none';
        shop.innerHTML = '';
        manualPaused = pausedBeforeShop;
        // Часы цикла стояли всё это время: без сброса первый кадр после закрытия пришёл бы
        // с огромным dt — та же причина, что и при возврате на вкладку.
        lastFrame = null;
        state.accumulatorMs = 0;
        updateStatus();
        view.draw(state);
    }

    shopBtn.addEventListener('click', () => {
        shopBtn.blur();
        if (shopOpen()) closeShop();
        else openShop();
    });

    // Запись результата — строго один раз за заезд: rAF после падения продолжает крутиться
    // (оверлей и рестарт живут в том же цикле), и без флага статистика писалась бы каждый
    // кадр.
    // Монеты заезда уезжают в кошелёк строго один раз — как и запись результата, и по той
    // же причине: rAF после падения продолжает крутиться.
    //
    // Брошенный заезд (закрыли окно, ушли в хаб) монеты ЗАСЧИТЫВАЕТ: игрок их собрал, и
    // отбирать собранное за то, что окно закрыли, — наказание на ровном месте. Обратное
    // решение к тому же поощряло бы досиживать до падения ради валюты. Поэтому cashOut()
    // зовётся и из record(), и из destroy(), а флаг не даёт заплатить дважды.
    function cashOut() {
        if (cashedOut) return;
        cashedOut = true;
        if (!state.coins) return;
        try {
            addCoins(settings, state.coins);
            api.save();
            api.renderAllStats?.();
        } catch (err) {
            logError('не удалось записать монеты дудл джампа', err);
        }
    }

    function record() {
        if (overRecorded) return;
        overRecorded = true;
        cashOut();
        try {
            const result = recordResult(settings.stats, { score: state.score, platforms: state.landings });
            api.save();
            api.renderAllStats();
            if (result.bestScore || result.bestPlatforms) api.toast('success', 'Новый рекорд в «Дудл Джампе»!');
        } catch (err) {
            logError('не удалось записать результат дудл джампа', err);
        }
    }

    function restart() {
        // Новый заезд с открытой витриной — бессмыслица: закрываем её, а не оставляем
        // висеть поверх свежей партии.
        closeShop();
        // На всякий случай и здесь: после падения монеты уже в кошельке (record()), но
        // рестарт не должен быть способом потерять собранное ни при каком порядке событий.
        cashOut();
        cashedOut = false;
        state = newGame();
        applyInput();
        manualPaused = false;
        autoPaused = false;
        lastFrame = null;
        overRecorded = false;
        overlay.style.display = 'none';
        overlay.querySelector('.doodlejump-over-content').innerHTML = '';
        try {
            recordPlayed(settings.stats);
            api.save();
            api.renderAllStats();
        } catch (e) {
            logError('не удалось обновить статистику дудл джампа при рестарте', e);
        }
        updateHeader();
        updateStatus();
        view.draw(state);
    }

    function onFrame(now) {
        // Правило 7 контракта: кадр, уже стоящий в очереди, обязан проверить, жив ли
        // экран, — cancelAnimationFrame его не догонит.
        if (destroyed) return;
        if (lastFrame === null) lastFrame = now;
        const dt = now - lastFrame;
        lastFrame = now;

        // Палец мог не двигаться, а фигурка — да: намерение считается от расстояния между
        // ними, значит его надо пересчитать до физики, а не только по pointermove.
        drag.update();

        if (!paused() && state.alive) {
            // Сложность и движущиеся платформы — живые настройки: генератор перечитывает
            // их на каждом достраивании поля, так что переключатель в панели действует на
            // идущую партию, а не со следующей.
            setDifficulty(state, settings.difficulty);
            setMovingPlatforms(state, settings.movingPlatforms !== false);
            setBoosters(state, settings.boosters !== false);
            const res = advance(state, dt);
            if (res.fell) {
                showOver();
                record();
            }
        }

        updateHeader();
        updateStatus();
        view.draw(state);
        rafId = requestAnimationFrame(onFrame);
    }

    const keyboard = attachKeyboard({
        onInput: (dir) => {
            keyDir = dir;
            applyInput();
        },
        // Пока открыт магазин, пауза и рестарт с клавиатуры игнорируются: партия и так
        // стоит, а Enter не должен начинать новый заезд за спиной у витрины.
        onPause: () => {
            if (shopOpen()) return;
            manualPaused = !manualPaused;
            updateStatus();
        },
        onRestart: () => {
            if (!state.alive && !shopOpen()) restart();
        },
    });

    // Уходя со вкладки — пауза: физика тут непрерывная, и без паузы первый кадр после
    // возврата пришёл бы с огромным dt. Накопитель advance() его обрезает, но фигурка всё
    // равно проделала бы восемь подшагов вслепую — честнее просто встать.
    function resume() {
        autoPaused = false;
        lastFrame = null;
        state.accumulatorMs = 0;
        updateStatus();
    }
    function onVisibility() {
        if (document.hidden) {
            autoPaused = true;
            updateStatus();
        } else {
            resume();
        }
    }
    function onBlur() {
        autoPaused = true;
        // keyup зажатой клавиши после ухода со вкладки не придёт — снимаем флаги сами.
        keyboard.release();
        buttons.release();
        drag.release();
        updateStatus();
    }
    function onFocus() {
        resume();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    // «Сыграно» растёт в момент старта заезда, а не при его конце: брошенные партии иначе
    // нигде бы не отражались.
    try {
        recordPlayed(settings.stats);
        api.save();
        api.renderAllStats();
    } catch (e) {
        logError('не удалось обновить статистику дудл джампа при старте', e);
    }

    applyVisibility();
    updateHeader();
    updateStatus();
    view.draw(state);
    rafId = requestAnimationFrame(onFrame);

    return {
        // Настройки правят в другой панели при открытом экране: показ кнопок — чисто
        // визуальная вещь, её и подхватываем здесь (сложность живая сама по себе).
        refresh() {
            if (destroyed) return;
            applyVisibility();
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            cashOut();
            if (rafId) cancelAnimationFrame(rafId);
            keyboard.destroy();
            buttons.destroy();
            drag.destroy();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
            root.innerHTML = '';
        },
    };
}
