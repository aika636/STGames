// Тесты статистики реверси (Фаза 8.4): счётчики по уровням, лучший разрыв, устойчивость
// к руками поправленному settings.json и сброс на месте.
//
// Запуск: node tests/reversi/stats.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    DRAW, LOSS, WIN,
    isEmpty, readEntry, recordPlayed, recordResult, resetStats,
} from '../../src/games/reversi/core/stats.js';

console.log('reversi stats');

test('пустая статистика читается нулями, а не падает', () => {
    const entry = readEntry({}, 'medium');
    assertEqual(entry.played, 0, 'сыграно');
    assertEqual(entry.wins, 0, 'побед');
    assertEqual(entry.losses, 0, 'поражений');
    assertEqual(entry.draws, 0, 'ничьих');
    assertEqual(entry.bestDiff, null, 'разрыва нет');
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
    recordResult(stats, 'medium', WIN, 10);
    recordResult(stats, 'medium', LOSS, -12);
    recordResult(stats, 'medium', DRAW, 0);

    const entry = readEntry(stats, 'medium');
    assertEqual(entry.wins, 1, 'побед');
    assertEqual(entry.losses, 1, 'поражений');
    assertEqual(entry.draws, 1, 'ничьих');
});

test('лучший разрыв растёт только по победам и только вверх', () => {
    const stats = {};

    assertEqual(recordResult(stats, 'hard', WIN, 8).bestDiff, true, 'первая победа — рекорд');
    assertEqual(readEntry(stats, 'hard').bestDiff, 8, 'разрыв записан');

    assertEqual(recordResult(stats, 'hard', WIN, 4).bestDiff, false, 'победа скромнее рекорда');
    assertEqual(readEntry(stats, 'hard').bestDiff, 8, 'рекорд не понизился');

    assertEqual(recordResult(stats, 'hard', WIN, 20).bestDiff, true, 'победа крупнее');
    assertEqual(readEntry(stats, 'hard').bestDiff, 20, 'рекорд обновился');

    // Поражение с большим по модулю перевесом соперника — не достижение: в таблице
    // «лучший разрыв −40» только запутал бы.
    assertEqual(recordResult(stats, 'hard', LOSS, -40).bestDiff, false, 'поражение рекорда не даёт');
    assertEqual(readEntry(stats, 'hard').bestDiff, 20, 'рекорд прежний');
    assertEqual(recordResult(stats, 'hard', DRAW, 0).bestDiff, false, 'ничья рекорда не даёт');
});

test('битые значения из settings.json нормализуются при чтении', () => {
    const stats = {
        medium: { played: 'много', wins: -3, losses: null, draws: 1.7, bestDiff: 'ага' },
        hard: 'вообще не объект',
    };

    const entry = readEntry(stats, 'medium');
    assertEqual(entry.played, 0, 'строка вместо числа');
    assertEqual(entry.wins, 0, 'отрицательное');
    assertEqual(entry.losses, 0, 'null');
    assertEqual(entry.draws, 1, 'дробное округляется вниз');
    assertEqual(entry.bestDiff, null, 'битый разрыв');
    assertEqual(readEntry(stats, 'hard').played, 0, 'запись не объект');
    assert(isEmpty(stats), 'без единой сыгранной партии статистика пуста');
});

test('запись поверх битого значения чинит его на месте', () => {
    const stats = { easy: { played: 'нет', wins: 5 } };
    recordPlayed(stats, 'easy');

    assertEqual(stats.easy.played, 1, 'счётчик начат с нуля');
    assertEqual(stats.easy.wins, 5, 'здоровое поле сохранено');
    assertEqual(stats.easy.bestDiff, null, 'отсутствующее поле заведено');
});

test('resetStats чистит объект на месте, не подменяя ссылку', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    recordResult(stats, 'easy', WIN, 6);

    const same = resetStats(stats);
    assert(same === stats, 'вернулся тот же объект');
    assertEqual(Object.keys(stats).length, 0, 'ключей не осталось');
    assert(isEmpty(stats), 'статистика снова пуста');
});

report('reversi stats');
