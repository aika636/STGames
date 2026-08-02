// Тесты статистики по уровням (Фаза 4). Чистое ядро, зависимостей нет.
// Запуск: node tests/stats.test.mjs

import { EMPTY_ENTRY, isEmpty, readEntry, recordPlayed, recordSolved, resetStats } from '../../src/games/sudoku/core/stats.js';
import { assert, assertEqual, report, test } from '../_harness.mjs';

console.log('stats');

test('пустая статистика читается как нули, а не как undefined', () => {
    const entry = readEntry({}, 'easy');
    assertEqual(entry.played, 0, 'сыграно');
    assertEqual(entry.solved, 0, 'решено');
    assertEqual(entry.bestTimeMs, null, 'лучшее время');
    assertEqual(EMPTY_ENTRY.bestTimeMs, null, 'у пустой записи нет рекорда');
});

test('readEntry не создаёт запись в объекте', () => {
    const stats = {};
    readEntry(stats, 'hard');
    // Панель настроек отрисовывается при каждой загрузке ST; если бы чтение писало
    // в настройки, в settings.json копились бы пустые уровни.
    assertEqual(Object.keys(stats).length, 0, 'ключей после чтения');
});

test('recordPlayed считает начатые партии по уровням раздельно', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    recordPlayed(stats, 'easy');
    recordPlayed(stats, 'expert');

    assertEqual(readEntry(stats, 'easy').played, 2, 'лёгких сыграно');
    assertEqual(readEntry(stats, 'expert').played, 1, 'экспертных сыграно');
    assertEqual(readEntry(stats, 'medium').played, 0, 'средних сыграно');
    assertEqual(readEntry(stats, 'easy').solved, 0, 'решено не выросло само');
});

test('recordSolved пишет рекорд и сообщает о нём', () => {
    const stats = {};
    recordPlayed(stats, 'medium');

    assert(recordSolved(stats, 'medium', 90_000), 'первое решение — всегда рекорд');
    assertEqual(readEntry(stats, 'medium').bestTimeMs, 90_000, 'лучшее время');

    assert(!recordSolved(stats, 'medium', 120_000), 'медленнее — не рекорд');
    assertEqual(readEntry(stats, 'medium').bestTimeMs, 90_000, 'рекорд не испортился');

    assert(recordSolved(stats, 'medium', 45_000), 'быстрее — рекорд');
    assertEqual(readEntry(stats, 'medium').bestTimeMs, 45_000, 'рекорд обновился');

    assertEqual(readEntry(stats, 'medium').solved, 3, 'решено');
    assertEqual(readEntry(stats, 'medium').played, 1, 'сыграно не растёт от решений');
});

// settings.json игрок может править руками, а расширение — обновляться. Панель
// настроек не должна падать из-за одного испорченного поля.
test('битые значения нормализуются, а не роняют чтение', () => {
    const stats = {
        easy: { played: 'много', solved: -3, bestTimeMs: 0 },
        hard: null,
        expert: { played: 2.7 },
    };

    assertEqual(readEntry(stats, 'easy').played, 0, 'строка вместо числа');
    assertEqual(readEntry(stats, 'easy').solved, 0, 'отрицательное значение');
    assertEqual(readEntry(stats, 'easy').bestTimeMs, null, 'нулевое время — не рекорд');
    assertEqual(readEntry(stats, 'hard').played, 0, 'null вместо записи');
    assertEqual(readEntry(stats, 'expert').played, 2, 'дробное значение округляется вниз');

    // Запись чинится на месте при первой же записи в неё.
    recordPlayed(stats, 'easy');
    assertEqual(readEntry(stats, 'easy').played, 1, 'счёт пошёл с нуля');
});

test('решение без валидного времени засчитывается, но рекордом не становится', () => {
    const stats = {};
    assert(!recordSolved(stats, 'easy', NaN), 'NaN — не рекорд');
    assertEqual(readEntry(stats, 'easy').solved, 1, 'партия всё равно засчитана');
    assertEqual(readEntry(stats, 'easy').bestTimeMs, null, 'рекорда нет');
});

test('resetStats чистит объект на месте', () => {
    const stats = {};
    recordPlayed(stats, 'easy');
    recordSolved(stats, 'easy', 60_000);

    const same = resetStats(stats);
    // Ссылку на этот объект держит extensionSettings — подменять его новым нельзя.
    assert(same === stats, 'вернулся тот же объект');
    assertEqual(Object.keys(stats).length, 0, 'ключей после сброса');
    assertEqual(readEntry(stats, 'easy').played, 0, 'счётчики обнулены');
});

test('isEmpty отличает «ни одной партии» от «есть что показать»', () => {
    assert(isEmpty({}), 'пустой объект');
    assert(isEmpty({ easy: { played: 0, solved: 0, bestTimeMs: null } }), 'запись без партий');

    const stats = {};
    recordPlayed(stats, 'hard');
    assert(!isEmpty(stats), 'после первой партии не пустая');
});

report('stats');
