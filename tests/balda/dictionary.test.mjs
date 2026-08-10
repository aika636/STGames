// Тесты словаря балды (Фаза 13.1): нормализация, распаковка, бор и целостность
// сгенерированного списка.
//
// Словарь генерируется `tools/build-dictionary.mjs --target balda`, но проверяется
// здесь: сборка одноразовая и запускается руками, а разъехавшийся словарь ломает
// игру молча — соперник просто перестаёт находить слова.
//
// Запуск: node tests/balda/dictionary.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    MAX_LENGTH, MIN_LENGTH,
    alphabet, createDictionary, isWord, normalize, unpack,
} from '../../src/games/balda/core/dictionary.js';
import packed from '../../src/games/balda/data/words.js';

console.log('balda dictionary');

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

test('isWord принимает русские слова длины 2–25', () => {
    assert(isWord('ЕЖ'), 'две буквы — минимум');
    assert(isWord('ПОРОГ'), 'обычное слово');
    assert(isWord('А'.repeat(MAX_LENGTH)), 'ровно максимум');
    assert(!isWord('А'), 'одна буква');
    assert(!isWord('А'.repeat(MAX_LENGTH + 1)), 'длиннее поля 5×5');
    assert(!isWord('POROG'), 'латиница');
    assert(!isWord('ПОР Г'), 'пробел внутри');
    assert(!isWord('порог'), 'нижний регистр — normalize вызывается раньше');
    assert(!isWord('ПОЕРГ'.replace('Е', 'Ё')), 'ё в игре не существует');
    assert(!isWord(''), 'пустая строка');
    assert(!isWord(null), 'не строка');
});

test('алфавит — 32 буквы без «ё»', () => {
    assertEqual(alphabet().length, 32, 'длина алфавита');
    assert(!alphabet().includes('Ё'), 'ё нет');
    assert(alphabet().includes('Ъ') && alphabet().includes('Э'), 'редкие буквы на месте');
});

test('unpack режет каждую строку по своей длине и переживает мусор', () => {
    const words = unpack({ 3: 'ЕЖИКОТ', 5: 'ПОРОГСЛОВА' });
    assertEqual(words.length, 4, 'четыре слова');
    assert(words.includes('ЕЖИ') && words.includes('КОТ'), 'трёхбуквенные');
    assert(words.includes('ПОРОГ') && words.includes('СЛОВА'), 'пятибуквенные');
    assertEqual(unpack({}).length, 0, 'пустой объект');
    assertEqual(unpack(null).length, 0, 'не объект');
    assertEqual(unpack({ 5: 'ПОРОГАБВ' }).length, 1, 'хвост короче слова отбрасывается');
    assertEqual(unpack({ 5: 42, x: 'ПОРОГ' }).length, 0, 'нестроковое значение и нечисловой ключ');
});

// --- целостность сгенерированного словаря ---

const words = unpack(packed);
const lengths = Object.keys(packed).map(Number).sort((a, b) => a - b);

test('словарь непустой и покрывает длины, влезающие на поле 5×5', () => {
    assert(words.length > 15000, `слов мало: ${words.length}`);
    assertEqual(lengths[0], MIN_LENGTH, 'самое короткое слово');
    assert(lengths[lengths.length - 1] <= MAX_LENGTH, `слово длиннее поля: ${lengths[lengths.length - 1]}`);
});

test('каждая строка кратна своей длине', () => {
    for (const len of lengths) {
        assertEqual(packed[len].length % len, 0, `длина ${len}: строка не кратна`);
    }
});

test('все слова — русские буквы своей длины, без «ё»', () => {
    for (const len of lengths) {
        for (let i = 0; i + len <= packed[len].length; i += len) {
            const word = packed[len].slice(i, i + len);
            assertEqual(word.length, len, `слово «${word}» лежит не в своей длине`);
            assert(isWord(word), `не слово: «${word}»`);
            assert(!word.includes('Ё'), `«ё» в словаре: «${word}»`);
        }
    }
});

