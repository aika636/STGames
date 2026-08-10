// Статистика балды по уровням: сыграно, победы, поражения, ничьи и лучший счёт.
// Чистый модуль без DOM и без SillyTavern — тот же формат и та же логика, что у
// реверси (src/games/reversi/core/stats.js), только рекорд другой.
//
// Формат — { [level]: { played, wins, losses, draws, bestScore } }, он же лежит в
// settings.stats и уходит в extensionSettings как есть, без конвертации.
//
// «Сыграно» считается по началу партии, а не по её концу: иначе брошенные партии нигде
// бы не отражались, а сумма побед, поражений и ничьих всегда совпадала бы со «сыграно».
// Восстановленная партия повторно не считается — счётчик трогает только старт новой.
//
// bestScore — наибольшее число очков, набранное игроком за партию. В отличие от
// реверсного bestDiff, он считается и в проигранных партиях: очки в балде набираются
// своими словами, а не отбираются у соперника, и 40 очков в партии, проигранной 40:45,
// — ровно такое же достижение, как 40 очков в выигранной. Ничьи тоже засчитываются.
//
// Данные приходят из settings.json, который игрок может править руками, поэтому каждое
// чтение нормализует запись: испорченное поле обнуляется, а не роняет панель настроек.

export const EMPTY_ENTRY = Object.freeze({ played: 0, wins: 0, losses: 0, draws: 0, bestScore: null });

export const WIN = 'win';
export const LOSS = 'loss';
export const DRAW = 'draw';

function toCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toScore(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

/** Запись уровня без мутации входного объекта — для отрисовки. */
export function readEntry(stats, level) {
    const entry = stats?.[level];
    return {
        played: toCount(entry?.played),
        wins: toCount(entry?.wins),
        losses: toCount(entry?.losses),
        draws: toCount(entry?.draws),
        bestScore: toScore(entry?.bestScore),
    };
}

// Запись уровня внутри stats, созданная при первом обращении и починенная на месте.
// Мутирует stats: он живой объект настроек, копия здесь только мешала бы.
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

/**
 * Итог партии. outcome — WIN / LOSS / DRAW, score — очки игрока (не соперника).
 * Возвращает { bestScore }: стал ли счёт рекордом уровня — экран говорит об этом
 * отдельным тостом.
 */
export function recordResult(stats, level, outcome, score) {
    const entry = entryFor(stats, level);

    if (outcome === WIN) entry.wins += 1;
    else if (outcome === LOSS) entry.losses += 1;
    else entry.draws += 1;

    const value = toScore(score);
    const isBest = value !== null && (entry.bestScore === null || value > entry.bestScore);
    if (isBest) entry.bestScore = value;

    return { bestScore: isBest };
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
