// Статистика сапёра по уровням: сыграно, разминировано и лучшее время. Чистый модуль
// без DOM и без SillyTavern — по образцу reversi/core/stats.js.
//
// Формат — { [level]: { played, wins, bestTime } }, он же лежит в settings.stats и
// уходит в extensionSettings как есть.
//
// «Сыграно» считается по началу партии (первое открытие поля), а не по её концу: иначе
// брошенные партии нигде бы не отражались. Восстановленная партия повторно не считается.
//
// bestTime — в секундах, только по выигранным партиям: «лучшее время» проигрыша на
// первом же клике не достижение.
//
// Данные приходят из settings.json, который игрок правит руками, поэтому каждое чтение
// нормализует запись: испорченное поле обнуляется, а не роняет панель настроек.

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

// Запись уровня внутри stats, созданная при первом обращении и починенная на месте.
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

// Возвращает { bestTime }: стал ли результат рекордом уровня — экран говорит об этом
// отдельным тостом.
export function recordResult(stats, level, won, seconds) {
    const entry = entryFor(stats, level);
    if (!won) return { bestTime: false };

    entry.wins += 1;
    const time = toTime(seconds);
    const isBest = time !== null && (entry.bestTime === null || time < entry.bestTime);
    if (isBest) entry.bestTime = time;
    return { bestTime: isBest };
}

// Чистит статистику на месте: объект тот же самый, что лежит в extensionSettings,
// поэтому подменять его новым нельзя — ссылку на старый держит getSettings().
export function resetStats(stats) {
    for (const key of Object.keys(stats)) delete stats[key];
    return stats;
}

export function isEmpty(stats) {
    return Object.keys(stats ?? {}).every((key) => readEntry(stats, key).played === 0);
}
