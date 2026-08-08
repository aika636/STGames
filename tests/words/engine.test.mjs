// Тесты партии «Слов» (Фаза 9.3): подача догадки, жёсткий режим, конец партии,
// сериализация и устойчивость к руками поправленному settings.json.
//
// Запуск: node tests/words/engine.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    GAME_OVER, HARD_FIXED, HARD_MISSING, LOST, NOT_IN_DICTIONARY, PLAYING, TOO_SHORT, WON,
    attemptsLeft, checkHard, createGame, deserialize, marks, serialize, submitGuess, surrender,
    winningAttempt,
} from '../../src/games/words/core/engine.js';
import { createDictionary, unpack } from '../../src/games/words/core/dictionary.js';
import packedAnswers from '../../src/games/words/data/answers.js';
import packedAllowed from '../../src/games/words/data/allowed.js';

console.log('words engine');

const dictionary = createDictionary(packedAnswers, packedAllowed);
const snapshot = (state) => JSON.stringify(serialize(state)) + state.status;

test('новая партия пуста и играется', () => {
    const state = createGame({ secret: 'ПОРОГ' });
    assertEqual(state.status, PLAYING, 'статус');
    assertEqual(state.guesses.length, 0, 'догадок нет');
    assertEqual(attemptsLeft(state), 6, 'шесть попыток');
    assertEqual(state.length, 5, 'длина слова в состоянии');
    assertEqual(state.hardMode, false, 'жёсткий режим выключен');
});

test('загадать не-слово нельзя', () => {
    for (const bad of ['ПОРО', 'ПОРОГИ', 'POROG', '', null]) {
        let threw = false;
        try { createGame({ secret: bad }); } catch { threw = true; }
        assert(threw, `«${bad}» не должно загадываться`);
    }
    assertEqual(createGame({ secret: ' пёсик ' }).secret, 'ПЕСИК', 'регистр, пробелы и «ё»');
});

test('верная догадка выигрывает партию', () => {
    const state = createGame({ secret: 'ПОРОГ' });
    const result = submitGuess(state, 'порог', dictionary);
    assert(result.ok, 'догадка принята');
    assertEqual(state.status, WON, 'победа');
    assertEqual(winningAttempt(state), 1, 'угадано с первой попытки');
});

test('невалидная догадка не меняет состояние и не тратит попытку', () => {
    const state = createGame({ secret: 'ПОРОГ' });
    submitGuess(state, 'ЗАБОР', dictionary);
    const before = snapshot(state);

    assertEqual(submitGuess(state, 'ЗАБО', dictionary).reason, TOO_SHORT, 'четыре буквы');
    assertEqual(submitGuess(state, 'ЗАБОРЫ', dictionary).reason, TOO_SHORT, 'шесть букв');
    assertEqual(submitGuess(state, 'ZABOR', dictionary).reason, TOO_SHORT, 'латиница');
    assertEqual(submitGuess(state, 'ЪЪЪЪЪ', dictionary).reason, NOT_IN_DICTIONARY, 'не слово');
    assertEqual(submitGuess(state, '', dictionary).reason, TOO_SHORT, 'пустая строка');

    assertEqual(snapshot(state), before, 'состояние не изменилось');
    assertEqual(attemptsLeft(state), 5, 'потрачена ровно одна попытка');
});

test('шестая неудачная попытка заканчивает партию', () => {
    const state = createGame({ secret: 'ПОРОГ' });
    const wrong = ['ЗАБОР', 'ЧАСТЬ', 'КНИГА', 'ВЕТЕР', 'МЕСТО', 'ЗЕМЛЯ'];
    for (const guess of wrong) assert(submitGuess(state, guess, dictionary).ok, `догадка ${guess}`);
    assertEqual(state.status, LOST, 'поражение');
    assertEqual(attemptsLeft(state), 0, 'попыток не осталось');
    assertEqual(winningAttempt(state), null, 'победной попытки нет');
});