test('внутри каждой длины список отсортирован и без дубликатов', () => {
    for (const len of lengths) {
        let previous = '';
        for (let i = 0; i + len <= packed[len].length; i += len) {
            const word = packed[len].slice(i, i + len);
            if (previous) assert(word > previous, `длина ${len}: порядок нарушен на «${previous}» / «${word}»`);
            previous = word;
        }
    }
});

test('дубликатов нет и между длинами', () => {
    assertEqual(new Set(words).size, words.length, 'одно и то же слово встречается дважды');
});

// --- словарь как объект ---

const small = createDictionary({ 3: 'КОТЛЕС', 5: 'КОТИКПОРОГ' });

test('has нормализует вход и отвергает всё, чего в словаре нет', () => {
    assert(small.has('КОТ'), 'слово из словаря');
    assert(small.has('кот'), 'нижний регистр');
    assert(small.has(' Котик '), 'пробелы по краям');
    assert(!small.has('КО'), 'префикс — не слово');
    assert(!small.has('КОТИ'), 'слова нет в словаре');
    assert(!small.has('KOT'), 'латиница');
    assert(!small.has(''), 'пустая строка');
    assert(!small.has(null), 'не строка');
    assert(!small.has('А'.repeat(MAX_LENGTH + 1)), 'длиннее поля');
    assertEqual(small.size, 4, 'четыре слова');
    assertEqual(small.normalize('ёж'), 'ЕЖ', 'normalize доступна и через объект');
});

test('hasPrefix согласован с has', () => {
    assert(small.hasPrefix(''), 'пустой префикс начинает всё');
    assert(small.hasPrefix('К'), 'одна буква');
    assert(small.hasPrefix('КОТИ'), 'префикс длиннее слова из словаря');
    assert(small.hasPrefix('котик'), 'нижний регистр');
    assert(!small.hasPrefix('КЗ'), 'мёртвая ветка');
    assert(!small.hasPrefix('KO'), 'латиница');
    // Слово словаря обязано быть и своим собственным префиксом, и префиксом каждого
    // своего начала: на этом держится отсечение перебора у соперника.
    for (const word of small.words()) {
        assert(small.hasPrefix(word), `слово не считается префиксом: «${word}»`);
        for (let i = 1; i < word.length; i++) {
            assert(small.hasPrefix(word.slice(0, i)), `начало «${word.slice(0, i)}» отвергнуто`);
        }
    }
});

test('бор обходится по одной букве — контракт root/child/isWord', () => {
    let node = small.root();
    assert(node, 'корень есть');
    assert(!small.isWord(node), 'корень — не слово');
    for (const letter of 'КОТ') {
        node = small.child(node, letter);
        assert(node, `шаг по «${letter}» не удался`);
    }
    assert(small.isWord(node), 'КОТ — слово');
    const next = small.child(node, 'И');
    assert(next && !small.isWord(next), 'КОТИ — живой префикс, но не слово');
    assertEqual(small.child(small.root(), 'Ж'), null, 'мёртвая ветка обрывается');
    assertEqual(small.child(null, 'К'), null, 'мёртвый узел не роняет обход');
    assertEqual(small.maxLength, 5, 'самое длинное слово');
});

test('настоящий словарь отвечает на обиходные слова и на мусор', () => {
    const dictionary = createDictionary(packed);
    assertEqual(dictionary.size, words.length, 'в бор попали все слова');
    for (const word of ['КОТ', 'ЛУНА', 'ПОРОГ', 'БАЛДА', 'ЗЕРКАЛО']) {
        assert(dictionary.has(word), `нет обиходного слова «${word}»`);
        assert(dictionary.hasPrefix(word.slice(0, 2)), `нет префикса «${word.slice(0, 2)}»`);
    }
    assert(!dictionary.has('ЫЫЫЫЫ'), 'мусор');
    assert(!dictionary.has('DOMIK'), 'латиница');
    assert(!dictionary.hasPrefix('ЪЪ'), 'мёртвый префикс');
});

report('balda dictionary');
