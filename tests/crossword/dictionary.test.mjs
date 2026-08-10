// Тесты банка слов кроссворда-скелета (Фаза 12.1): формат упаковки и целостность
// сгенерированного списка.
//
// Банк генерируется `tools/build-dictionary.mjs --target crossword`, но проверяется
// здесь: сборка одноразовая и запускается руками, а разъехавшийся банк ломает
// офлайн-генератор молча.
//
// Ядра у кроссворда этот тест не касается намеренно: банк — это данные, и распаковка
// здесь своя, в десять строк. Пусть тест данных падает от данных, а не от чужого кода.
//
// Запуск: node tests/crossword/dictionary.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import packed from '../../src/games/crossword/data/words.js';

console.log('crossword dictionary');

const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const isRussian = (word) => [...word].every((letter) => LETTERS.includes(letter));

// Формат: объект «длина → отсортированная строка без разделителей», слайсы шириной
// в ключ. Та же распаковка, что у «Слов», только ширина берётся из ключа.
function unpack(length, source) {
    const words = [];
    for (let i = 0; i + length <= source.length; i += length) {
        words.push(source.slice(i, i + length));
    }
    return words;
}

const lengths = Object.keys(packed).map(Number).sort((a, b) => a - b);
const byLength = new Map(lengths.map((len) => [len, unpack(len, packed[len])]));
const all = lengths.flatMap((len) => byLength.get(len));

test('банк покрывает длины 3–9 и каждая длина непустая', () => {
    assertEqual(lengths[0], 3, 'самое короткое слово');
    assertEqual(lengths[lengths.length - 1], 9, 'самое длинное слово');
    assertEqual(lengths.length, 7, 'семь длин подряд');
    for (const len of lengths) {
        assert(byLength.get(len).length >= 100, `длина ${len}: слов мало (${byLength.get(len).length})`);
    }
});

test('каждая строка кратна своей длине', () => {
    for (const len of lengths) {
        assertEqual(packed[len].length % len, 0, `длина ${len}: строка не кратна`);
    }
});

test('все слова — русские буквы нужной длины, без «ё»', () => {
    for (const len of lengths) {
        for (const word of byLength.get(len)) {
            assertEqual(word.length, len, `слово «${word}» лежит не в своей длине`);
            assert(isRussian(word), `не русские буквы: «${word}»`);
            assert(!word.includes('Ё'), `«ё» в словаре: «${word}»`);
        }
    }
});

test('внутри каждой длины список отсортирован и без дубликатов', () => {
    for (const len of lengths) {
        const list = byLength.get(len);
        for (let i = 1; i < list.length; i++) {
            assert(list[i] > list[i - 1], `длина ${len}: порядок нарушен на «${list[i - 1]}» / «${list[i]}»`);
        }
    }
});

test('дубликатов нет и между длинами', () => {
    assertEqual(new Set(all).size, all.length, 'одно и то же слово встречается дважды');
});

test('слов хватает на банк головоломки', () => {
    assert(all.length > 3000, `всего слов мало: ${all.length}`);
});

test('стоп-лист не просочился в банк', () => {
    const set = new Set(all);
    for (const word of ['БЛЯДЬ', 'ГОВНО', 'ЗНАТЬ', 'ГЕНРИ']) {
        assert(!set.has(word), `слово из tools/stoplist.txt в банке: «${word}»`);
    }
});

test('обиходные слова на месте', () => {
    const set = new Set(all);
    for (const word of ['ДОМ', 'ЛУНА', 'ПОРОГ', 'ЗЕРКАЛО', 'КАРТОФЕЛЬ']) {
        assert(set.has(word), `в банке нет обиходного слова «${word}»`);
    }
});

report('crossword dictionary');
