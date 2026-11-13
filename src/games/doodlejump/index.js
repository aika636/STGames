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
import { addCoins, buySkin, readSkins, readWallet, repairWallet, wearSkin } from './core/wallet.js';
import { logError } from '../../log.js';
import { checkbox, row, select } from '../../shell/settings-ui.js';
import { createView } from './ui/view.js';
import { resolveColors, SKINS } from './ui/skins.js';
import { attachKeyboard, createButtons, createDrag } from './ui/controls.js';

const DEFAULTS = Object.freeze({
    stats: {},
    // Кошелёк и скины — рядом со stats, а не внутри: кнопка «Сбросить» в панели обнуляет
    // статистику, и заработанное она трогать не должна.
    wallet: { coins: 0 },
    skins: { owned: ['default'], current: 'default' },
    difficulty: DEFAULT_DIFFICULTY,
    movingPlatforms: true,
    boosters: true,
    showButtons: true,
});

// Сколько кадров подряд имеет право упасть, прежде чем экран сдаётся. Один сбойный кадр —
// это ещё не поломка: он может прийтись на промежуточное состояние (пересчёт размеров при
// повороте телефона, пропавший 2d-контекст на переключении вкладок). Пять подряд — уже
// система, и продолжать значит крутить rAF вхолостую, заваливая консоль.
const FRAME_ERROR_LIMIT = 5;
const CRASH_STATUS = 'Игра остановлена из-за ошибки. Нажмите Enter, чтобы начать заново.';

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
    // инсталляции.
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
    // скины для этой игры и надевают их тут же, уходить за этим некуда.
    // Открытый с экрана проигрыша, он этот экран
    // прячет (openShop) и возвращает при закрытии — накрыть его собой нельзя, витрина
    // на светопрозрачной палитре темы просвечивает.
    // Пауза — плашка поверх поля, а не только строчка под кнопками: на снятых кадрах
    // экран паузы отличался от идущей партии одной мелкой подписью внизу, и игрок этой
    // разницы не видел.
    const pausePlate = document.createElement('div');
    pausePlate.className = 'doodlejump-pause';
    pausePlate.textContent = 'Пауза';
    pausePlate.style.display = 'none';
    stage.appendChild(pausePlate);

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
    // Был ли на экране итог заезда, когда открыли витрину: закрытие обязано вернуть его —
    // игрок не терял результат, он просто отходил переодеться.
    let overBeforeShop = false;
    let lastFrame = null;
    let rafId = null;
    let overRecorded = false;
    // Сколько монет текущего заезда уже уехало в кошелёк. См. cashOut().
    let cashedCoins = 0;
    let destroyed = false;
    // Подряд идущие сбойные кадры и «заезд остановлен ошибкой». См. onFrame().
    let frameErrors = 0;
    let crashed = false;

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
        // Плашка живёт по тем же условиям, что и строка статуса, поэтому и обновляется
        // здесь: не в витрине (там своя картинка), не после падения (там оверлей).
        pausePlate.style.display = paused() && state.alive && !crashed && !shopOpen() ? 'flex' : 'none';
        if (crashed) {
            status.textContent = CRASH_STATUS;
        } else if (shopOpen()) {
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
        // Палец, стоявший на поле в момент падения, отпускать некуда: события отпускания
        // на оверлее не будет. Оставленное намерение старше клавиатуры и кнопок, и новый
        // заезд начался бы с ходом в сторону точки старого падения.
        drag.release();
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
        // Превью копятся здесь и рисуются в конце, когда витрина уже в документе.
        const pending = [];
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
            // Отрисовки поля тут нет ни в одной ветке: канвас под витриной скрыт, у него
            // clientWidth === 0, и draw() уходил на фолбэк 320×512, перевыделяя буфер
            // (замер: 324×520 → 320×512 → 324×520). Новый скин показывает closeShop().
            let action = null;
            if (isWorn) {
                btn.textContent = 'Надет';
                btn.disabled = true;
            } else if (isOwned) {
                btn.textContent = 'Надеть';
                action = () => {
                    wearSkin(settings, skin.id);
                    api.save();
                    renderShop();
                };
            } else {
                btn.textContent = `Купить за ${skin.price}`;
                action = () => {
                    // Цену магазин передаёт сам: реестр скинов живёт в ui/, и ядро о нём
                    // знать не должно.
                    const res = buySkin(settings, skin.id, skin.price);
                    if (!res.ok) {
                        // Отклик на КАЖДУЮ причину: молча ничего не делающая кнопка
                        // читается как поломка игры, а не как отказ.
                        if (res.reason === 'poor') api.toast('info', 'Не хватает монет');
                        else if (res.reason === 'owned') api.toast('info', 'Скин уже куплен');
                        else api.toast('info', 'Такого скина нет');
                        renderShop();
                        return;
                    }
                    api.save();
                    api.renderAllStats?.();
                    renderShop();
                };
            }
            if (action) {
                btn.addEventListener('click', action);
                // Вся плитка — тоже цель: кнопка узкая (72 px превью против 22 px кнопки),
                // и промах мимо неё пальцем не делал ничего. Клик по самой кнопке сюда
                // всплывает — его пропускаем, иначе действие сработало бы дважды.
                item.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    action();
                });
            }

            item.append(preview, name, note, btn);
            items.appendChild(item);
            // Рисовать сейчас нельзя: плитка пока висит в отсоединённом поддереве, а цвета
            // берутся из палитры .stg-root через getComputedStyle — вне документа она
            // отдаёт пустые значения, и превью молча ушло бы на литеральные фолбэки
            // (на светлой теме это видно сразу: снежинка на белом почти пропадала).
            pending.push([preview, skin]);
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
        // Теперь плитки в документе и палитра до них доехала — можно рисовать.
        for (const [canvas, skin] of pending) drawPreview(canvas, skin);
    }

    function openShop() {
        if (shopOpen()) return;
        pausedBeforeShop = manualPaused;
        manualPaused = true;
        // Монеты заезда — в кошелёк прямо сейчас. Иначе витрина показывала бы баланс без
        // собранного («Монеты: 2» в шапке против «Монет: 0» в витрине) и не давала бы на
        // него купить. Обратной дороги у монет нет и так: заезд их не возвращает.
        cashOut();
        // И заодно чиним записи настроек, если их правили руками. Отдельным вызовом, а не
        // побочным действием покупки: сохранить починку надо в любом случае, а покупка
        // может и не состояться.
        try {
            repairWallet(settings);
            api.save();
        } catch (err) {
            logError('не удалось починить кошелёк дудл джампа', err);
        }
        // Экран проигрыша на время витрины убирается совсем, а не прикрывается ею: фон
        // витрины собран из --stg-surface и --stg-bg, а в режиме «Цвета таверны» обе эти
        // переменные сами полупрозрачные (см. блок палитры в style.css), и смесь двух
        // прозрачных цветов прозрачна — итог заезда просвечивал сквозь витрину прямо
        // поверх плиток. Непрозрачную подложку сюда не поставить: в режиме темы окно
        // игры сквозное осознанно. Прятать оверлей надёжнее — это не зависит ни от одного
        // из четырёх режимов оформления.
        overBeforeShop = overlay.style.display !== 'none';
        overlay.style.display = 'none';
        // По той же причине убирается и поле: витрина полупрозрачная, и платформы с
        // фигуркой рябили сквозь плитки. Прятать канвас, а не подкладывать под витрину
        // непрозрачный фон, — единственный способ, не зависящий от режима оформления.
        stage.classList.add('is-shopping');
        shop.style.display = 'flex';
        renderShop();
        updateStatus();
    }

    function closeShop() {
        if (!shopOpen()) return;
        shop.style.display = 'none';
        shop.innerHTML = '';
        stage.classList.remove('is-shopping');
        // Итог заезда возвращается ровно таким, каким был: разметку оверлея витрина не
        // трогала, показать его достаточно обратно.
        if (overBeforeShop) overlay.style.display = 'flex';
        overBeforeShop = false;
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
        // Считаем не «было ли уже», а СКОЛЬКО уже уехало: витрина открывается и посреди
        // заезда (там она зовёт cashOut(), чтобы показать честный баланс и дать на него
        // купить), после чего заезд продолжается и монеты копятся дальше. Флаг «уже
        // выплачено» терял бы всё, собранное после похода в магазин.
        const pending = state.coins - cashedCoins;
        if (pending <= 0) return;
        cashedCoins = state.coins;
        try {
            addCoins(settings, pending);
            api.save();
            api.renderAllStats?.();
        } catch (err) {
            logError('не удалось записать монеты дудл джампа', err);
        }
    }

    // announce: показывать ли тост о рекорде. Празднование адресовано тому, кто СМОТРИТ на
    // игру, поэтому из destroy() оно выключено: игрок уже закрыл окно, а тост живёт в
    // #toast-container поверх всего и несколько секунд глотает тапы по плиткам хаба.
    // Записать результат всё равно надо — это данные, а тост только сообщение о них.
    function record({ announce = true } = {}) {
        if (overRecorded) return;
        overRecorded = true;
        cashOut();
        try {
            const result = recordResult(settings.stats, { score: state.score, platforms: state.landings });
            api.save();
            api.renderAllStats();
            if (announce && (result.bestScore || result.bestPlatforms)) api.toast('success', 'Новый рекорд в «Дудл Джампе»!');
        } catch (err) {
            logError('не удалось записать результат дудл джампа', err);
        }
    }

    function restart() {
        // Цикл после crash() стоит — заводим его первым делом и ровно один раз. Первым,
        // потому что дальше по рестарту есть отрисовка, а она — один из подозреваемых:
        // упади она снова, кадровый цикл уже крутится и снова покажет это словами, вместо
        // того чтобы оставить экран немым.
        if (crashed) {
            crashed = false;
            frameErrors = 0;
            rafId = requestAnimationFrame(onFrame);
        }
        // Новый заезд с открытой витриной — бессмыслица: закрываем её, а не оставляем
        // висеть поверх свежей партии.
        closeShop();
        // И то же, что в showOver(): свежая партия начинается с нулевым намерением, а не
        // с тем, что осталось от пальца на прошлом заезде.
        drag.release();
        // На всякий случай и здесь: после падения монеты уже в кошельке (record()), но
        // рестарт не должен быть способом потерять собранное ни при каком порядке событий.
        cashOut();
        cashedCoins = 0;
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

    // Видимая остановка вместо немого замирания. Экран, на котором ничего не происходит и
    // ничего не написано, игрок читает как «зависло» — и идёт писать баг-репорт про
    // зависание, а не про ошибку. Поэтому сдавшийся цикл обязан сказать это словами.
    function crash() {
        crashed = true;
        // Собранное за заезд не пропадает: и монеты, и высота — игрок их набрал, ошибка
        // не его вина. record() сам зовёт cashOut() и защищён от повторной записи.
        record();
        const content = overlay.querySelector('.doodlejump-over-content');
        content.innerHTML = '<div>Что-то сломалось</div>'
            + `<div>Высота ${state.score}</div>`
            + '<button class="doodlejump-over-restart menu_button">Ещё раз</button>';
        const restartBtn = content.querySelector('.doodlejump-over-restart');
        restartBtn?.addEventListener('click', () => {
            restartBtn.blur();
            restart();
        });
        // Витрина открыта — ведём себя как showOver() под витриной: оверлей не показываем
        // (он оказался бы ПОД ней и запер бы экран), а помечаем, что его надо показать
        // после закрытия. Выход есть в обе стороны: «Закрыть» вернёт оверлей краха, Enter
        // начнёт новый заезд поверх витрины (restart() её закрывает сам).
        if (shopOpen()) overBeforeShop = true;
        else overlay.style.display = 'flex';
        updateStatus();
    }

    // Кадр целиком: физика, шапка, отрисовка. Отделён от onFrame(), чтобы планирование
    // следующего кадра жило СНАРУЖИ try/catch — иначе исключение внутри кадра уносило бы с
    // собой и планирование, то есть убивало бы игру навсегда и молча (ровно так и было).
    function runFrame(now) {
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
        // Витрина закрывает сцену целиком, а скрытый канвас не имеет клиентских размеров:
        // view.js уходил бы на фолбэк 320×512 и перевыделял буфер каждый кадр. Рисовать
        // нечего и незачем — картинку вернёт closeShop().
        if (!shopOpen()) view.draw(state);
    }

    function onFrame(now) {
        // Правило 7 контракта: кадр, уже стоящий в очереди, обязан проверить, жив ли
        // экран, — cancelAnimationFrame его не догонит. То же и для остановки по ошибке:
        // кадр из очереди не должен воскрешать цикл, который уже сдался.
        if (destroyed || crashed) return;
        try {
            runFrame(now);
            // Кадр прошёл целиком — серия оборвалась. Считаем именно ПОДРЯД идущие сбои:
            // одиночная осечка раз в минуту игре не мешает, а копящийся счётчик рано или
            // поздно остановил бы исправный заезд.
            frameErrors = 0;
        } catch (err) {
            frameErrors += 1;
            // Логируем каждый сбой серии, но серия ограничена FRAME_ERROR_LIMIT — потока в
            // консоль по кадру на каждый rAF не будет.
            logError(`ошибка в кадре дудл джампа (подряд ${frameErrors})`, err);
            if (frameErrors >= FRAME_ERROR_LIMIT) {
                crash();
                return;
            }
            // Часы кадра сбрасываем: время, пока разбирались с ошибкой, накопилось бы в
            // dt и следующий кадр прыгнул бы вслепую на восемь подшагов.
            lastFrame = null;
        }
        rafId = requestAnimationFrame(onFrame);
    }

    const keyboard = attachKeyboard({
        onInput: (dir) => {
            keyDir = dir;
            applyInput();
        },
        // Пока открыт магазин, пауза и рестарт с клавиатуры игнорируются: партия и так
        // стоит, а Enter не должен начинать новый заезд за спиной у витрины.
        //
        // Оба возвращают «сделал»: по этому признаку controls.js решает, гасить клавишу
        // или отдать её дальше. Пробел при открытой витрине не наш — им прокручивают
        // список скинов.
        onPause: () => {
            if (shopOpen()) return false;
            manualPaused = !manualPaused;
            updateStatus();
            return true;
        },
        onRestart: () => {
            // После остановки по ошибке Enter — единственный выход, поэтому он работает
            // и при живой партии, и поверх открытой витрины (restart() её закрывает).
            // Без краха витрина Enter не пропускает: начинать заезд за её спиной незачем.
            if (!crashed && (state.alive || shopOpen())) return false;
            restart();
            return true;
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
            // Брошенный заезд записывается целиком, а не наполовину. «Сыграно» на старте
            // уже отработало, монеты забирает cashOut() — оставлять при этом высоту
            // незаписанной значит терять данные: заезд числится сыгранным, но без
            // результата. Обоснование то же, что у монет («отбирать собранное за то, что
            // окно закрыли, — наказание на ровном месте»), а от двойной записи защищает
            // overRecorded.
            record({ announce: false });
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
