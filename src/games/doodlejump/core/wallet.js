// Кошелёк «Дудл Джампа»: монеты, накопленные за все заезды, и купленные скины. Чистый
// модуль без DOM и без SillyTavern, по образцу core/stats.js.
//
// Почему не внутри stats: stats — это «сыграно и рекорды», и в панели их обнуляет кнопка
// «Сбросить». Заработанное такой сброс трогать не должен, поэтому wallet и skins — свои
// ключи настроек игры (docs/plan-doodlejump-fixes.md §G.1).
//
// Данные приходят из settings.json, который игрок может править руками, поэтому каждое
// чтение нормализует запись: испорченное поле обнуляется, а не роняет панель. Битым может
// оказаться и сам контейнер (`wallet: "нет"`), поэтому функции принимают настройки игры
// целиком, а не под-объект: чинить контейнер снаружи было бы обязанностью каждого вызова.

export const DEFAULT_SKIN = 'default';
export const EMPTY_WALLET = Object.freeze({ coins: 0 });
export const EMPTY_SKINS = Object.freeze({ owned: Object.freeze([DEFAULT_SKIN]), current: DEFAULT_SKIN });

function toCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Нормализованный кошелёк без мутации входа — для отрисовки и сверки.
export function readWallet(settings) {
    return { coins: toCount(settings?.wallet?.coins) };
}

// Живой объект внутри настроек, созданный при первой записи и починенный на месте:
// подменять его новым нельзя — ссылку на настройки игры держит getGameSettings().
function walletFor(settings) {
    if (!isRecord(settings.wallet)) settings.wallet = { coins: 0 };
    settings.wallet.coins = toCount(settings.wallet.coins);
    return settings.wallet;
}

// Прибавляет монеты заезда к кошельку и возвращает новый итог. Отрицательное и мусорное
// значение — ноль: заезд может принести только неотрицательное число монет, а трата будет
// своей операцией магазина (шаг 2).
export function addCoins(settings, amount) {
    const wallet = walletFor(settings);
    wallet.coins += toCount(amount);
    return wallet.coins;
}

// Правила нормализации: owned — список непустых строк без повторов, в котором 'default'
// есть всегда (бесплатный скин нельзя потерять), current — только из owned.
export function readSkins(settings) {
    const raw = settings?.skins;
    const owned = [DEFAULT_SKIN];
    if (Array.isArray(raw?.owned)) {
        for (const id of raw.owned) {
            if (typeof id === 'string' && id && !owned.includes(id)) owned.push(id);
        }
    }
    const current = typeof raw?.current === 'string' && owned.includes(raw.current)
        ? raw.current
        : DEFAULT_SKIN;
    return { owned, current };
}

// Живая запись скинов внутри настроек — как walletFor: чинится на месте, потому что
// ссылку на настройки игры держит getGameSettings().
function skinsFor(settings) {
    const { owned, current } = readSkins(settings);
    if (!isRecord(settings.skins)) settings.skins = {};
    settings.skins.owned = owned;
    settings.skins.current = current;
    return settings.skins;
}

// Снимок состояния покупки: он же ответ на «получилось ли». Копии списков — чтобы
// вызывающий не правил настройки мимо этих функций.
function purchaseResult(ok, reason, wallet, skins) {
    return { ok, reason, coins: wallet.coins, owned: [...skins.owned], current: skins.current };
}

// Покупка скина: списать цену, добавить в owned и сразу надеть — покупают, чтобы носить.
//
// Цену передаёт вызывающий, а не берёт из реестра: реестр скинов — это функции отрисовки,
// он живёт в ui/skins.js, и ядру о нём знать нельзя (docs/plan-doodlejump-fixes.md §G.3).
// Отсюда же и id строкой: ядро не проверяет, что такой скин существует, — это забота
// магазина, который единственный знает список.
//
// Идемпотентно: уже купленный скин второй раз не покупается (reason 'owned'), не хватает
// монет — покупка не проходит и кошелёк НЕ меняется (reason 'poor'). В обоих случаях
// настройки остаются как были, кроме нормализации битой записи.
export function buySkin(settings, id, price) {
    const wallet = walletFor(settings);
    const skins = skinsFor(settings);
    if (typeof id !== 'string' || !id) return purchaseResult(false, 'unknown', wallet, skins);
    if (skins.owned.includes(id)) return purchaseResult(false, 'owned', wallet, skins);
    const cost = toCount(price);
    if (wallet.coins < cost) return purchaseResult(false, 'poor', wallet, skins);
    wallet.coins -= cost;
    skins.owned.push(id);
    skins.current = id;
    return purchaseResult(true, 'bought', wallet, skins);
}

// Надеть уже купленный скин. Некупленный (и мусорный id) игнорируется молча: надеть то,
// чего нет, — не ошибка игрока, а рассинхрон настроек с реестром. Возвращает current
// после операции.
export function wearSkin(settings, id) {
    const skins = skinsFor(settings);
    if (typeof id === 'string' && skins.owned.includes(id)) skins.current = id;
    return skins.current;
}
