// Тесты статистики балды (Фаза 13.2): счётчики по уровням, лучший счёт, устойчивость
// к руками поправленному settings.json и сброс на месте.
//
// Запуск: node tests/balda/stats.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    DRAW, LOSS, WIN,
    isEmpty, readEntry, recordPlayed, recordResult, resetStats,
} from '../../src/games/balda/core/stats.js';

console.log('balda stats');

test('пустая статистика читается нулями, а не падает', () => {
    const entry = readEntry({}, 'medium');
    assertEqual(entry.played, 0, 'сыграно');
    assertEqual(entry.wins, 0, 'побед');
    assertEqual(entry.losses, 0, 'поражений');
    assertEqual(entry.draws, 0, 'ничьих');
    assertEqual(entry.bestScore, null, 'рекорда нет');
    assertEqual(readEntry(undefined, 'medium').played, 0, 'stats может не быть вовсе');
    assert(isEmpty({}), 'пустая статистика считается пустой');
});

test('recordPlayed заводит запись уровня и растит счётчик', () => {
    const stats = {};
    recordPlayed(stats, 'hard');
    recordPlayed(stats, 'hard');
    recordPlayed(stats, 'easy');

    assertEqual(readEntry(stats, 'hard').played, 2, 'сложный');
    assertEqual(readEntry(stats, 'easy').played, 1, 'лёгкий');
    assertEqual(readEntry(stats, 'medium').played, 0, 'средний не тронут');
    assert(!isEmpty(stats), 'статистика больше не пустая');
});

test('результаты раскладываются по победам, поражениям и ничьим', () => {
    const stats = {};
    recordResult(stats, 'medium', WIN, 40);
    recordResult(stats, 'medium', LOSS, 20);
    recordResult(stats, 'medium', DRAW, 25);
    recordResult(stats, 'medium', WIN, 30);

    const entry = readEntry(stats, 'medium');
    assertEqual(entry.wins, 2, 'побед');
    assertEqual(entry.losses, 1, 'поражений');
    assertEqual(entry.draws, 1, 'ничьих');
});

test('рекорд счёта считается и в проигранных партиях', () => {
    const stats = {};
    assertEqual(recordResult(stats, 'hard', WIN, 30).bestScore, true, 'первая победа — рекорд');
    assertEqual(readEntry(stats, 'hard').bestScore, 30, 'рекорд записан');

    assertEqual(recordResult(stats, 'hard', WIN, 25).bestScore, false, 'меньший счёт рекорд не бьёт');
    assertEqual(readEntry(stats, 'hard').bestScore, 30, 'рекорд не тронут');

    // Главное отличие от реверси: очки в балде набираются своими словами, а не
    // отбираются у соперника, и в проигранной партии они такое же достижение.
    assertEqual(recordResult(stats, 'hard', LOSS, 44).bestScore, true, 'проигранная партия — рекорд');
    assertEqual(readEntry(stats, 'hard').bestScore, 44, 'рекорд обновлён');
    assertEqual(recordResult(stats, 'hard', DRAW, 50).bestScore, true, 'ничья тоже считается');
    assertEqual(readEntry(stats, 'hard').bestScore, 50, 'рекорд обновлён ничьей');
});

test('нулевой и отрицательный счёт рекордом не становится', () => {
    const stats = {};
    recordResult(stats, 'easy', LOSS, 0);
    assertEqual(readEntry(stats, 'easy').bestScore, null, 'ноль очков — не рекорд');
    recordResult(stats, 'easy', WIN, -5);
    assertEqual(readEntry(stats, 'easy').bestScore, null, 'мусорный счёт не записан');
});

test('испорченная запись чинится при чтении, а не роняет панель', () => {
    const stats = {
        hard: { played: 'много', wins: null, losses: -3, draws: 2.7, bestScore: 'ой' },
    };
    const entry = readEntry(stats, 'hard');
    assertEqual(entry.played, 0, 'сыграно');
    assertEqual(entry.wins, 0, 'побед');
    assertEqual(entry.losses, 0, 'поражений');
    assertEqual(entry.draws, 2, 'ничьих — дробное вниз');
    assertEqual(entry.bestScore, null, 'рекорда нет');

    recordPlayed(stats, 'hard');
    assertEqual(readEntry(stats, 'hard').played, 1, 'счётчик пошёл с починенного нуля');
});

test('resetStats чистит объект на месте', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    recordResult(stats, 'easy', WIN, 33);

    const same = resetStats(stats);
    assert(same === stats, 'вернулся тот же объект');
    assertEqual(Object.keys(stats).length, 0, 'ключей не осталось');
    assert(isEmpty(stats), 'статистика пуста');
});

report('balda stats');