test('после конца партии догадки не принимаются', () => {
    const state = createGame({ secret: 'ПОРОГ' });
    submitGuess(state, 'ПОРОГ', dictionary);
    const before = snapshot(state);
    assertEqual(submitGuess(state, 'ЗАБОР', dictionary).reason, GAME_OVER, 'партия окончена');
    assertEqual(snapshot(state), before, 'состояние не изменилось');
});

test('сдача засчитывает поражение и повторно не срабатывает', () => {
    const state = createGame({ secret: 'ПОРОГ' });
    submitGuess(state, 'ЗАБОР', dictionary);
    assert(surrender(state), 'первая сдача сработала');
    assertEqual(state.status, LOST, 'поражение');
    assert(!surrender(state), 'повторная сдача — no-op');
});

test('разметка выводится из партии, а не хранится', () => {
    const state = createGame({ secret: 'ТРАВА' });
    submitGuess(state, 'АТАКА', dictionary);
    assertEqual(marks(state).length, 1, 'одна размеченная строка');
    assertEqual(marks(state)[0].join(','), 'absent,present,correct,absent,correct', 'ТРАВА / АТАКА');
    assert(!('marks' in serialize(state)), 'разметка не попадает в сохранение');
});

// --- жёсткий режим ---

test('жёсткий режим: пустая история ничего не требует', () => {
    const state = createGame({ secret: 'ПОРОГ', hardMode: true });
    assert(checkHard(state, 'ЧАСТЬ').ok, 'любая словарная догадка проходит');
});

test('жёсткий режим: зелёная буква обязана стоять на месте', () => {
    const state = createGame({ secret: 'ЗАМОК', hardMode: true });
    submitGuess(state, 'КУБОК', dictionary); // О на позиции 3, К на позиции 4 — зелёные
    const bad = submitGuess(state, 'ЗАБОР', dictionary);
    assert(!bad.ok, 'догадка без К на пятой позиции отвергнута');
    assertEqual(bad.reason, HARD_FIXED, 'причина');
    assertEqual(bad.letter, 'К', 'какая буква');
    assertEqual(bad.position, 4, 'какая позиция');
    assert(submitGuess(state, 'ЗАМОК', dictionary).ok, 'догадка с К на месте принята');
});

test('жёсткий режим: раскрытая жёлтая буква обязана присутствовать', () => {
    const state = createGame({ secret: 'ПОРОГ', hardMode: true });
    // «РЕМНИ» раскрывает Р жёлтой и ни одной зелёной — иначе первой сработала бы
    // проверка позиции и до проверки присутствия дело бы не дошло.
    submitGuess(state, 'РЕМНИ', dictionary);
    const bad = submitGuess(state, 'ЧАСТЬ', dictionary);
    assert(!bad.ok, 'догадка без раскрытой буквы отвергнута');
    assertEqual(bad.reason, HARD_MISSING, 'причина');
    assertEqual(bad.letter, 'Р', 'какая буква');
    assert(submitGuess(state, 'ЗАБОР', dictionary).ok, 'догадка с Р принята');
});

test('жёсткий режим: два вхождения требуют двух', () => {
    const state = createGame({ secret: 'ТРАВА', hardMode: true });
    // «КАБАН» даёт две жёлтые А и ни одной зелёной: требование «двух А» проверяется
    // в чистом виде, без примеси проверки позиций.
    submitGuess(state, 'КАБАН', dictionary);
    const bad = submitGuess(state, 'АРБУЗ', dictionary);
    assert(!bad.ok, 'догадка с одной А отвергнута');
    assertEqual(bad.reason, HARD_MISSING, 'причина');
    assertEqual(bad.letter, 'А', 'какая буква');
    assertEqual(bad.count, 2, 'сколько нужно');
});

