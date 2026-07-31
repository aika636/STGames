// Статистика по уровням: сколько партий начато, сколько решено, лучшее время.
// Чистый модуль без DOM и без SillyTavern.
//
// Формат — простой объект { [difficulty]: { played, solved, bestTimeMs } }, он же лежит
// в settings.stats и уходит в extensionSettings как есть, без конвертации.
//
// «Сыграно» считается по началу партии, а не по её концу: иначе брошенные партии нигде
// бы не отражались и «решено» всегда совпадало бы со «сыграно». Восстановленная партия
// повторно не считается — счётчик трогает только создание новой доски.
//
// Данные приходят из settings.json, который игрок может править руками, поэтому каждое
// чтение нормализует запись: испорченное поле обнуляется, а не роняет панель настроек.

export const EMPTY_ENTRY = Object.freeze({ played: 0, solved: 0, bestTimeMs: null });

function toCount(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toTime(value) {
    return Number.isFinite(value) && value > 0 ? value : null;
}

// Запись уровня без мутации входного объекта — для отрисовки.
export function readEntry(stats, difficulty) {
    const entry = stats?.[difficulty];
    return {
        played: toCount(entry?.played),
        solved: toCount(entry?.solved),
        bestTimeMs: toTime(entry?.bestTimeMs),
    };
}

// Запись уровня внутри stats, созданная при первом обращении и починенная на месте.
// Мутирует stats: он живой объект настроек, копия здесь только мешала бы.
function entryFor(stats, difficulty) {
    const current = readEntry(stats, difficulty);
    stats[difficulty] = current;
    return current;
}

export function recordPlayed(stats, difficulty) {
    const entry = entryFor(stats, difficulty);
    entry.played += 1;
    return entry;
}

// Возвращает true, если время стало новым рекордом уровня, — окно сообщает об этом
// игроку отдельным тостом.
export function recordSolved(stats, difficulty, elapsedMs) {
    const entry = entryFor(stats, difficulty);
    entry.solved += 1;

    const time = toTime(elapsedMs);
    const isBest = time !== null && (entry.bestTimeMs === null || time < entry.bestTimeMs);
    if (isBest) entry.bestTimeMs = time;
    return isBest;
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
