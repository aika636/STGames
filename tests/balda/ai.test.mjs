// Тесты соперника в балде (Фаза 13.3). Чистое ядро, зависимостей нет.
// Запуск: node tests/balda/ai.test.mjs
//
// Кроме поведения ИИ здесь два обязательных замера:
//   * полнота перебора — список ходов сверяется с независимым тупым перебором
//     (все простые пути × 32 буквы, без отсечения по бору): отсечение обязано
//     терять только заведомо бесполезные ветки, а не ходы;
//   * время хода — соперник обязан укладываться в бюджет, иначе пауза «соперник
//     думает» превращается в подвисшую вкладку.

import {
    FIRST, LETTERS, SECOND,
    applyMove, checkMove, createGame, deserialize, neighbourTable, pass, playableCells, scores,
} from '../../src/games/balda/core/engine.js';
import {
    DEFAULT_LEVEL, LEVELS, chooseMove, findMoves, hasMove, mulberry32, walkerFor,
} from '../../src/games/balda/core/ai.js';
import { createStringDictionary, createTrieDictionary } from './_dictionary.mjs';
import { assert, assertEqual, report, test } from '../_harness.mjs';

console.log('balda ai');

// Бюджет на ход. Задача фазы — «меньше секунды на телефоне»; на рабочей машине берём
// запас в порядок, иначе тест перестанет ловить деградацию перебора.
const TIME_BUDGET_MS = 100;

const WORDS = ['БАЛ', 'БАЛДА', 'БАК', 'ДАР', 'ДАЛЬ', 'КЛАД', 'ЛАД', 'ЛАК', 'ЛАМА', 'РАК'];
const DICT = createTrieDictionary(WORDS);
const STRING_DICT = createStringDictionary(WORDS);

// Большой словарь для очной встречи уровней и замера времени — грузится один раз
// на весь файл (см. bigDictionary() внизу). null, если данных «Слов» рядом нет.
const BIG = await bigDictionary();

function newGame() {
    return createGame({ size: 5, startWord: 'БАЛДА' });
}

// Поле с уже поставленной Д над буквой А: отсюда набирается КЛАД — слово длиннее всего,
// что можно собрать из одного среднего ряда.
function preparedGame() {
    const state = deserialize({
        size: 5,
        start: 'БАЛДА',
        board: '.....' + '.Д...' + 'БАЛДА' + '.....' + '.....',
        turn: FIRST,
        human: FIRST,
        passes: 0,
        words: [[], []],
    });
    assert(state !== null, 'подготовленная позиция восстановлена');
    return state;
}

function wordsOf(moves) {
    return [...moves.map((move) => move.word)].sort().join(',');
}

// --- Полнота перебора

test('перебор с отсечением находит ровно то же, что тупой перебор', () => {
    for (const state of [newGame(), preparedGame()]) {
        const fast = wordsOf(findMoves(state, DICT));
        const slow = wordsOf(bruteForce(state, DICT));
        assert(slow.length > 0, 'тупой перебор что-то нашёл');
        assertEqual(fast, slow, 'списки слов совпали');
    }
});

test('бор и строковый фолбэк дают одинаковый результат', () => {
    const state = preparedGame();
    assertEqual(wordsOf(findMoves(state, DICT)), wordsOf(findMoves(state, STRING_DICT)), 'слова');
    assertEqual(
        JSON.stringify(chooseMove(state, DICT, { level: 'hard' })),
        JSON.stringify(chooseMove(state, STRING_DICT, { level: 'hard' })),
        'выбранный ход',
    );
});

test('узел бора с номером 0 не считается отсутствующим', () => {
    // Корень тестового бора — число 0; наивная проверка `if (!child)` обрубила бы
    // перебор на первом же шаге и вернула бы пустой список.
    const walker = walkerFor(DICT);
    assertEqual(walker.root, 0, 'корень — 0');
    assert(walker.child(walker.root, 'Б') != null, 'переход по Б есть');
    assertEqual(walker.child(walker.root, 'Щ'), null, 'перехода по Щ нет');
    assert(findMoves(newGame(), DICT).length > 0, 'ходы находятся');
});

