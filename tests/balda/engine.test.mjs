// Тесты правил балды (Фаза 13.2). Чистое ядро, зависимостей нет.
// Запуск: node tests/balda/engine.test.mjs
//
// Поле во всех тестах — 5×5 с загаданным «БАЛДА» в среднем ряду:
//
//     .  .  .  .  .     0  1  2  3  4
//     .  .  .  .  .     5  6  7  8  9
//     Б  А  Л  Д  А    10 11 12 13 14
//     .  .  .  .  .    15 16 17 18 19
//     .  .  .  .  .    20 21 22 23 24

import {
    BAD_CELL, BAD_LETTER, BAD_PATH, CELL_TAKEN, FIRST, GAME_OVER, NOT_ADJACENT,
    NOT_IN_DICTIONARY, PATH_MISSES_LETTER, SECOND, TOO_SHORT, WORD_USED,
    applyMove, checkMove, createGame, deserialize, isBoardFull, letterAt, pass,
    playableCells, scoreOf, scores, serialize, winner,
} from '../../src/games/balda/core/engine.js';
import { createStringDictionary } from './_dictionary.mjs';
import { assert, assertEqual, report, test } from '../_harness.mjs';

console.log('balda engine');

const DICT = createStringDictionary([
    'БАЛ', 'БАЛДА', 'БАК', 'ДАР', 'ДАЛЬ', 'КЛАД', 'ЛАД', 'ЛАК', 'ЛАМА', 'РАК',
]);

function newGame(options) {
    return createGame({ size: 5, startWord: 'БАЛДА', ...options });
}

function boardString(state) {
    return serialize(state).board;
}

// --- Начало партии

test('стартовое поле: слово в среднем ряду, остальное пусто', () => {
    const state = newGame();
    assertEqual(boardString(state), '..........БАЛДА..........', 'поле');
    assertEqual(state.turn, FIRST, 'первым ходит FIRST');
    assertEqual(scoreOf(state, FIRST), 0, 'очков нет');
    assert(state.used.has('БАЛДА'), 'загаданное слово занято сразу');
    assertEqual(letterAt(state, 12), 'Л', 'буква по индексу');
    assertEqual(letterAt(state, 0), '', 'пустая клетка — пустая строка');
});

test('createGame бросает на негодных параметрах, а не молчит', () => {
    for (const bad of [
        { size: 4, startWord: 'БАЛД' },   // чётный размер — среднего ряда нет
        { size: 5, startWord: 'БАЛ' },    // слово не по размеру поля
        { size: 5, startWord: 'БАЛД7' },  // не буквы
        { size: 5 },                      // слова нет вовсе
    ]) {
        let thrown = false;
        try {
            createGame(bad);
        } catch {
            thrown = true;
        }
        assert(thrown, `createGame(${JSON.stringify(bad)}) бросает`);
    }
});

test('«ё» в загаданном слове нормализуется в «е»', () => {
    const state = createGame({ size: 3, startWord: 'ёлка'.slice(0, 3) });
    assertEqual(boardString(state), '...ЕЛК...', 'слово в верхнем регистре и без «ё»');
});

test('ставить можно только рядом с занятыми клетками', () => {
    const cells = playableCells(newGame());
    assertEqual(cells.join(','), '5,6,7,8,9,15,16,17,18,19', 'соседи среднего ряда');
});

// --- Приём хода

test('ход принимается: буква ложится, очки растут, очередь переходит', () => {
    const state = newGame();
    const result = applyMove(state, { index: 6, letter: 'Д', path: [12, 11, 6] }, DICT);

    assertEqual(result.ok, true, 'ход принят');
    assertEqual(result.word, 'ЛАД', 'слово');
    assertEqual(result.score, 3, 'очки за слово');
    assertEqual(result.over, false, 'партия продолжается');
    assertEqual(letterAt(state, 6), 'Д', 'буква на поле');
    assertEqual(scoreOf(state, FIRST), 3, 'очки ходившего');
    assertEqual(scoreOf(state, SECOND), 0, 'у соперника очков нет');
    assertEqual(state.turn, SECOND, 'очередь у соперника');
    assertEqual(state.words[FIRST].join(','), 'ЛАД', 'слово записано ходившему');
});

test('слово считается по пути, а не по клетке: КЛАД через ранее поставленную Д', () => {
    const state = newGame();
    applyMove(state, { index: 6, letter: 'Д', path: [12, 11, 6] }, DICT);
    const result = applyMove(state, { index: 7, letter: 'К', path: [7, 12, 11, 6] }, DICT);

    assertEqual(result.ok, true, 'ход принят');
    assertEqual(result.word, 'КЛАД', 'слово');
    assertEqual(scoreOf(state, SECOND), 4, 'очки соперника');
});

test('буква в любом регистре и с «ё» нормализуется', () => {
    const state = newGame();
    const result = applyMove(state, { index: 6, letter: 'д', path: [12, 11, 6] }, DICT);
    assertEqual(result.ok, true, 'строчная буква принята');
    assertEqual(letterAt(state, 6), 'Д', 'на поле — заглавная');
});

// --- Отказы

