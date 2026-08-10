// Статистика кроссворда по уровням: сыграно, собрано и лучшее время. Формат и
// правила — как у нонограммы и сапёра: «сыграно» считается по началу партии,
// рекорд — только по собранным кроссвордам.
//
// Свой модуль, а не общий с соседями: игры в проекте не импортируют друг у друга
// ничего, иначе правка статистики одной игры молча меняет другую.

export const EMPTY_ENTRY = Object.freeze({ played: 0, wins: 0, bestTime: null });

function toCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toTime(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function readEntry(stats, level) {
    const entry = stats?.[level];
    return {
        played: toCount(entry?.played),
        wins: toCount(entry?.wins),
        bestTime: toTime(entry?.bestTime),
    };
}

function entryFor(stats, level) {
    const current = readEntry(stats, level);
    stats[level] = current;
    return current;
}

export function recordPlayed(stats, level) {
    const entry = entryFor(stats, level);
    entry.played += 1;
    return entry;
}

// Возвращает { bestTime }: стал ли результат рекордом уровня.
export function recordSolved(stats, level, seconds) {
    const entry = entryFor(stats, level);
    entry.wins += 1;
    const time = toTime(seconds);
    const isBest = time !== null && (entry.bestTime === null || time < entry.bestTime);
    if (isBest) entry.bestTime = time;
    return { bestTime: isBest };
}

// Чистит статистику на месте: объект тот же самый, что лежит в extensionSettings.
export function resetStats(stats) {
    for (const key of Object.keys(stats)) delete stats[key];
    return stats;
}

export function isEmpty(stats) {
    return Object.keys(stats ?? {}).every((key) => readEntry(stats, key).played === 0);
}

// Синонимы под общие имена из плана Фазы 12 — тот же код, чтобы UI мог звать
// статистику любым из двух привычных названий.
export { readEntry as readStats, recordSolved as recordResult };