test('словарь без бора и без hasPrefix — ошибка программиста, а не пустой список', () => {
    let thrown = false;
    try {
        findMoves(newGame(), { has: () => true });
    } catch {
        thrown = true;
    }
    assert(thrown, 'walkerFor бросил');
});

// --- Годность найденных ходов

test('каждый найденный ход принимается движком', () => {
    const state = preparedGame();
    const moves = findMoves(state, DICT);
    assert(moves.length > 1, 'ходов найдено больше одного');

    for (const move of moves) {
        const result = checkMove(state, move, DICT);
        assertEqual(result.ok, true, `ход ${move.word} легален (${result.reason ?? ''})`);
        assertEqual(result.word, move.word, `слово ${move.word} собирается заявленным путём`);
        assertEqual(move.score, move.word.length, 'очки — длина слова');
        assert(move.path.includes(move.index), `путь ${move.word} проходит через новую букву`);
    }
});

test('уже собранные слова в переборе не появляются', () => {
    const state = preparedGame();
    const before = findMoves(state, DICT);
    assert(before.some((move) => move.word === 'КЛАД'), 'КЛАД найден');

    state.used.add('КЛАД');
    const after = findMoves(state, DICT);
    assert(!after.some((move) => move.word === 'КЛАД'), 'занятое слово выброшено');
    assertEqual(after.length, before.length - 1, 'остальные ходы на месте');
});

test('слов нет — null и пустой список, а не исключение', () => {
    const state = newGame();
    const empty = { maxLength: 5, has: () => false, hasPrefix: () => false };
    assertEqual(findMoves(state, empty).length, 0, 'ходов нет');
    assertEqual(chooseMove(state, empty), null, 'ход не выбран');
    assertEqual(hasMove(state, empty), false, 'hasMove');
});

test('hasMove обрывает перебор на первом слове', () => {
    assertEqual(hasMove(preparedGame(), DICT), true, 'ход есть');
    assertEqual(findMoves(preparedGame(), DICT, { limit: 1 }).length, 1, 'ровно один ход');
});

// --- Уровни

test('уровень выбирает длину слова, а не глубину перебора', () => {
    const state = preparedGame();
    const lengths = new Set(findMoves(state, DICT).map((move) => move.score));
    assertEqual([...lengths].sort().join(','), '3,4', 'в позиции есть слова длиной 3 и 4');
    assert(findMoves(state, DICT).some((move) => move.word === 'КЛАД'), 'КЛАД среди найденных');

    assertEqual(chooseMove(state, DICT, { level: 'hard' }).score, 4, 'сильный берёт максимум очков');
    assertEqual(chooseMove(state, DICT, { level: 'easy' }).score, 3, 'слабый берёт короткое');
    assertEqual(chooseMove(state, DICT, { level: DEFAULT_LEVEL }).score, 3, 'средний — из середины');
});

test('сильный уровень обыгрывает слабый обеими сторонами', () => {
    if (!BIG) {
        console.log('      большого словаря рядом нет — очная встреча пропущена');
        return;
    }

    // Три партии на сторону: одна ничего не доказывает, а тридцати ждать незачем.
    for (const hardSide of [FIRST, SECOND]) {
        let hard = 0;
        let easy = 0;
        for (const seed of [0, 1, 2]) {
            const match = playMatch(BIG.trie, hardSide, BIG.starts[seed], seed);
            hard += match.hard;
            easy += match.easy;
        }
        assert(hard > easy, `сильный ${hardSide === FIRST ? 'первым' : 'вторым'}: ${hard} : ${easy}`);
    }
});

test('неизвестный уровень играет как средний', () => {
    const state = preparedGame();
    assertEqual(
        JSON.stringify(chooseMove(state, DICT, { level: 'нечто' })),
        JSON.stringify(chooseMove(state, DICT, { level: DEFAULT_LEVEL })),
        'тот же ход',
    );
});

// --- Детерминированность

