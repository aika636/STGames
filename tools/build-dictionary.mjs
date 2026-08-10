#!/usr/bin/env node
// Сборка словарей словесных игр: «Слова» (src/games/words/data/), кроссворд-скелет
// (src/games/crossword/data/) и балда (src/games/balda/data/).
//
// ОФЛАЙН-ИНСТРУМЕНТ. Браузер его не грузит, расширение от него не зависит, npm-пакетов
// он не требует. Запускается руками при перегенерации словаря; результат коммитится
// готовым, поэтому «no build step» не нарушается.
//
// Что на выходе (выбирается ключом --target):
//   words      answers.js  — загадываемые: пятибуквенные существительные в им. п. ед. ч.,
//                            отфильтрованные по частотности. Производное от OpenCorpora,
//                            поэтому CC BY-SA 4.0.
//              allowed.js  — допустимые догадки: все пятибуквенные словоформы.
//                            Из danakt/russian-words, MIT. Включает answers целиком.
//   crossword  words.js    — банк слов для офлайн-генератора кроссвордов: те же
//                            существительные им. п. ед. ч., но по длинам 3–9.
//   balda      words.js    — словарь балды: существительные им. п. ед. ч. всех длин,
//                            которые вообще помещаются на поле 5×5 (2–25 букв),
//                            с мягким порогом частотности.
//
// Исходники (скачиваются руками, в репозиторий не кладутся):
//   dict.opcorpora.txt  http://opencorpora.org/files/export/dict/dict.opcorpora.txt.zip
//                       (сайт периодически лежит; снимок есть в web.archive.org)
//   ru_full.txt         https://github.com/hermitdave/FrequencyWords 2018/ru/ru_full.txt
//   russian.txt         https://github.com/danakt/russian-words (cp1251!)
//
// Запуск:
//   node tools/build-dictionary.mjs [--target words] \
//       --opencorpora <dict.opcorpora.txt> \
//       --frequency   <ru_full.txt> \
//       --forms       <russian.txt> \
//       [--nom 200] [--oblique 300] [--out src/games/words/data]
//
//   node tools/build-dictionary.mjs --target crossword --opencorpora … --frequency … --forms …
//   node tools/build-dictionary.mjs --target balda     --opencorpora … --frequency … --forms …
//
// --nom/--oblique действуют только на --target words: у кроссворда и балды пороги
// зависят от длины слова и заданы таблицами ниже.

import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// --- цели сборки -------------------------------------------------------------

// Порог частотности зависит от длины слова, и это не прихоть: частота падает с длиной.
// Один порог на все длины оставил бы половину трёхбуквенных существительных (а там
// сплошь омонимы аббревиатур и имён — АНТ, ИНК, ИДО) и восемь процентов девятибуквенных
// (где на той же отсечке стоят совершенно обиходные ЩЕЛКУНЧИК и ВЕДОМОСТЬ). Лесенка
// выравнивает не число слов, а их узнаваемость.
//
// mode: 'both' — слово обязано пройти оба порога (защита от омонимов, см. readCandidates),
//       'any'  — достаточно одного. 'any' мягче и нужен там, где словарь описывает не то,
//       что игра загадывает, а то, что игрок вправе составить.

const CROSSWORD_THRESHOLDS = {
    3: [300, 450],
    4: [200, 300],
    5: [200, 300],   // ровно порог «Слов»: банк пятибуквенных совпадает с answers.js
    6: [150, 225],
    7: [100, 150],
    8: [75, 110],
    9: [50, 75],
};

// Балда: поле 5×5, путь по клеткам не самопересекается — длиннее 25 букв слово
// физически не выкладывается, а короче двух не бывает слова вовсе.
const BALDA_MIN = 2;
const BALDA_MAX = 25;
const BALDA_THRESHOLD = [10, 10];

