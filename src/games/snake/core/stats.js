// Статистика змейки: сколько заездов начато, лучший счёт и лучшая длина. Чистый модуль
// без DOM и без SillyTavern.
//
// Формат — простой объект { played, bestScore, bestLength }, он же лежит в
// settings.stats и уходит в extensionSettings как есть, без конвертации.
//
// «Сыграно» считается по старту заезда, а не по его концу: брошенные партии иначе нигде
// бы не отражались, а рекорды без «сыграно» не имели бы контекста.
//
// Данные приходят из settings.json, который игрок может править руками, поэтому каждое
// чтение нормализует запись: испорченное поле обнуляется, а не роняет панель настроек.

export const EMPTY_ENTRY = Object.freeze({ played: 0, bestScore: 0, bestLength: 0 });

function toCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

// Нормализованная запись без мутации входного объекта — для отрисовки и сверки рекордов.
export function readStats(stats) {
    return {
        played: toCount(stats?.played),
        bestScore: toCount(stats?.bestScore),
        bestLength: toCount(stats?.bestLength),
    };
}

// Запись внутри stats, созданная при первой записи и починенная на месте. Мутирует stats:
// он живой объект настроек, копия здесь только мешала бы. Запись — сам stats, поэтому
// дальше писать надо прямо в него, а не в копию из readStats.
function entryFor(stats) {
    const current = readStats(stats);
    stats.played = current.played;
    stats.bestScore = current.bestScore;
    stats.bestLength = current.bestLength;
    return stats;
}

export function recordPlayed(stats) {
    const entry = entryFor(stats);
    entry.played += 1;
    return entry;
}

// Возвращает { bestScore, bestLength } — что стало новым рекордом, чтобы экран мог
// сказать «новый рекорд» отдельной строкой.
export function recordResult(stats, { score, length }) {
    const entry = entryFor(stats);
    const bestScore = toCount(score) > entry.bestScore;
    const bestLength = toCount(length) > entry.bestLength;
    if (bestScore) entry.bestScore = toCount(score);
    if (bestLength) entry.bestLength = toCount(length);
    return { bestScore, bestLength };
}

// Чистит статистику на месте: объект тот же самый, что лежит в extensionSettings,
// поэтому подменять его новым нельзя — ссылку на старый держит getSettings().
export function resetStats(stats) {
    for (const key of Object.keys(stats)) delete stats[key];
    return stats;
}