test('без rng ход детерминирован', () => {
    const state = preparedGame();
    for (const level of LEVELS) {
        assertEqual(
            JSON.stringify(chooseMove(state, DICT, { level })),
            JSON.stringify(chooseMove(state, DICT, { level })),
            `${level}: тот же ход`,
        );
    }
});

test('с фиксированным rng ход воспроизводится, с разными семенами — различается', () => {
    const state = preparedGame();
    const picks = new Set();

    for (let seed = 0; seed < 20; seed++) {
        const first = chooseMove(state, DICT, { level: 'easy', rng: mulberry32(seed) });
        const second = chooseMove(state, DICT, { level: 'easy', rng: mulberry32(seed) });
        assertEqual(first.word + first.index, second.word + second.index, `seed ${seed}: тот же ход`);
        picks.add(`${first.word}@${first.index}`);
    }

    assert(picks.size > 1, `слабый уровень не повторяет одно и то же: ${[...picks].join(' ')}`);
});

test('rng не делает ход случайным: длина остаётся уровневой', () => {
    const state = preparedGame();
    for (let seed = 0; seed < 20; seed++) {
        assertEqual(
            chooseMove(state, DICT, { level: 'hard', rng: mulberry32(seed) }).score,
            4,
            `seed ${seed}: сильный всё равно берёт максимум`,
        );
        assertEqual(
            chooseMove(state, DICT, { level: 'easy', rng: mulberry32(seed) }).score,
            3,
            `seed ${seed}: слабый всё равно берёт короткое`,
        );
    }
});

// --- Время хода

test('партия целиком укладывается в бюджет на ход', () => {
    if (!BIG) {
        console.log('      большого словаря рядом нет — замер пропущен');
        return;
    }

    console.log(`      словарь «${BIG.label}»: ${BIG.size} слов, макс. длина ${BIG.maxLength}`);
    const runs = [];

    for (const [kind, dictionary] of [['бор', BIG.trie], ['строки', BIG.strings]]) {
        for (const level of LEVELS) {
            const run = playOut(dictionary, level, BIG.starts[0]);
            runs.push(run);
            console.log(
                `      ${kind} / ${level}: ходов ${run.moves}, счёт ${run.score}, ` +
                `ср. ${run.avg.toFixed(2)} мс, макс ${run.max.toFixed(2)} мс`,
            );
        }
    }

    for (const run of runs) {
        assert(run.moves > 10, `партия сыграна до конца (${run.moves} ходов)`);
        assert(run.max < TIME_BUDGET_MS, `макс. время хода ${run.max.toFixed(1)} мс < ${TIME_BUDGET_MS} мс`);
    }
});

// --- Вспомогательное

// Независимый тупой перебор: все простые пути по занятым клеткам (плюс клетка-кандидат)
// × все 32 буквы, каждый путь проверяется движком. Отсечения по бору здесь нет вовсе —
// именно поэтому он и годится в оракулы для findMoves().
function bruteForce(state, dictionary) {
    const size = state.size;
    const cells = size * size;
    const neighbours = neighbourTable(size);
    const found = new Map();

    for (const hole of playableCells(state)) {
        const occupied = (i) => i === hole || state.board[i] !== 0;

        for (const letter of LETTERS) {
            const path = [];
            const seen = new Set();

            const walk = (cell) => {
                path.push(cell);
                seen.add(cell);

                if (path.length >= 2) {
                    const move = { index: hole, letter, path: path.slice() };
                    const result = checkMove(state, move, dictionary);
                    if (result.ok && !found.has(result.word)) found.set(result.word, move);
                }

                for (const next of neighbours[cell]) {
                    if (occupied(next) && !seen.has(next)) walk(next);
                }

                path.pop();
                seen.delete(cell);
            };

            for (let start = 0; start < cells; start++) if (occupied(start)) walk(start);
        }
    }

    return [...found.values()].map((move) => ({ ...move, word: checkMove(state, move, dictionary).word }));
}