const TARGETS = {
    words: {
        out: join(ROOT, 'src/games/words/data'),
        lengths: [5],
        mode: 'both',
        stoplist: true,
    },
    crossword: {
        out: join(ROOT, 'src/games/crossword/data'),
        lengths: Object.keys(CROSSWORD_THRESHOLDS).map(Number),
        thresholds: CROSSWORD_THRESHOLDS,
        mode: 'both',
        stoplist: true,
    },
    balda: {
        out: join(ROOT, 'src/games/balda/data'),
        lengths: Array.from({ length: BALDA_MAX - BALDA_MIN + 1 }, (_, i) => BALDA_MIN + i),
        threshold: BALDA_THRESHOLD,
        mode: 'any',
        // Стоп-лист здесь НЕ применяется намеренно: он про то, что игра не станет
        // загадывать, а словарь балды — про то, что игрок вправе составить. Отвергать
        // честно найденное слово обиднее, чем никогда его не загадывать.
        stoplist: false,
    },
};

// --- аргументы ---------------------------------------------------------------

function parseArgs(argv) {
    const out = { target: 'words', nom: 200, oblique: 300 };
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i]?.replace(/^--/, '');
        const value = argv[i + 1];
        if (!key || value === undefined) usage(`неполный аргумент: ${argv[i]}`);
        if (key === 'nom' || key === 'oblique') out[key] = Number(value);
        else out[key] = value;
    }
    for (const required of ['opencorpora', 'frequency', 'forms']) {
        if (!out[required]) usage(`не указан --${required}`);
    }
    if (!TARGETS[out.target]) usage(`неизвестный --target: ${out.target}`);
    if (!out.out) out.out = TARGETS[out.target].out;
    return out;
}

function usage(message) {
    console.error(`Ошибка: ${message}\n`);
    console.error('node tools/build-dictionary.mjs [--target words|crossword|balda] \\');
    console.error('    --opencorpora <dict.opcorpora.txt> \\');
    console.error('    --frequency <ru_full.txt> --forms <russian.txt> [--nom 200] [--oblique 300]');
    process.exit(1);
}

// --- общее -------------------------------------------------------------------

// Единственная нормализация во всём проекте: верхний регистр и ё→е.
// Та же функция живёт в src/games/words/core/dictionary.js и в
// src/games/balda/core/dictionary.js — если правится одна, правятся и остальные,
// иначе словарь и ввод разъедутся.
const normalize = (word) => word.trim().toUpperCase().replace(/Ё/g, 'Е');

// Слово нужной длины и только из русских букв. Длины задаёт цель сборки; проверка
// одна на всех, чтобы «пятибуквенность» нигде не была зашита константой.
const RUSSIAN = /^[А-Я]+$/;
function makeIsWord(lengths) {
    const allowed = new Set(lengths);
    return (word) => allowed.has(word.length) && RUSSIAN.test(word);
}

// Граммемы, по которым слово выкидывается из загадываемых: имена, фамилии, отчества,
// топонимы, организации, торговые марки, аббревиатуры, инициалы.
const EXCLUDED_GRAMMEMES = ['Name', 'Surn', 'Patr', 'Geox', 'Orgn', 'Trad', 'Abbr', 'Init'];

// Субстантивированные прилагательные («новое», «малый»): OpenCorpora держит для них
// отдельную парадигму NOUN, а частоту им делает прилагательное. Ловятся по паре
// «окончание прилагательного + существует парадигма ADJF с такой же формой».
const ADJECTIVE_TAIL = /(ОЕ|ЫЙ|ИЙ|АЯ|ЯЯ|ЕЕ|ОЙ)$/;

function log(message) {
    process.stdout.write(`${message}\n`);
}

// --- частоты -----------------------------------------------------------------

function readFrequencies(path) {
    const freq = new Map();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const space = line.indexOf(' ');
        if (space < 1) continue;
        const count = Number(line.slice(space + 1));
        if (!Number.isFinite(count)) continue;
        const word = normalize(line.slice(0, space));
        freq.set(word, (freq.get(word) ?? 0) + count);
    }
    return freq;
}

// --- широкий список ----------------------------------------------------------

function readAllowed(path, isWord) {
    // danakt/russian-words лежит в cp1251. Имена собственные отличаются заглавной буквой —
    // это единственный признак, который в этом списке вообще есть.
    const text = new TextDecoder('windows-1251').decode(readFileSync(path));
    const words = new Set();
    for (const line of text.split(/\r?\n/)) {
        const raw = line.trim();
        if (!raw || raw[0] !== raw[0].toLowerCase()) continue;
        const word = normalize(raw);
        if (isWord(word)) words.add(word);
    }
    return words;
}

// --- OpenCorpora -------------------------------------------------------------