test('жёсткий режим: серые буквы использовать не запрещено', () => {
    // Предохранитель от «улучшения» правила, которое ломает совместимость с оригиналом.
    const state = createGame({ secret: 'ПОРОГ', hardMode: true });
    submitGuess(state, 'ЧАСТЬ', dictionary); // Ч, А, С, Т, Ь — все серые
    assert(checkHard(state, 'ЧАСТЬ').ok, 'повтор целиком серой догадки допустим');
});

test('жёсткий режим никогда не запрещает правильный ответ', () => {
    // Сильный инвариант: если правило запретило ввести загаданное слово — оно неверно.
    const answers = unpack(packedAnswers);
    for (let i = 0; i < answers.length; i += 5) {
        const secret = answers[i];
        const state = createGame({ secret, hardMode: true });
        for (let step = 0; step < 4; step++) {
            const guess = answers[(i * 7 + step * 131 + 1) % answers.length];
            submitGuess(state, guess, dictionary);
            if (state.status !== PLAYING) break;
            assert(checkHard(state, secret).ok, `${secret}: ответ запрещён после ${state.guesses.join(',')}`);
        }
    }
});

test('жёсткий режим замораживается на старте партии', () => {
    const state = createGame({ secret: 'ПОРОГ', hardMode: true });
    assertEqual(deserialize(serialize(state)).hardMode, true, 'режим уехал в сохранение');
});

// --- сериализация ---

test('круговой рейс сохраняет партию', () => {
    const state = createGame({ secret: 'ПОРОГ', hardMode: true });
    submitGuess(state, 'ЗАБОР', dictionary);
    submitGuess(state, 'ВЕТЕР', dictionary);
    const restored = deserialize(serialize(state));
    assertEqual(restored.secret, state.secret, 'слово');
    assertEqual(restored.guesses.join(','), state.guesses.join(','), 'догадки');
    assertEqual(restored.status, state.status, 'статус');
    assertEqual(restored.hardMode, true, 'жёсткий режим');
    assertEqual(JSON.stringify(marks(restored)), JSON.stringify(marks(state)), 'разметка та же');
});

test('статус пересчитывается, а не читается из записи', () => {
    const won = deserialize({ secret: 'ПОРОГ', guesses: ['ЗАБОР', 'ПОРОГ'], status: PLAYING });
    assertEqual(won.status, WON, 'победа видна по последней догадке');
    const lost = deserialize({
        secret: 'ПОРОГ',
        guesses: ['ЗАБОР', 'ЧАСТЬ', 'КНИГА', 'ВЕТЕР', 'МЕСТО', 'ЗЕМЛЯ'],
        status: WON,
    });
    assertEqual(lost.status, LOST, 'поражение видно по числу догадок');
});

test('deserialize возвращает null на мусоре, а не бросает', () => {
    const broken = [
        null, undefined, 42, 'ПОРОГ', [], {},
        { secret: 'ПОРО', guesses: [] },              // короткое слово
        { secret: 'POROG', guesses: [] },             // латиница
        { secret: 'ПОРОГ' },                          // догадок нет вовсе
        { secret: 'ПОРОГ', guesses: 'ЗАБОР' },        // догадки не массив
        { secret: 'ПОРОГ', guesses: ['ЗАБО'] },       // догадка не той длины
        { secret: 'ПОРОГ', guesses: [null] },         // догадка не строка
        { secret: 'ПОРОГ', guesses: new Array(7).fill('ЗАБОР') }, // попыток больше максимума
        { secret: 'ПОРОГ', guesses: [], maxAttempts: 0 },
    ];
    for (const raw of broken) {
        assertEqual(deserialize(raw), null, `мусор: ${JSON.stringify(raw)}`);
    }
});

test('«ё» в сохранении нормализуется, а не роняет партию', () => {
    const restored = deserialize({ secret: 'ёлочка'.slice(0, 5), guesses: ['ЗАБОР'] });
    assertEqual(restored.secret, 'ЕЛОЧК', 'секрет нормализован');
});

report('words engine');