// Партия соперника с самим собой до конца поля. rng фиксирован — партия обязана быть
// воспроизводимой, иначе замер начнёт мигать.
function playOut(dictionary, level, startWord) {
    const state = createGame({ size: 5, startWord });
    const rng = mulberry32(20250810);
    const times = [];
    let guard = 0;

    while (!state.over && guard++ < 60) {
        const started = performance.now();
        const move = chooseMove(state, dictionary, { level, rng });
        times.push(performance.now() - started);

        if (!move) {
            pass(state);
            continue;
        }
        const result = applyMove(state, move, dictionary);
        assert(result.ok, `ход ИИ «${move.word}» принят движком (${result.reason ?? ''})`);
    }

    return {
        moves: times.length,
        score: scores(state).join(':'),
        avg: times.reduce((a, b) => a + b, 0) / times.length,
        max: Math.max(...times),
    };
}

// Очная встреча уровней: сильный против слабого, обе стороны ходят из одного словаря.
// rng фиксирован семенем — партия обязана быть воспроизводимой.
function playMatch(dictionary, hardSide, startWord, seed) {
    const state = createGame({ size: 5, startWord });
    const rng = mulberry32(seed + 1);
    let guard = 0;

    while (!state.over && guard++ < 60) {
        const level = state.turn === hardSide ? 'hard' : 'easy';
        const move = chooseMove(state, dictionary, { level, rng });
        if (!move) {
            pass(state);
            continue;
        }
        assert(applyMove(state, move, dictionary).ok, `ход «${move.word}» принят движком`);
    }

    const [first, second] = scores(state);
    return hardSide === FIRST ? { hard: first, easy: second } : { hard: second, easy: first };
}

// Большой словарь для очной встречи уровней и замера времени.
//
// Берётся настоящий словарь балды (13.1), если он уже лежит на месте, — на нём и время,
// и сила уровней измеряются по-честному. Пока его нет, годится словарь «Слов»: 24 тысячи
// пятибуквенных словоформ дают реалистичную плотность префиксов, а приклеенные к ним
// хвосты — слова длиной до 8 букв. Нет и его — замеры пропускаются: чужие данные не
// повод ронять тесты своего ядра.
async function bigDictionary() {
    return (await baldaDictionary()) ?? (await wordsDictionary());
}

// Строковый фолбэк перебора из готового словаря: у настоящего есть и бор, и строки,
// а мерить надо обе дороги.
function stringsOf(dictionary) {
    return {
        maxLength: dictionary.maxLength,
        has: (word) => dictionary.has(word),
        hasPrefix: (prefix) => dictionary.hasPrefix(prefix),
    };
}

async function baldaDictionary() {
    try {
        const [core, data] = await Promise.all([
            import('../../src/games/balda/core/dictionary.js'),
            import('../../src/games/balda/data/words.js'),
        ]);
        const dictionary = core.createDictionary(data.default);
        const five = dictionary.words().filter((word) => word.length === 5);
        if (dictionary.size < 1000 || five.length < 100) return null;

        return {
            label: 'балда',
            size: dictionary.size,
            maxLength: dictionary.maxLength,
            starts: [0, 1237, 2474].map((i) => five[i % five.length]),
            trie: dictionary,
            strings: stringsOf(dictionary),
        };
    } catch {
        return null;
    }
}

async function wordsDictionary() {
    let packed;
    try {
        packed = (await import('../../src/games/words/data/allowed.js')).default;
    } catch {
        return null;
    }
    if (typeof packed !== 'string' || packed.length < 5) return null;

    const five = [];
    for (let i = 0; i + 5 <= packed.length; i += 5) five.push(packed.slice(i, i + 5));

    const words = new Set(five);
    for (let i = 0; i < five.length; i++) {
        const word = five[i];
        for (let n = 2; n < 5; n++) words.add(word.slice(0, n));
        words.add(word + five[(i * 7 + 3) % five.length].slice(0, 3));
    }

    const list = [...words];
    return {
        label: 'слова + склейки',
        size: list.length,
        maxLength: 8,
        starts: [five[1000], five[5000], five[9000]],
        trie: createTrieDictionary(list),
        strings: createStringDictionary(list),
    };
}

report('balda ai');
