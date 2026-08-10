// Тесты статистики сапёра (Фаза 10.4): счётчики, рекорд времени, нормализация мусора
// из settings.json и сброс на месте.
//
// Запуск: node tests/minesweeper/stats.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    isEmpty,
    readEntry,
    recordPlayed,
    recordResult,
    resetStats,
} from '../../src/games/minesweeper/core/stats.js';

test('пустая статистика читается нулями', () => {
    const entry = readEntry({}, 'easy');
    assertEqual(entry.played, 0, 'сыграно');
    assertEqual(entry.wins, 0, 'побед');
    assertEqual(entry.bestTime, null, 'лучшее время');
});

test('recordPlayed растит счётчик своего уровня', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    recordPlayed(stats, 'easy');
    recordPlayed(stats, 'hard');
    assertEqual(readEntry(stats, 'easy').played, 2, 'лёгкий');
    assertEqual(readEntry(stats, 'hard').played, 1, 'сложный');
});

test('победа пишет рекорд, поражение — нет', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    assert(recordResult(stats, 'easy', true, 90).bestTime, 'первый результат — рекорд');
    assert(!recordResult(stats, 'easy', true, 120).bestTime, 'медленнее — не рекорд');
    assert(recordResult(stats, 'easy', true, 45).bestTime, 'быстрее — рекорд');
    assertEqual(readEntry(stats, 'easy').bestTime, 45, 'лучшее время');
    assertEqual(readEntry(stats, 'easy').wins, 3, 'побед');

    assert(!recordResult(stats, 'easy', false, 1).bestTime, 'проигрыш рекордом не бывает');
    assertEqual(readEntry(stats, 'easy').wins, 3, 'поражение не растит победы');
    assertEqual(readEntry(stats, 'easy').bestTime, 45, 'поражение не трогает рекорд');
});

test('битая запись из settings.json чинится на чтении', () => {
    const stats = { easy: { played: -3, wins: 'много', bestTime: 0 } };
    const entry = readEntry(stats, 'easy');
    assertEqual(entry.played, 0, 'отрицательное сыграно');
    assertEqual(entry.wins, 0, 'нечисловые победы');
    assertEqual(entry.bestTime, null, 'нулевое время');
});

test('resetStats чистит объект на месте', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    const same = resetStats(stats);
    assert(same === stats, 'ссылка та же');
    assert(isEmpty(stats), 'статистика пуста');
});

test('isEmpty не считает пустым уровень с партиями', () => {
    const stats = {};
    assert(isEmpty(stats), 'пусто');
    recordPlayed(stats, 'medium');
    assert(!isEmpty(stats), 'после партии не пусто');
});

report('minesweeper/stats');
