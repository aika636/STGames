// Статистика реверси по уровням: сыграно, победы, поражения, ничьи и лучший разрыв.
// Чистый модуль без DOM и без SillyTavern.
//
// Формат — { [level]: { played, wins, losses, draws, bestDiff } }, он же лежит в
// settings.stats и уходит в extensionSettings как есть, без конвертации.
//
// «Сыграно» считается по началу партии, а не по её концу: иначе брошенные партии нигде
// бы не отражались, а сумма побед, поражений и ничьих всегда совпадала бы со «сыграно».
// Восстановленная партия повторно не считается — счётчик трогает только старт новой.
//
// bestDiff — лучший (наибольший) перевес игрока в выигранной партии, в фишках. Только по
// победам: «лучший разрыв −40» — не достижение, а способ запутать таблицу.
//
// Данные приходят из settings.json, который игрок может править руками, поэтому каждое
// чтение нормализует запись: испорченное поле обнуляется, а не роняет панель настроек.

export const EMPTY_ENTRY = Object.freeze({ played: 0, wins: 0, losses: 0, draws: 0, bestDiff: null });

export const WIN = 'win';
export const LOSS = 'loss';
export const DRAW = 'draw';

function toCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toDiff(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

// Запись уровня без мутации входного объекта — для отрисовки.
export function readEntry(stats, level) {
    const entry = stats?.[level];
    return {
        played: toCount(entry?.played),
        wins: toCount(entry?.wins),
        losses: toCount(entry?.losses),
        draws: toCount(entry?.draws),
        bestDiff: toDiff(entry?.bestDiff),
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

// outcome — WIN / LOSS / DRAW, diff — перевес игрока в фишках (может быть отрицательным).
// Возвращает { bestDiff }: стал ли разрыв рекордом уровня — экран говорит об этом
// отдельным тостом.
export function recordResult(stats, level, outcome, diff) {
    const entry = entryFor(stats, level);

    if (outcome === WIN) entry.wins += 1;
    else if (outcome === LOSS) entry.losses += 1;
    else entry.draws += 1;

    const margin = outcome === WIN ? toDiff(diff) : null;
    const isBest = margin !== null && (entry.bestDiff === null || margin > entry.bestDiff);
    if (isBest) entry.bestDiff = margin;

    return { bestDiff: isBest };
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
