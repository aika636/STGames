// Тесты партии кроссворда (Фаза 12.3): постановка слова в слот, пересечения,
// победа, подсчёт ошибок и сохранение партии.
//
// Запуск: node tests/crossword/game.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import { parsePuzzle } from '../../src/games/crossword/core/puzzles.js';
import {
    EMPTY,
    availableWords,
    canPlace,
    checkWin,
    clearSlot,
    createGame,
    deserialize,
    isSolved,
    letterAt,
    lettersOf,
    placeWord,
    remaining,
    serialize,
    slotOfWord,
    wrongCells,
    wrongSlots,
} from '../../src/games/crossword/core/game.js';
import { ATAKA, FIXTURE, LODKA, MARKA, MEL, RYADY } from './_puzzle.mjs';

const fresh = (level = 'easy') => createGame(parsePuzzle(FIXTURE), level);

// Правильная раскладка фикстуры: слот -> слово.
const SOLVED = [MEL, MARKA, LODKA, RYADY, ATAKA];

function solve(state) {
    SOLVED.forEach((word, slot) => placeWord(state, slot, word));
    return state;
}

test('новая партия пуста: банк цел, слоты свободны', () => {
    const state = fresh();
    assertEqual(remaining(state), 5, 'пустых слотов');
    assertEqual(availableWords(state).length, 5, 'слов в банке');
    assertEqual(letterAt(state, 0), '', 'клетка пуста');
    assertEqual(lettersOf(state).slice(0, 5), '    #', 'первая строка поля');
});

test('слово не той длины в слот не лезет', () => {
    const state = fresh();
    assertEqual(canPlace(state, 0, ATAKA).reason, 'length', 'пятибуквенное в слот на четыре');
    assertEqual(placeWord(state, 0, ATAKA), false, 'ход не прошёл');
    assertEqual(remaining(state), 5, 'слоты не тронуты');
});

test('несуществующий слот и несуществующее слово отбиваются', () => {
    const state = fresh();
    assertEqual(canPlace(state, 99, MEL).reason, 'slot', 'нет такого слота');
    assertEqual(canPlace(state, 0, 99).reason, 'word', 'нет такого слова');
});

test('одно слово не лежит в двух слотах сразу', () => {
    const state = fresh();
    assert(placeWord(state, 1, MARKA), 'МАРКА встала в колонку');
    assertEqual(canPlace(state, 2, MARKA).reason, 'used', 'она уже занята');
    assertEqual(slotOfWord(state, MARKA), 1, 'лежит в слоте 1');
    assertEqual(availableWords(state).length, 4, 'в банке на одно меньше');
});

test('пересечения проверяются: буква на стыке должна сойтись', () => {
    const state = fresh();
    assert(placeWord(state, 1, MARKA), 'МАРКА в вертикальный слот');
    // Слот 0 стартует в той же клетке: первая буква обязана быть «М».
    assertEqual(canPlace(state, 0, RYADY).reason, 'conflict', 'РЯДЫ начинается не на М');
    assert(canPlace(state, 0, MEL).ok, 'МЕЛЬ подходит');
    assert(placeWord(state, 0, MEL), 'ход прошёл');
    assertEqual(letterAt(state, 1), 'Е', 'буква встала в клетку');
});

test('снятие слова возвращает его в банк и освобождает клетки', () => {
    const state = fresh();
    placeWord(state, 1, MARKA);
    assert(clearSlot(state, 1), 'слот освобождён');
    assertEqual(clearSlot(state, 1), false, 'повторное снятие ничего не делает');
    assertEqual(state.placed[1], EMPTY, 'слот пуст');
    assertEqual(letterAt(state, 0), '', 'клетка снова пуста');
    assertEqual(availableWords(state).length, 5, 'банк цел');
});

test('слово в занятом слоте заменяется, прежнее уходит в банк', () => {
    const state = fresh();
    placeWord(state, 1, MARKA);
    assert(placeWord(state, 1, LODKA), 'заменили');
    assertEqual(slotOfWord(state, MARKA), EMPTY, 'МАРКА вернулась в банк');
    assertEqual(slotOfWord(state, LODKA), 1, 'ЛОДКА в слоте');
});