test('отказы: каждая ветка возвращает свой код причины', () => {
    const cases = [
        ['клетка вне поля', { index: -1, letter: 'Д', path: [12, 11, 6] }, BAD_CELL],
        ['клетка за краем', { index: 25, letter: 'Д', path: [12, 11, 6] }, BAD_CELL],
        ['клетка не целая', { index: 6.5, letter: 'Д', path: [12, 11, 6] }, BAD_CELL],
        ['клетка занята', { index: 10, letter: 'Д', path: [10, 11] }, CELL_TAKEN],
        ['не буква', { index: 6, letter: '7', path: [12, 11, 6] }, BAD_LETTER],
        ['две буквы', { index: 6, letter: 'ДА', path: [12, 11, 6] }, BAD_LETTER],
        ['буквы нет', { index: 6, letter: '', path: [12, 11, 6] }, BAD_LETTER],
        ['клетка на отшибе', { index: 0, letter: 'Д', path: [0, 1] }, NOT_ADJACENT],
        ['путь в одну клетку', { index: 6, letter: 'Д', path: [6] }, TOO_SHORT],
        ['пути нет вовсе', { index: 6, letter: 'Д', path: null }, TOO_SHORT],
        ['путь рваный', { index: 6, letter: 'Д', path: [6, 10] }, BAD_PATH],
        ['клетка в пути дважды', { index: 6, letter: 'Д', path: [6, 11, 6] }, BAD_PATH],
        ['путь по пустой клетке', { index: 6, letter: 'Д', path: [6, 11, 16] }, BAD_PATH],
        ['клетка пути вне поля', { index: 6, letter: 'Д', path: [6, 99] }, BAD_PATH],
        ['путь мимо новой буквы', { index: 6, letter: 'Д', path: [10, 11, 12] }, PATH_MISSES_LETTER],
        ['слова нет в словаре', { index: 6, letter: 'Ж', path: [6, 11] }, NOT_IN_DICTIONARY],
    ];

    for (const [name, move, reason] of cases) {
        const state = newGame();
        const result = applyMove(state, move, DICT);
        assertEqual(result.ok, false, `${name}: ход отклонён`);
        assertEqual(result.reason, reason, `${name}: причина`);
        assertEqual(boardString(state), '..........БАЛДА..........', `${name}: поле не тронуто`);
        assertEqual(state.turn, FIRST, `${name}: очередь не тронута`);
    }
});

test('слово нельзя собрать дважды, даже другим путём', () => {
    const state = newGame();
    assertEqual(applyMove(state, { index: 6, letter: 'Д', path: [12, 11, 6] }, DICT).ok, true, 'первый ЛАД');

    const again = applyMove(state, { index: 16, letter: 'Д', path: [12, 11, 16] }, DICT);
    assertEqual(again.ok, false, 'второй ЛАД отклонён');
    assertEqual(again.reason, WORD_USED, 'причина');
    assertEqual(letterAt(state, 16), '', 'буква не легла');
});

test('загаданное слово тоже считается собранным', () => {
    // «БАЛДА» из среднего ряда через новую клетку не набирается, поэтому проверяем
    // напрямую: слово занято с самого начала.
    const state = newGame();
    assert(state.used.has('БАЛДА'), 'слово занято');
    const result = checkMove(state, { index: 6, letter: 'Д', path: [12, 11, 6] }, {
        has: (word) => word === 'ЛАД' || word === 'БАЛДА',
    });
    assertEqual(result.ok, true, 'словарь из двух слов не мешает обычному ходу');
});

test('checkMove не меняет состояние ни на принятом ходе, ни на отклонённом', () => {
    const state = newGame();
    const before = boardString(state);

    assertEqual(checkMove(state, { index: 6, letter: 'Д', path: [12, 11, 6] }, DICT).ok, true, 'ход годен');
    assertEqual(checkMove(state, { index: 6, letter: 'Ж', path: [6, 11] }, DICT).ok, false, 'ход негоден');
    assertEqual(boardString(state), before, 'поле не тронуто');
    assertEqual(state.words[FIRST].length, 0, 'слов не прибавилось');
});

// --- Пас и конец партии

test('пас передаёт ход, два паса подряд заканчивают партию', () => {
    const state = newGame();

    const first = pass(state);
    assertEqual(first.ok, true, 'первый пас принят');
    assertEqual(first.over, false, 'партия жива');
    assertEqual(state.turn, SECOND, 'очередь перешла');

    const second = pass(state);
    assertEqual(second.ok, true, 'второй пас принят');
    assertEqual(second.over, true, 'партия окончена');
    assertEqual(state.over, true, 'флаг конца');
});

test('ход сбрасывает счётчик пасов', () => {
    const state = newGame();
    pass(state);
    assertEqual(applyMove(state, { index: 6, letter: 'Д', path: [12, 11, 6] }, DICT).ok, true, 'ход принят');
    assertEqual(state.passes, 0, 'счётчик пасов сброшен');

    pass(state);
    assertEqual(state.over, false, 'один пас партию не кончает');
});

