#!/usr/bin/env node
// Сборка словарей игры «Слова» (src/games/words/data/).
//
// ОФЛАЙН-ИНСТРУМЕНТ. Браузер его не грузит, расширение от него не зависит, npm-пакетов
// он не требует. Запускается руками при перегенерации словаря; результат коммитится
// готовым, поэтому «no build step» не нарушается.
//
// Два списка на выходе:
//   answers.js  — загадываемые: существительные в им. п. ед. ч., отфильтрованные по
//                 частотности. Производное от OpenCorpora, поэтому CC BY-SA 4.0.
//   allowed.js  — допустимые догадки: все пятибуквенные словоформы. Из danakt/russian-words,
//                 MIT. Включает answers целиком.
//
// Исходники (скачиваются руками, в репозиторий не кладутся):
//   dict.opcorpora.txt  http://opencorpora.org/files/export/dict/dict.opcorpora.txt.zip
//                       (сайт периодически лежит; снимок есть в web.archive.org)
//   ru_full.txt         https://github.com/hermitdave/FrequencyWords 2018/ru/ru_full.txt
//   russian.txt         https://github.com/danakt/russian-words (cp1251!)
//
// Запуск:
//   node tools/build-dictionary.mjs \
//       --opencorpora <dict.opcorpora.txt> \
//       --frequency   <ru_full.txt> \
//       --forms       <russian.txt> \
//       [--nom 200] [--oblique 300] [--out src/games/words/data]

import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// --- аргументы ---------------------------------------------------------------

function parseArgs(argv) {
    const out = { nom: 200, oblique: 300, out: join(ROOT, 'src/games/words/data') };
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
    return out;
}

function usage(message) {
    console.error(`Ошибка: ${message}\n`);
    console.error('node tools/build-dictionary.mjs --opencorpora <dict.opcorpora.txt> \\');
    console.error('    --frequency <ru_full.txt> --forms <russian.txt> [--nom 200] [--oblique 300]');
    process.exit(1);
}

// --- общее -------------------------------------------------------------------

// Единственная нормализация во всём проекте: верхний регистр и ё→е.
// Та же функция живёт в src/games/words/core/dictionary.js — если правится одна,
// правится и вторая, иначе словарь и ввод разъедутся.
const normalize = (word) => word.trim().toUpperCase().replace(/Ё/g, 'Е');
const isWord = (word) => /^[А-Я]{5}$/.test(word);

const WORD_LENGTH = 5;

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

function readAllowed(path) {
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
async function readCandidates(path, freq) {
    const candidates = new Map();   // слово -> { nominative, oblique }
    const adjectives = new Set();   // пятибуквенные формы, у которых есть парадигма ADJF

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

// Слова хранятся одной отсортированной строкой без разделителей: слайсы по пять.
// Замерено на 24 252 словах: строка — 260 КБ / 66 КБ gzip, JSON-массив тех же слов —
// 315 КБ. Побитовая упаковка (5 бит на букву) даёт 76 КБ и после gzip не сжимается
// вовсе — она хуже обычного текста, который DEFLATE жмёт на общих префиксах.
function writeModule(path, header, words) {
    const packed = [...words].sort().join('');
    writeFileSync(path, `${header}\nexport default '${packed}';\n`, 'utf8');
    return packed.length / WORD_LENGTH;
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

// --- основной сценарий -------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

log('Частоты…');
const freq = readFrequencies(args.frequency);
log(`  словоформ с частотой: ${freq.size}`);

log('Широкий список (danakt)…');
const allowed = readAllowed(args.forms);
log(`  пятибуквенных словоформ: ${allowed.size}`);

log('OpenCorpora (файл большой, это займёт минуту)…');
const { candidates, adjectives } = await readCandidates(args.opencorpora, freq);
log(`  существительных им. п. ед. ч. на 5 букв: ${candidates.size}`);

const stoplist = readStoplist(join(HERE, 'stoplist.txt'));

const rejected = { notInAllowed: 0, adjective: 0, rare: 0, stoplist: 0 };
const answers = new Set();

for (const [word, { nominative, oblique }] of candidates) {
    // Загадываемое обязано быть допустимой догадкой. Пересечение, а не досыпка:
    // 521 кандидат вне широкого списка — это почти сплошь имена собственные, мат
    // и свежие заимствования, то есть ровно то, что загадывать не надо.
    if (!allowed.has(word)) { rejected.notInAllowed++; continue; }
    if (ADJECTIVE_TAIL.test(word) && adjectives.has(word)) { rejected.adjective++; continue; }
    if (nominative < args.nom || oblique < args.oblique) { rejected.rare++; continue; }
    if (stoplist.has(word)) { rejected.stoplist++; continue; }
    answers.add(word);
}

log('Отсев:');
log(`  нет в широком списке: ${rejected.notInAllowed}`);
log(`  субстантивированные прилагательные: ${rejected.adjective}`);
log(`  редкие (порог ${args.nom}/${args.oblique}): ${rejected.rare}`);
log(`  стоп-лист: ${rejected.stoplist}`);

// Инвариант, который проверяется ещё и тестом: без него игра примет слово как ответ,
// но не даст его ввести.
for (const word of answers) {
    if (!allowed.has(word)) throw new Error(`загадываемое слово вне списка догадок: ${word}`);
}

mkdirSync(args.out, { recursive: true });
const answersCount = writeModule(join(args.out, 'answers.js'), ANSWERS_HEADER, answers);
const allowedCount = writeModule(join(args.out, 'allowed.js'), ALLOWED_HEADER, allowed);

log('');
log(`Готово: загадываемых ${answersCount}, допустимых ${allowedCount}`);
log(`  ${join(args.out, 'answers.js')}`);
log(`  ${join(args.out, 'allowed.js')}`);
