// Тесты словаря «Слов» (Фаза 9.1): нормализация, распаковка, целостность обоих
// списков и главный инвариант «загадываемое слово можно ввести».
//
// Словари генерируются tools/build-dictionary.mjs, но проверяются здесь: сборка
// одноразовая и запускается руками, а разъехавшийся словарь ломает игру молча.
//
// Запуск: node tests/words/dictionary.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    WORD_LENGTH,
    alphabet, createDictionary, isWord, normalize, unpack,
} from '../../src/games/words/core/dictionary.js';
import packedAnswers from '../../src/games/words/data/answers.js';
import packedAllowed from '../../src/games/words/data/allowed.js';

console.log('words dictionary');

test('normalize приводит регистр и убирает «ё»', () => {
    assertEqual(normalize('ёжики'), 'ЕЖИКИ', 'строчное с ё');
    assertEqual(normalize('  Ёлка '), 'ЕЛКА', 'пробелы по краям');
    assertEqual(normalize('СЕСТРЫ'), 'СЕСТРЫ', 'уже нормализовано');
});

test('normalize идемпотентна и не падает на мусоре', () => {
    for (const raw of ['ёж', 'ЁЖ', ' пёс ', '', 'abc']) {
        assertEqual(normalize(normalize(raw)), normalize(raw), `идемпотентность на «${raw}»`);
    }
    assertEqual(normalize(null), '', 'null');
    assertEqual(normalize(undefined), '', 'undefined');
    assertEqual(normalize(42), '42', 'число');
});

test('isWord принимает только пять русских букв', () => {
    assert(isWord('ПОРОГ'), 'обычное слово');
    assert(!isWord('ПОРОГИ'), 'шесть букв');
    assert(!isWord('ПОРО'), 'четыре буквы');
    assert(!isWord('POROG'), 'латиница');
    assert(!isWord('ПОР Г'), 'пробел внутри');
    assert(!isWord('порог'), 'нижний регистр — normalize вызывается раньше');
    assert(!isWord('ПОЁРГ'), 'ё в игре не существует');
    assert(!isWord(''), 'пустая строка');
    assert(!isWord(null), 'не строка');
});

test('алфавит — 32 буквы без «ё»', () => {
    assertEqual(alphabet().length, 32, 'длина алфавита');
    assert(!alphabet().includes('Ё'), 'ё нет');
    assert(alphabet().includes('Ъ') && alphabet().includes('Э'), 'редкие буквы на месте');
});

test('unpack режет строку по пять букв и переживает мусор', () => {
    const words = unpack('ПОРОГСЛОВА');
    assertEqual(words.length, 2, 'два слова');
    assertEqual(words[0], 'ПОРОГ', 'первое');
    assertEqual(words[1], 'СЛОВА', 'второе');
    assertEqual(unpack('').length, 0, 'пустая строка');
    assertEqual(unpack(null).length, 0, 'не строка');
    assertEqual(unpack('ПОРОГАБВ').length, 1, 'хвост короче слова отбрасывается');
});

// --- целостность сгенерированных списков ---

const answers = unpack(packedAnswers);
const allowed = unpack(packedAllowed);

test('оба списка непустые и кратны длине слова', () => {
    assert(answers.length > 300, `загадываемых мало: ${answers.length}`);
    assert(allowed.length > 10000, `догадок мало: ${allowed.length}`);
    assertEqual(packedAnswers.length % WORD_LENGTH, 0, 'загадываемые кратны 5');
    assertEqual(packedAllowed.length % WORD_LENGTH, 0, 'догадки кратны 5');
});

test('все слова — ровно пять русских букв, без «ё»', () => {
    for (const list of [answers, allowed]) {
        for (const word of list) {
            assert(isWord(word), `не слово: «${word}»`);
        }
    }
});

test('оба списка отсортированы и без дубликатов', () => {
    for (const [name, list] of [['загадываемые', answers], ['догадки', allowed]]) {
        for (let i = 1; i < list.length; i++) {
            assert(list[i] > list[i - 1], `${name}: порядок нарушен на «${list[i - 1]}» / «${list[i]}»`);
        }
    }
});

test('загадываемые — подмножество догадок', () => {
    const set = new Set(allowed);
    const missing = answers.filter((word) => !set.has(word));
    assertEqual(missing.length, 0, `вне списка догадок: ${missing.slice(0, 5).join(' ')}`);
});

// --- словарь как объект ---

test('has нормализует вход и отвергает всё, чего в списке нет', () => {
    const dictionary = createDictionary('ПОРОГСЛОВА', 'ПОРОГСЛОВАТРАВА');
    assert(dictionary.has('ТРАВА'), 'слово из широкого списка');
    assert(dictionary.has('трава'), 'нижний регистр');
    assert(dictionary.has(' Трава '), 'пробелы по краям');
    assert(!dictionary.has('ЗАБОР'), 'слова нет в словаре');
    assert(!dictionary.has('TRAVA'), 'латиница');
    assert(!dictionary.has('ТРАВ'), 'четыре буквы');
    assert(!dictionary.has('ТРАВЫЙ'), 'шесть букв');
    assert(!dictionary.has(''), 'пустая строка');
    assert(!dictionary.has(null), 'не строка');
});

test('загадываемое всегда допустимо, даже если списки разъехались', () => {
    // Широкий список намеренно не содержит «СЛОВА» — конструктор обязан это починить,
    // иначе игра загадает слово, которое сама же не даст ввести.
    const dictionary = createDictionary('ПОРОГСЛОВА', 'ПОРОГТРАВА');
    assert(dictionary.has('СЛОВА'), 'загадываемое добрано в допустимые');
});

test('pick детерминирован при заданном rng и не выходит за границы', () => {
    const dictionary = createDictionary('ПОРОГСЛОВАТРАВА', 'ПОРОГСЛОВАТРАВА');
    assertEqual(dictionary.size, 3, 'три загадываемых');
    assertEqual(dictionary.pick(() => 0), 'ПОРОГ', 'начало списка');
    assertEqual(dictionary.pick(() => 0.5), 'СЛОВА', 'середина');
    // rng, вернувший ровно 1, — классический источник выхода за границу массива
    assertEqual(dictionary.pick(() => 0.999999), 'ТРАВА', 'конец списка');
    assertEqual(dictionary.pick(() => 1), 'ТРАВА', 'rng вернул единицу');
    assertEqual(createDictionary('', '').pick(() => 0), null, 'пустой словарь');
});

test('настоящий словарь загадывает только допустимые слова', () => {
    const dictionary = createDictionary(packedAnswers, packedAllowed);
    for (let i = 0; i < 200; i++) {
        const word = dictionary.pick(() => i / 200);
        assert(isWord(word), `загадано не слово: «${word}»`);
        assert(dictionary.has(word), `загадано недопустимое слово: «${word}»`);
    }
});

report('words dictionary');
