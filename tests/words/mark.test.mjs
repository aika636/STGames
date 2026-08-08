// Тесты разметки догадки (Фаза 9.2): повторяющиеся буквы, мультимножественный
// инвариант, монотонность клавиатуры и подсказки для жёсткого режима.
//
// Запуск: node tests/words/mark.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    ABSENT, CORRECT, PRESENT, UNKNOWN,
    keyboardState, letterState, markGuess, revealedHints,
} from '../../src/games/words/core/mark.js';
import { unpack } from '../../src/games/words/core/dictionary.js';
import packedAnswers from '../../src/games/words/data/answers.js';

console.log('words mark');

// Компактная запись ожидания: 'к' — на месте, 'е' — есть в слове, '.' — нет.
const CODES = { k: CORRECT, e: PRESENT, '.': ABSENT };
const expect = (pattern) => [...pattern].map((ch) => CODES[ch]);
const show = (marks) => marks.map((m) => (m === CORRECT ? 'k' : m === PRESENT ? 'e' : '.')).join('');

function assertMarks(secret, guess, pattern) {
    const actual = show(markGuess(secret, guess));
    assertEqual(actual, pattern, `${secret} / ${guess}`);
}

test('слово против самого себя — всё на месте', () => {
    assertMarks('ПОРОГ', 'ПОРОГ', 'kkkkk');
});

test('ни одной общей буквы — всё серое', () => {
    assertMarks('ПОРОГ', 'ЧАСТЬ', '.....');
});

test('ТРАВА / АТАКА — лишняя А не жёлтая', () => {
    // Обе А секрета израсходованы зелёными на позициях 2 и 4. Наивное
    // secret.includes(guess[i]) красит первую А жёлтым.
    assertMarks('ТРАВА', 'АТАКА', '.ek.k');
});

test('ЗАМОК / КУБОК — К уже израсходована зелёной правее', () => {
    // Единственная К секрета стоит на позиции 4 и совпала. Однопроходная
    // реализация красит К на позиции 0 жёлтым, ещё не зная про совпадение.
    assertMarks('ЗАМОК', 'КУБОК', '...kk');
});

test('ВОЛНА / ОКОВЫ — из двух О жёлтая только первая', () => {
    // В секрете одна О, ни одна не на месте. Без списывания из остатка
    // жёлтыми станут обе.
    assertMarks('ВОЛНА', 'ОКОВЫ', 'e..e.');
});

test('мультимножественный инвариант на случайных парах', () => {
    const words = unpack(packedAnswers);
    const count = (word, letter) => [...word].filter((ch) => ch === letter).length;
    for (let i = 0; i < words.length; i += 7) {
        const secret = words[i];
        const guess = words[(i * 13 + 5) % words.length];
        const marks = markGuess(secret, guess);
        for (const letter of new Set(guess)) {
            const coloured = marks.filter((m, j) => guess[j] === letter && m !== ABSENT).length;
            assertEqual(
                coloured,
                Math.min(count(guess, letter), count(secret, letter)),
                `${secret} / ${guess}: буква ${letter}`,
            );
        }
        for (let j = 0; j < guess.length; j++) {
            assertEqual(
                marks[j] === CORRECT,
                guess[j] === secret[j],
                `${secret} / ${guess}: зелёное ⟺ совпадение на позиции ${j}`,
            );
        }
    }
});

test('разметка симметрична по количеству цветов', () => {
    const words = unpack(packedAnswers);
    for (let i = 0; i < words.length; i += 11) {
        const a = words[i];
        const b = words[(i * 7 + 3) % words.length];
        const forward = markGuess(a, b);
        const backward = markGuess(b, a);
        const tally = (marks, kind) => marks.filter((m) => m === kind).length;
        assertEqual(tally(forward, CORRECT), tally(backward, CORRECT), `${a}/${b}: зелёных`);
        assertEqual(tally(forward, PRESENT), tally(backward, PRESENT), `${a}/${b}: жёлтых`);
    }
});

// --- клавиатура ---

test('невстречавшаяся буква — unknown', () => {
    const state = keyboardState('ПОРОГ', ['ЧАСТЬ']);
    assertEqual(letterState(state, 'Ю'), UNKNOWN, 'буква не вводилась');
    assertEqual(letterState(state, 'Ч'), ABSENT, 'буква вводилась и не подошла');
});

test('состояние буквы не понижается', () => {
    // «А» зелёная в первой догадке и не на месте во второй — обязана остаться зелёной.
    const state = keyboardState('КАРТА', ['ЗАБОР', 'АТЛАС']);
    assertEqual(letterState(state, 'А'), CORRECT, 'А остаётся зелёной');
    assertEqual(letterState(state, 'Р'), PRESENT, 'Р есть в слове, но не на месте');
    assertEqual(letterState(state, 'З'), ABSENT, 'З в слове нет');
});

test('порядок догадок на клавиатуру не влияет', () => {
    const direct = keyboardState('КАРТА', ['ЗАБОР', 'АТЛАС']);
    const reversed = keyboardState('КАРТА', ['АТЛАС', 'ЗАБОР']);
    for (const letter of 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ') {
        assertEqual(letterState(direct, letter), letterState(reversed, letter), `буква ${letter}`);
    }
});

// --- подсказки для жёсткого режима ---

test('пустая история не раскрывает ничего', () => {
    const { fixed, minCounts } = revealedHints('ПОРОГ', [], 5);
    assertEqual(fixed.filter(Boolean).length, 0, 'зелёных нет');
    assertEqual(minCounts.size, 0, 'жёлтых нет');
});

test('зелёная буква фиксирует позицию, жёлтая — присутствие', () => {
    const { fixed, minCounts } = revealedHints('ЗАМОК', ['КУБОК'], 5);
    assertEqual(fixed[3], 'О', 'О на четвёртой позиции');
    assertEqual(fixed[4], 'К', 'К на пятой позиции');
    assertEqual(fixed[0], null, 'первая позиция свободна');
    assertEqual(minCounts.get('К'), 1, 'К обязана быть один раз');
    assertEqual(minCounts.get('У'), undefined, 'У ничего не требует');
});

test('два вхождения буквы требуют двух — но считаются по одной догадке', () => {
    // «АТАКА» против «ТРАВА» даёт одну жёлтую А и одну зелёную — итого две.
    const { minCounts } = revealedHints('ТРАВА', ['АТАКА'], 5);
    assertEqual(minCounts.get('А'), 2, 'две А раскрыты одной строкой');

    // А вот две отдельные догадки, каждая с одной А, не превращаются в требование двух:
    // это одна и та же А, найденная дважды.
    const single = revealedHints('КАРТА', ['АЛЬФА'], 5).minCounts.get('А');
    assert(single <= 2, `«АЛЬФА» против «КАРТА» не должна требовать больше двух А: ${single}`);
    const repeated = revealedHints('ЗАБОР', ['АРБУЗ', 'АТЛАС'], 5).minCounts.get('А');
    assertEqual(repeated, 1, 'одна А, найденная дважды, требует одной');
});

report('words mark');
