// Тесты линейного решателя нонограммы (Фаза 11.1): подсказки по линии, однозначные
// выводы, отказ на противоречии и решение картинки целиком.
//
// Запуск: node tests/nonogram/solver.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    EMPTY,
    FILLED,
    UNKNOWN,
    cluesFromGrid,
    lineClues,
    solveGrid,
    solveLine,
} from '../../src/games/nonogram/core/solver.js';

const F = FILLED;
const E = EMPTY;
const U = UNKNOWN;

const show = (line) => Array.from(line).map((c) => (c === F ? '#' : c === E ? '.' : '?')).join('');

test('lineClues читает блоки, пустая линия даёт [0]', () => {
    assertEqual(lineClues([F, F, E, F]).join(','), '2,1', 'два блока');
    assertEqual(lineClues([E, E, E]).join(','), '0', 'пустая линия');
    assertEqual(lineClues([F, F, F]).join(','), '3', 'линия целиком');
});

test('cluesFromGrid считает и строки, и столбцы', () => {
    // 1 0
    // 1 1
    const { rowClues, colClues } = cluesFromGrid([1, 0, 1, 1], 2, 2);
    assertEqual(rowClues.map((c) => c.join('')).join('|'), '1|2', 'строки');
    assertEqual(colClues.map((c) => c.join('')).join('|'), '2|1', 'столбцы');
});

test('блок во всю линию определяется целиком', () => {
    assertEqual(show(solveLine([5], new Uint8Array(5))), '#####', 'пять из пяти');
});

test('пересечение раскладок закрашивает середину', () => {
    // Блок 3 в линии 4: закрашенными окажутся клетки, попавшие в обе раскладки.
    assertEqual(show(solveLine([3], new Uint8Array(4))), '?##?', 'середина известна');
});

test('подсказка [0] гасит всю линию', () => {
    assertEqual(show(solveLine([0], new Uint8Array(4))), '....', 'пусто целиком');
});

test('известная клетка сужает раскладки', () => {
    // Блок 2 обязан накрыть уже закрашенную середину, значит стоит на 1–2 или 2–3:
    // края отпадают, середина известна, соседи — нет.
    const cells = Uint8Array.from([U, U, F, U, U]);
    assertEqual(show(solveLine([2], cells)), '.?#?.', 'края отпали');
});

test('решатель отказывается от противоречивой линии', () => {
    assertEqual(solveLine([3], Uint8Array.from([E, E, U])), null, 'блок не помещается');
    assertEqual(solveLine([1, 1], Uint8Array.from([U, U])), null, 'два блока в двух клетках без зазора');
    assertEqual(solveLine([0], Uint8Array.from([F, U])), null, 'закрашено там, где блоков нет');
});

test('solveGrid собирает картинку по подсказкам', () => {
    // Крестик 3×3:
    //   # . #
    //   . # .
    //   # . #
    const grid = [1, 0, 1, 0, 1, 0, 1, 0, 1];
    const clues = cluesFromGrid(grid, 3, 3);
    const result = solveGrid({ cols: 3, rows: 3, ...clues });
    assert(result.solved, 'картинка восстановлена');
    assert(!result.contradiction, 'противоречий нет');
    assertEqual(
        Array.from(result.grid).map((c) => (c === F ? 1 : 0)).join(''),
        grid.join(''),
        'та же картинка',
    );
});

test('неоднозначная картинка не считается решённой', () => {
    // Классическая «шашечная» неоднозначность: подсказки одинаковы у двух разных
    // картинок, и линейными выводами их не различить.
    //   # .        . #
    //   . #   или  # .
    const clues = cluesFromGrid([1, 0, 0, 1], 2, 2);
    const result = solveGrid({ cols: 2, rows: 2, ...clues });
    assert(!result.solved, 'решатель честно встал');
    assert(!result.contradiction, 'но противоречия не нашёл');
});

test('несовместимые подсказки — это противоречие, а не зацикливание', () => {
    const result = solveGrid({
        cols: 3,
        rows: 2,
        rowClues: [[3], [0]],
        // Первый столбец обязан быть пуст, хотя строка требует три клетки подряд.
        colClues: [[0], [1], [1]],
    });
    assert(result.contradiction, 'противоречие найдено');
    assert(!result.solved, 'картинки нет');
});

report('nonogram/solver');
