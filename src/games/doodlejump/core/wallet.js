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

// Скины в этом шаге не используются — ключ заводится сразу, чтобы магазину (шаг 2)
// досталась уже нормализованная запись, а не сюрприз из старых настроек.
//
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