test('после конца партии ход и пас не принимаются', () => {
    const state = newGame();
    pass(state);
    pass(state);

    const move = applyMove(state, { index: 6, letter: 'Д', path: [12, 11, 6] }, DICT);
    assertEqual(move.ok, false, 'ход отклонён');
    assertEqual(move.reason, GAME_OVER, 'причина');
    assertEqual(pass(state).ok, false, 'пас отклонён');
});

test('заполненное поле заканчивает партию', () => {
    // Поле 3×3 с единственной пустой клеткой в середине верхнего ряда.
    const state = deserialize({
        size: 3, start: 'РАК', board: 'Б.КРАКЛУК', turn: FIRST, human: FIRST, passes: 0, words: [[], []],
    });
    assert(state !== null, 'позиция восстановлена');
    assertEqual(state.over, false, 'пока не окончена');

    const result = applyMove(state, { index: 1, letter: 'А', path: [0, 1, 2] }, DICT);
    assertEqual(result.ok, true, 'ход принят');
    assertEqual(result.word, 'БАК', 'слово');
    assertEqual(result.over, true, 'поле заполнено — партия окончена');
    assert(isBoardFull(state.board), 'пустых клеток нет');
});

test('победитель — по очкам, равенство — ничья', () => {
    const state = newGame();
    assertEqual(winner(state), null, 'на старте ничья');

    state.words[FIRST].push('ЛАД');
    assertEqual(winner(state), FIRST, 'у первого больше');

    state.words[SECOND].push('КЛАД');
    assertEqual(winner(state), SECOND, 'у второго больше');

    state.words[FIRST].push('ЛАК');
    assertEqual(scores(state).join(':'), '6:4', 'счёт');
    assertEqual(winner(state), FIRST, 'перевес вернулся');
});

// --- Сохранение

test('serialize/deserialize — круговой рейс', () => {
    const state = newGame({ human: SECOND });
    applyMove(state, { index: 6, letter: 'Д', path: [12, 11, 6] }, DICT);
    applyMove(state, { index: 7, letter: 'К', path: [7, 12, 11, 6] }, DICT);
    pass(state);

    const restored = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    assert(restored !== null, 'восстановлено');
    assertEqual(boardString(restored), boardString(state), 'поле');
    assertEqual(restored.turn, state.turn, 'очередь');
    assertEqual(restored.human, state.human, 'сторона игрока');
    assertEqual(restored.passes, state.passes, 'пасы');
    assertEqual(restored.words.flat().join(','), 'ЛАД,КЛАД', 'слова по сторонам');
    assertEqual(scoreOf(restored, FIRST), 3, 'очки пересчитаны');
    assertEqual(scoreOf(restored, SECOND), 4, 'очки соперника пересчитаны');

    // Множество занятых слов восстановлено, а не потеряно вместе с Set'ом.
    const again = applyMove(restored, { index: 16, letter: 'Д', path: [12, 11, 16] }, DICT);
    assertEqual(again.reason, WORD_USED, 'собранное слово по-прежнему занято');
});

test('deserialize пересчитывает конец партии, а не верит записи', () => {
    const overByPasses = deserialize({
        size: 3, start: 'РАК', board: '...РАК...', turn: FIRST, human: FIRST, passes: 2, words: [[], []],
    });
    assertEqual(overByPasses.over, true, 'два паса — партия окончена');

    const overByBoard = deserialize({
        size: 3, start: 'РАК', board: 'БАКРАКЛУК', turn: FIRST, human: FIRST, passes: 0, words: [[], []],
    });
    assertEqual(overByBoard.over, true, 'поле заполнено — партия окончена');
});

test('deserialize возвращает null на мусоре, а не бросает', () => {
    const good = serialize(newGame());
    const cases = {
        'ничего': null,
        'строка': 'БАЛДА',
        'массив': [],
        'пустой объект': {},
        'чётный размер': { ...good, size: 4 },
        'размер не число': { ...good, size: '5' },
        'поле не той длины': { ...good, board: '...' },
        'поле не строка': { ...good, board: 42 },
        'мусор в поле': { ...good, board: '#........БАЛДА..........'.slice(0, 25) },
        'слово не по размеру': { ...good, start: 'РАК' },
        'слово с цифрой': { ...good, start: 'БАЛД7' },
        'слов не два списка': { ...good, words: [[]] },
        'слова не массив': { ...good, words: 'ЛАД' },
        'слово-мусор': { ...good, words: [['Л4Д'], []] },
        'слово в одну букву': { ...good, words: [['Л'], []] },
    };

    for (const [name, raw] of Object.entries(cases)) {
        let result;
        try {
            result = deserialize(raw);
        } catch (err) {
            throw new Error(`${name}: deserialize бросил ${err.message}`);
        }
        assertEqual(result, null, `${name}: null`);
    }
});

test('deserialize чинит негодные turn/human/passes вместо отказа', () => {
    const good = serialize(newGame());
    const state = deserialize({ ...good, turn: 7, human: 'нечто', passes: -3 });
    assert(state !== null, 'партия восстановлена');
    assertEqual(state.turn, FIRST, 'очередь');
    assertEqual(state.human, FIRST, 'сторона игрока');
    assertEqual(state.passes, 0, 'пасы');
});

report('balda engine');
