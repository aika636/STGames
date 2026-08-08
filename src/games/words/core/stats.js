// Статистика «Слов»: сыграно, победы, поражения, серия и распределение по попыткам.
// Чистый модуль без DOM и без SillyTavern.
//
// Формат — { played, wins, losses, currentStreak, maxStreak, distribution: [6] }, он же
// лежит в settings.stats и уходит в extensionSettings как есть. Записи плоская, без
// разбивки по режимам: жёсткий режим — не отдельная таблица, а способ сыграть ту же
// партию строже, и разводить по нему две серии значило бы дробить и без того короткую
// историю.
//
// «Сыграно» считается по началу партии, а не по её концу — как во всех трёх играх до
// этой. Восстановленная партия повторно не считается. Отсюда законное расхождение
// wins + losses < played: брошенные партии остаются в «сыграно» и серию не ломают.
//
// Процент побед НЕ хранится: производные величины в settings.json рассинхронизируются
// с исходными при первой же ручной правке. Считается при отрисовке.
//
// Данные приходят из settings.json, который игрок может править руками, поэтому каждое
// чтение нормализует запись: испорченное поле обнуляется, а не роняет панель настроек.

import { MAX_ATTEMPTS } from './engine.js';

export const EMPTY_STATS = Object.freeze({
    played: 0,
    wins: 0,
    losses: 0,
    currentStreak: 0,
    maxStreak: 0,
    distribution: Object.freeze(new Array(MAX_ATTEMPTS).fill(0)),
});

function toCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toDistribution(value) {
    const source = Array.isArray(value) ? value : [];
    return Array.from({ length: MAX_ATTEMPTS }, (_, i) => toCount(source[i]));
}

/** Нормализованная копия — для отрисовки, без мутации входного объекта. */
export function readStats(stats) {
    const entry = {
        played: toCount(stats?.played),
        wins: toCount(stats?.wins),
        losses: toCount(stats?.losses),
        currentStreak: toCount(stats?.currentStreak),
        maxStreak: toCount(stats?.maxStreak),
        distribution: toDistribution(stats?.distribution),
    };
    // Инвариант maxStreak >= currentStreak держится всегда: в settings.json могло
    // оказаться что угодно, а таблица с рекордом меньше текущей серии выглядит поломкой.
    if (entry.maxStreak < entry.currentStreak) entry.maxStreak = entry.currentStreak;
    return entry;
}

// Чинит запись на месте. Мутирует stats: он живой объект настроек, копия здесь только
// мешала бы — ссылку на него держит getSettings().
function entryOf(stats) {
    const current = readStats(stats);
    Object.assign(stats, current);
    return stats;
}

/** Партия началась. Зовётся только при старте новой, не при восстановлении. */
export function recordPlayed(stats) {
    const entry = entryOf(stats);
    entry.played += 1;
    return entry;
}

/**
 * Партия кончилась.
 *
 * @param {object} stats
 * @param {number|null} attempt  с какой попытки угадано, или null при поражении
 * @returns {{ streakRecord: boolean }} серия стала рекордной — экран говорит об этом тостом
 */
export function recordResult(stats, attempt) {
    const entry = entryOf(stats);
    const won = Number.isInteger(attempt) && attempt >= 1 && attempt <= MAX_ATTEMPTS;

    if (won) {
        entry.wins += 1;
        entry.distribution[attempt - 1] += 1;
        entry.currentStreak += 1;
    } else {
        entry.losses += 1;
        entry.currentStreak = 0;
    }

    const streakRecord = won && entry.currentStreak > entry.maxStreak;
    if (streakRecord) entry.maxStreak = entry.currentStreak;

    return { streakRecord };
}

// Чистит статистику на месте: объект тот же самый, что лежит в extensionSettings,
// поэтому подменять его новым нельзя.
export function resetStats(stats) {
    for (const key of Object.keys(stats)) delete stats[key];
    return stats;
}

export function isEmpty(stats) {
    return readStats(stats).played === 0;
}

/** Процент побед — считается, а не хранится. */
export function winRate(stats) {
    const { played, wins } = readStats(stats);
    return played === 0 ? 0 : Math.round((wins / played) * 100);
}
