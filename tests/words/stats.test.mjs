// Тесты статистики «Слов» (Фаза 9.5): счётчики, распределение по попыткам, серия,
// устойчивость к руками поправленному settings.json и сброс на месте.
//
// Запуск: node tests/words/stats.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    isEmpty, readStats, recordPlayed, recordResult, resetStats, winRate,
} from '../../src/games/words/core/stats.js';

console.log('words stats');

test('пустая статистика читается нулями, а не падает', () => {
    const entry = readStats({});
    assertEqual(entry.played, 0, 'сыграно');
    assertEqual(entry.wins, 0, 'побед');
    assertEqual(entry.losses, 0, 'поражений');
    assertEqual(entry.currentStreak, 0, 'серия');
    assertEqual(entry.maxStreak, 0, 'рекорд серии');
    assertEqual(entry.distribution.length, 6, 'распределение на шесть попыток');
    assertEqual(readStats(undefined).played, 0, 'stats может не быть вовсе');
    assert(isEmpty({}), 'пустая статистика считается пустой');
});

test('readStats не мутирует вход', () => {
    const stats = {};
    readStats(stats);
    assertEqual(Object.keys(stats).length, 0, 'объект остался пустым');
});

test('recordPlayed растит счётчик партий', () => {
    const stats = {};
    recordPlayed(stats);
    recordPlayed(stats);
    assertEqual(readStats(stats).played, 2, 'две партии');
    assertEqual(readStats(stats).wins, 0, 'побед пока нет');
    assert(!isEmpty(stats), 'статистика больше не пустая');
});

test('победа пишется в распределение и растит серию', () => {
    const stats = {};
    recordPlayed(stats);
    const result = recordResult(stats, 3);
    const entry = readStats(stats);
    assertEqual(entry.wins, 1, 'победа');
    assertEqual(entry.distribution[2], 1, 'угадано с третьей попытки');
    assertEqual(entry.distribution[0], 0, 'первая попытка не тронута');
    assertEqual(entry.currentStreak, 1, 'серия');
    assertEqual(entry.maxStreak, 1, 'рекорд');
    assert(result.streakRecord, 'первая победа — уже рекорд');
});

test('поражение обнуляет серию, но не рекорд', () => {
    const stats = {};
    recordResult(stats, 2);
    recordResult(stats, 4);
    assertEqual(readStats(stats).maxStreak, 2, 'рекорд серии — две');
    recordResult(stats, null);
    const entry = readStats(stats);
    assertEqual(entry.losses, 1, 'поражение');
    assertEqual(entry.currentStreak, 0, 'серия оборвалась');
    assertEqual(entry.maxStreak, 2, 'рекорд остался');
    assertEqual(entry.distribution.reduce((a, b) => a + b, 0), 2, 'поражение не попало в распределение');
});

test('рекорд серии не уменьшается ни при какой последовательности', () => {
    const stats = {};
    // Псевдослучайная, но воспроизводимая череда результатов.
    let seed = 7;
    for (let i = 0; i < 200; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const attempt = seed % 7;
        recordPlayed(stats);
        recordResult(stats, attempt === 0 ? null : attempt);
        const entry = readStats(stats);
        assert(entry.maxStreak >= entry.currentStreak, `шаг ${i}: рекорд меньше текущей серии`);
    }
    const entry = readStats(stats);
    assertEqual(entry.wins + entry.losses, 200, 'все партии учтены');
    assertEqual(entry.distribution.reduce((a, b) => a + b, 0), entry.wins, 'распределение сходится с победами');
});

test('несуществующий номер попытки считается поражением', () => {
    const stats = {};
    recordResult(stats, 0);
    recordResult(stats, 7);
    recordResult(stats, 1.5);
    recordResult(stats, 'три');
    assertEqual(readStats(stats).losses, 4, 'все четыре — поражения');
    assertEqual(readStats(stats).distribution.reduce((a, b) => a + b, 0), 0, 'распределение пустое');
});

test('битые значения нормализуются, а не роняют чтение', () => {
    const entry = readStats({
        played: 'много',
        wins: -5,
        losses: 2.7,
        currentStreak: 4,
        maxStreak: 1,               // меньше текущей серии
        distribution: 'не массив',
    });
    assertEqual(entry.played, 0, 'строка вместо числа');
    assertEqual(entry.wins, 0, 'отрицательное');
    assertEqual(entry.losses, 2, 'дробное усечено');
    assertEqual(entry.maxStreak, 4, 'рекорд подтянут до текущей серии');
    assertEqual(entry.distribution.length, 6, 'распределение восстановлено');

    const short = readStats({ distribution: [1, 2] });
    assertEqual(short.distribution.length, 6, 'короткое распределение дополнено');
    assertEqual(short.distribution[1], 2, 'что было — сохранилось');
    assertEqual(short.distribution[5], 0, 'чего не было — ноль');

    const long = readStats({ distribution: new Array(20).fill(3) });
    assertEqual(long.distribution.length, 6, 'длинное распределение обрезано');
});

test('winRate считается, а не хранится', () => {
    const stats = {};
    assertEqual(winRate(stats), 0, 'пустая статистика — ноль, а не деление на ноль');
    recordPlayed(stats); recordPlayed(stats); recordPlayed(stats); recordPlayed(stats);
    recordResult(stats, 1); recordResult(stats, 2); recordResult(stats, 3);
    assertEqual(winRate(stats), 75, 'три победы из четырёх партий');
    assert(!('winRate' in stats), 'процент в настройки не пишется');
});

test('resetStats чистит объект на месте', () => {
    const stats = {};
    recordPlayed(stats);
    recordResult(stats, 2);
    const same = resetStats(stats);
    assert(same === stats, 'ссылка не подменилась');
    assertEqual(Object.keys(stats).length, 0, 'ключей не осталось');
    assert(isEmpty(stats), 'статистика снова пустая');
});

report('words stats');
