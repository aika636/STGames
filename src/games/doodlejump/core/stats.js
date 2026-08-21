// Статистика «Дудл Джампа»: сколько заездов начато, лучшая высота и лучший заезд по числу
// платформ. Чистый модуль без DOM и без SillyTavern.
//
// Формат — простой объект { played, bestScore, bestPlatforms }, он же лежит в
// settings.stats и уходит в extensionSettings как есть, без конвертации.
//
// Второй показатель — не счёт, а число платформ, на которые фигурка успела приземлиться:
// косвенная мера аккуратности, отличная от чистой высоты (пружина или удачная серия
// коротких зазоров дают высоту дешевле, чем полсотни точных приземлений).
//
// «Сыграно» считается по старту заезда, а не по его концу: брошенные партии иначе нигде
// бы не отражались, а рекорды без «сыграно» не имели бы контекста.
//
// Данные приходят из settings.json, который игрок может править руками, поэтому каждое
// чтение нормализует запись: испорченное поле обнуляется, а не роняет панель настроек.

export const EMPTY_ENTRY = Object.freeze({ played: 0, bestScore: 0, bestPlatforms: 0 });

function toCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// Нормализованная запись без мутации входного объекта — для отрисовки и сверки рекордов.
export function readStats(stats) {
    return {
        played: toCount(stats?.played),
        bestScore: toCount(stats?.bestScore),
        bestPlatforms: toCount(stats?.bestPlatforms),
    };
}

// Запись внутри stats, созданная при первой записи и починенная на месте. Мутирует stats:
// он живой объект настроек, копия здесь только мешала бы.
function entryFor(stats) {
    const current = readStats(stats);
    stats.played = current.played;
    stats.bestScore = current.bestScore;
    stats.bestPlatforms = current.bestPlatforms;
    return stats;
}

export function recordPlayed(stats) {
    const entry = entryFor(stats);
    entry.played += 1;
    return entry;
}

// Возвращает { bestScore, bestPlatforms } — что стало новым рекордом, чтобы экран мог
// сказать «новый рекорд» отдельной строкой.
export function recordResult(stats, { score, platforms }) {
    const entry = entryFor(stats);
    const bestScore = toCount(score) > entry.bestScore;
    const bestPlatforms = toCount(platforms) > entry.bestPlatforms;
    if (bestScore) entry.bestScore = toCount(score);
    if (bestPlatforms) entry.bestPlatforms = toCount(platforms);
    return { bestScore, bestPlatforms };
}

// Чистит статистику на месте: объект тот же самый, что лежит в extensionSettings,
// поэтому подменять его новым нельзя — ссылку на старый держит getSettings().
export function resetStats(stats) {
    for (const key of Object.keys(stats)) delete stats[key];
    return stats;
}