test('победа — когда разложено ровно решение', () => {
    const state = fresh();
    solve(state);
    assert(isSolved(state), 'кроссворд собран');
    assert(checkWin(state), 'победа засчитана');
    assert(state.over && state.won, 'партия закрыта');
    // Партия окончена — ходы больше не принимаются.
    assertEqual(canPlace(state, 0, MEL).reason, 'over', 'после победы ходов нет');
    assertEqual(clearSlot(state, 0), false, 'снять тоже нельзя');
    assert(checkWin(state), 'повторный вызов возвращает ту же победу');
});

test('неполная раскладка победой не считается', () => {
    const state = fresh();
    solve(state);
    state.over = false;
    state.won = false;
    clearSlot(state, 4);
    assertEqual(isSolved(state), false, 'слот пуст — не собрано');
    assertEqual(checkWin(state), false, 'победы нет');
});

test('ошибки считаются по клеткам и по словам', () => {
    const state = fresh();
    assertEqual(wrongCells(state).length, 0, 'на пустом поле ошибок нет');
    // ЛОДКА в колонке вместо МАРКА: сходятся только две буквы из пяти.
    placeWord(state, 1, LODKA);
    assertEqual(wrongCells(state).join(','), '0,5,10', 'неверные клетки');
    assertEqual(wrongSlots(state).join(','), '1', 'неверный слот');
});

test('serialize/deserialize: круговой рейс', () => {
    const state = fresh('hard');
    placeWord(state, 1, MARKA);
    placeWord(state, 0, MEL);
    state.elapsed = 42.7;

    const raw = serialize(state);
    assertEqual(raw.grid, FIXTURE.grid, 'сетка в сохранении');
    assertEqual(raw.words, FIXTURE.words, 'банк в сохранении');
    assertEqual(raw.placed, '3,2,-1,-1,-1', 'раскладка строкой');

    const back = deserialize(raw);
    assert(back, 'партия восстановлена');
    assertEqual(back.level, 'hard', 'уровень');
    assertEqual(back.elapsed, 43, 'время');
    assertEqual(Array.from(back.placed).join(','), '3,2,-1,-1,-1', 'раскладка');
    assertEqual(lettersOf(back), lettersOf(state), 'поле совпало');
    assertEqual(back.over, false, 'партия идёт');
});

test('сохранение собранной партии открывается победой', () => {
    const state = solve(fresh());
    checkWin(state);
    const back = deserialize(serialize(state));
    assert(back.over && back.won, 'победа сохранилась');
});

test('победа досчитывается на загрузке, если её не успели записать', () => {
    const state = solve(fresh());
    const raw = serialize(state);
    raw.over = false;
    raw.won = false;
    const back = deserialize(raw);
    assert(back.over && back.won, 'победа найдена при загрузке');
});

test('мусор в settings.json даёт null, а не исключение', () => {
    const good = serialize(solve(fresh()));
    const bad = (patch, why) => assertEqual(deserialize({ ...good, ...patch }), null, why);

    assertEqual(deserialize(null), null, 'ничего');
    assertEqual(deserialize(42), null, 'число');
    assertEqual(deserialize('{}'), null, 'строка');
    assertEqual(deserialize({}), null, 'пустой объект');
    bad({ placed: undefined }, 'нет раскладки');
    bad({ placed: '3,2,1,4' }, 'раскладка короче');
    bad({ placed: '3,2,1,4,я' }, 'не число');
    bad({ placed: '3,3,1,4,0' }, 'слово в двух слотах');
    bad({ placed: '3,2,1,4,9' }, 'слово вне банка');
    bad({ placed: '0,2,1,4,3' }, 'длина слова не под слот');
    bad({ grid: 'ерунда' }, 'битая сетка');
    bad({ words: '' }, 'пустой банк');
});

test('отрицательное и нечисловое время обнуляется', () => {
    const raw = serialize(fresh());
    assertEqual(deserialize({ ...raw, elapsed: -5 }).elapsed, 0, 'минус');
    assertEqual(deserialize({ ...raw, elapsed: 'долго' }).elapsed, 0, 'строка');
});

report('crossword/game');