// Формат: блоки парадигм, разделённые пустой строкой. Первая строка блока — номер,
// дальше «СЛОВОФОРМА<TAB>ГРАММЕМЫ». Лемма — первая словоформа блока.
async function readCandidates(path, freq, isWord) {
    const candidates = new Map();   // слово -> { nominative, oblique }
    const adjectives = new Set();   // формы нужной длины, у которых есть парадигма ADJF

    let block = [];

    const flush = () => {
        if (block.length < 2) { block = []; return; }

        for (let i = 1; i < block.length; i++) {
            const [form, tags] = block[i].split('\t');
            if (!tags) continue;
            const word = normalize(form ?? '');
            if (isWord(word) && tags.split(/[,\s]+/)[0] === 'ADJF') adjectives.add(word);
        }

        const [lemma, tagString] = block[1].split('\t');
        const tags = (tagString ?? '').split(/[,\s]+/);
        const word = normalize(lemma ?? '');

        const isNounNomSing = tags[0] === 'NOUN'
            && tags.includes('sing') && tags.includes('nomn')
            && !EXCLUDED_GRAMMEMES.some((g) => tags.includes(g));

        if (isNounNomSing && isWord(word)) {
            // Частота косвенных форм — защита от омонимов, у которых частоту делает не
            // существительное: у «погиб» именительный весит 5651 (это глагол), а
            // «погиба»/«погибу» вместе — единицу.
            let oblique = 0;
            let distinctForms = 0;
            for (let i = 2; i < block.length; i++) {
                const form = normalize(block[i].split('\t')[0] ?? '');
                if (form === word) continue;
                distinctForms++;
                oblique += freq.get(form) ?? 0;
            }
            // У несклоняемых («такси», «радио», «мадам») косвенных форм нет вовсе —
            // для них проверка вырождается в частоту самого слова.
            const score = distinctForms === 0 ? (freq.get(word) ?? 0) : oblique;
            const previous = candidates.get(word);
            if (!previous || previous.oblique < score) {
                candidates.set(word, { nominative: freq.get(word) ?? 0, oblique: score });
            }
        }
        block = [];
    };

    const lines = createInterface({
        input: createReadStream(path, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });
    for await (const line of lines) {
        if (line.trim() === '') flush();
        else block.push(line);
    }
    flush();

    return { candidates, adjectives };
}

// --- стоп-лист ---------------------------------------------------------------

function readStoplist(path) {
    const words = new Set();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const raw = line.replace(/#.*$/, '').trim();
        if (raw) words.add(normalize(raw));
    }
    return words;
}

// --- запись ------------------------------------------------------------------

// Слова хранятся одной отсортированной строкой без разделителей: слайсы фиксированной
// ширины. Замерено на 24 252 пятибуквенных: строка — 260 КБ / 66 КБ gzip, JSON-массив
// тех же слов — 315 КБ. Побитовая упаковка (5 бит на букву) даёт 76 КБ и после gzip
// не сжимается вовсе — она хуже обычного текста, который DEFLATE жмёт на общих префиксах.
function writeModule(path, header, words, wordLength) {
    const packed = [...words].sort().join('');
    writeFileSync(path, `${header}\nexport default '${packed}';\n`, 'utf8');
    return packed.length / wordLength;
}

// То же, но для нескольких длин сразу: разделителя по-прежнему нет, ширина слайса
// известна из ключа. Один общий список с переносами строк стоил бы по два байта на
// слово и лишил бы распаковку возможности резать строку арифметикой.
function writeLengthModule(path, header, byLength) {
    const lengths = [...byLength.keys()].sort((a, b) => a - b);
    const body = lengths
        .map((len) => `    ${len}: '${[...byLength.get(len)].sort().join('')}',`)
        .join('\n');
    writeFileSync(path, `${header}\nexport default {\n${body}\n};\n`, 'utf8');
    return lengths.reduce((sum, len) => sum + byLength.get(len).size, 0);
}

const ANSWERS_HEADER = `// Загадываемые слова игры «Слова»: пятибуквенные существительные в именительном
// падеже единственного числа, отобранные по частотности.
//
// СГЕНЕРИРОВАНО tools/build-dictionary.mjs — руками не править.
// Ручные исключения живут в tools/stoplist.txt.
//
// Источник: OpenCorpora (http://opencorpora.org/), лицензия CC BY-SA 4.0.
// Частотный фильтр: hermitdave/FrequencyWords (OpenSubtitles 2018), CC BY-SA 4.0.
// Как производное от них ЭТОТ ФАЙЛ распространяется под CC BY-SA 4.0,
// а не под лицензией остального репозитория. Подробности — src/games/words/data/NOTICE.
//
// Слова уложены одной отсортированной строкой без разделителей, по 5 букв на слово.
// Буквы «ё» в словаре нет: она всюду нормализована в «е».`;

const ALLOWED_HEADER = `// Допустимые догадки игры «Слова»: все пятибуквенные русские словоформы.
//
// СГЕНЕРИРОВАНО tools/build-dictionary.mjs — руками не править.
//
// Источник: danakt/russian-words (https://github.com/danakt/russian-words), лицензия MIT.
// Copyleft на этот файл не распространяется. Подробности — src/games/words/data/NOTICE.
//
// Слова уложены одной отсортированной строкой без разделителей, по 5 букв на слово.
// Буквы «ё» в словаре нет: она всюду нормализована в «е».`;

const CROSSWORD_HEADER = `// Банк слов кроссворда-скелета: существительные в именительном падеже единственного
// числа длиной 3–9 букв, отобранные по частотности.
//
// СГЕНЕРИРОВАНО tools/build-dictionary.mjs --target crossword — руками не править.
// Ручные исключения живут в tools/stoplist.txt.
//
// Источник: OpenCorpora (http://opencorpora.org/), лицензия CC BY-SA 4.0.
// Частотный фильтр: hermitdave/FrequencyWords (OpenSubtitles 2018), CC BY-SA 4.0.
// Как производное от них ЭТОТ ФАЙЛ распространяется под CC BY-SA 4.0,
// а не под лицензией остального репозитория. Подробности — src/games/crossword/data/NOTICE.
//
// Формат: объект «длина слова → одна отсортированная строка без разделителей».
// Разделители не нужны, потому что внутри каждой строки слайсы фиксированной ширины,
// равной ключу: слово номер i — это slice(i * len, i * len + len). Это тот же формат,
// что у «Слов» (там длина одна и ключ не нужен): он на 20% компактнее JSON-массива,
// а на общих префиксах отсортированного списка DEFLATE отыгрывает ещё вчетверо.
// Порог частотности зависит от длины: частота падает с длиной слова, и единый порог
// оставил бы в трёхбуквенных омонимы аббревиатур, а из девятибуквенных выбросил бы
// обиходные слова. Таблица порогов — в шапке tools/build-dictionary.mjs.
// Буквы «ё» в словаре нет: она всюду нормализована в «е».`;

const BALDA_HEADER = `// Словарь балды: существительные в именительном падеже единственного числа, все длины,
// которые физически выкладываются на поле 5×5 (2–25 букв: путь по клеткам не
// самопересекается, значит длиннее 25 букв слово не поместится).
//
// СГЕНЕРИРОВАНО tools/build-dictionary.mjs --target balda — руками не править.
//
// Источник: OpenCorpora (http://opencorpora.org/), лицензия CC BY-SA 4.0.
// Частотный фильтр: hermitdave/FrequencyWords (OpenSubtitles 2018), CC BY-SA 4.0.
// Как производное от них ЭТОТ ФАЙЛ распространяется под CC BY-SA 4.0,
// а не под лицензией остального репозитория. Подробности — src/games/balda/data/NOTICE.
//
// Формат: объект «длина слова → одна отсортированная строка без разделителей»,
// слайсы фиксированной ширины, равной ключу. Разворачивает его unpack() из
// src/games/balda/core/dictionary.js, он же строит из плоского списка префиксное
// дерево — возить сериализованный бор дороже, чем построить его за десяток
// миллисекунд при первом mount().
//
// Порог частотности здесь намеренно мягче, чем у загадываемых слов «Слов»: словарь
// балды — это то, что игрок вправе составить, а не то, что ему загадывают. Отвергнуть
// честно найденное слово обиднее, чем никогда его не загадать, поэтому достаточно
// одного сигнала частотности из двух (см. tools/build-dictionary.mjs).
// Стоп-лист tools/stoplist.txt на этот файл не распространяется — по той же причине.
// Буквы «ё» в словаре нет: она всюду нормализована в «е».`;

// --- основной сценарий -------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const target = TARGETS[args.target];
const isWord = makeIsWord(target.lengths);

// Порог для конкретной длины: у «Слов» он приходит из аргументов, у остальных —
// из таблицы цели.
function thresholdFor(length) {
    if (target.thresholds) return target.thresholds[length];
    if (target.threshold) return target.threshold;
    return [args.nom, args.oblique];
}

log(`Цель: ${args.target} (длины ${target.lengths[0]}–${target.lengths[target.lengths.length - 1]})`);

log('Частоты…');
const freq = readFrequencies(args.frequency);
log(`  словоформ с частотой: ${freq.size}`);

log('Широкий список (danakt)…');
const allowed = readAllowed(args.forms, isWord);
log(`  словоформ нужной длины: ${allowed.size}`);

log('OpenCorpora (файл большой, это займёт минуту)…');
const { candidates, adjectives } = await readCandidates(args.opencorpora, freq, isWord);
log(`  существительных им. п. ед. ч.: ${candidates.size}`);

const stoplist = target.stoplist ? readStoplist(join(HERE, 'stoplist.txt')) : new Set();

const rejected = { notInAllowed: 0, adjective: 0, rare: 0, stoplist: 0 };
const selected = new Map();   // длина -> Set слов
for (const length of target.lengths) selected.set(length, new Set());

for (const [word, { nominative, oblique }] of candidates) {
    // Отобранное обязано быть в широком списке. Пересечение, а не досыпка:
    // 521 пятибуквенный кандидат вне широкого списка — это почти сплошь имена
    // собственные, мат и свежие заимствования, то есть ровно то, что не нужно.
    if (!allowed.has(word)) { rejected.notInAllowed++; continue; }
    if (ADJECTIVE_TAIL.test(word) && adjectives.has(word)) { rejected.adjective++; continue; }
    const [nomMin, obliqueMin] = thresholdFor(word.length);
    const passes = target.mode === 'any'
        ? (nominative >= nomMin || oblique >= obliqueMin)
        : (nominative >= nomMin && oblique >= obliqueMin);
    if (!passes) { rejected.rare++; continue; }
    if (stoplist.has(word)) { rejected.stoplist++; continue; }
    selected.get(word.length).add(word);
}

log('Отсев:');
log(`  нет в широком списке: ${rejected.notInAllowed}`);
log(`  субстантивированные прилагательные: ${rejected.adjective}`);
log(`  редкие (порог по длине, режим ${target.mode}): ${rejected.rare}`);
log(`  стоп-лист: ${rejected.stoplist}`);

mkdirSync(args.out, { recursive: true });

if (args.target === 'words') {
    const answers = selected.get(5);
    // Инвариант, который проверяется ещё и тестом: без него игра примет слово как ответ,
    // но не даст его ввести.
    for (const word of answers) {
        if (!allowed.has(word)) throw new Error(`загадываемое слово вне списка догадок: ${word}`);
    }
    const answersCount = writeModule(join(args.out, 'answers.js'), ANSWERS_HEADER, answers, 5);
    const allowedCount = writeModule(join(args.out, 'allowed.js'), ALLOWED_HEADER, allowed, 5);
    log('');
    log(`Готово: загадываемых ${answersCount}, допустимых ${allowedCount}`);
    log(`  ${join(args.out, 'answers.js')}`);
    log(`  ${join(args.out, 'allowed.js')}`);
} else {
    // Пустые длины в файл не кладём: у балды слов длиннее двадцати одной буквы,
    // проходящих порог, просто нет, и пустая строка в объекте только путала бы.
    for (const [length, words] of [...selected]) {
        if (words.size === 0) selected.delete(length);
    }
    const header = args.target === 'crossword' ? CROSSWORD_HEADER : BALDA_HEADER;
    const path = join(args.out, 'words.js');
    const total = writeLengthModule(path, header, selected);
    log('');
    log('По длинам:');
    for (const [length, words] of [...selected].sort((a, b) => a[0] - b[0])) {
        log(`  ${String(length).padStart(2)}: ${words.size}`);
    }
    log(`Готово: слов ${total}`);
    log(`  ${path}`);
}
