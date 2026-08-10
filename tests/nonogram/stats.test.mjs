// Тесты статистики нонограммы (Фаза 11.4): счётчики, рекорд времени, нормализация
// мусора из settings.json и сброс на месте.
//
// Запуск: node tests/nonogram/stats.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    isEmpty,
    readEntry,
    recordPlayed,
    recordSolved,
    resetStats,
} from '../../src/games/nonogram/core/stats.js';

test('пустая статистика читается нулями', () => {
    const entry = readEntry({}, 'easy');
    assertEqual(entry.played, 0, 'сыграно');
    assertEqual(entry.wins, 0, 'собрано');
    assertEqual(entry.bestTime, null, 'лучшее время');
});

test('recordPlayed растит счётчик своего уровня', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    recordPlayed(stats, 'hard');
    recordPlayed(stats, 'hard');
    assertEqual(readEntry(stats, 'easy').played, 1, 'лёгкий');
    assertEqual(readEntry(stats, 'hard').played, 2, 'сложный');
});

test('рекорд времени обновляется только вниз', () => {
    const stats = {};
    assert(recordSolved(stats, 'medium', 200).bestTime, 'первый результат — рекорд');
    assert(!recordSolved(stats, 'medium', 300).bestTime, 'медленнее — не рекорд');
    assert(recordSolved(stats, 'medium', 150).bestTime, 'быстрее — рекорд');
    assertEqual(readEntry(stats, 'medium').bestTime, 150, 'лучшее время');
    assertEqual(readEntry(stats, 'medium').wins, 3, 'собрано картинок');
});

test('битая запись из settings.json чинится на чтении', () => {
    const stats = { easy: { played: -1, wins: null, bestTime: 'быстро' } };
    const entry = readEntry(stats, 'easy');
    assertEqual(entry.played, 0, 'сыграно');
    assertEqual(entry.wins, 0, 'собрано');
    assertEqual(entry.bestTime, null, 'время');
});

test('resetStats чистит объект на месте', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    const same = resetStats(stats);
    assert(same === stats, 'ссылка та же');
    assert(isEmpty(stats), 'статистика пуста');
});

report('nonogram/stats');
