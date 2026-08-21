// Слой палитры: правило «цвета канваса — только литералы» проверяется по самому
// style.css. Значения CSS в node не вычислить, но проверяемое тут не значение, а форма
// записи, и она видна прямо в файле.
//
// Зачем такой тест вообще нужен. Полупрозрачная переменная темы ST в fillStyle даёт
// НЕВИДИМУЮ фигуру: --SmartThemeBorderColor (цвет рамки) и --SmartThemeBlurTintColor
// (тинт размытия) полупрозрачны по своей природе, а фон канваса в режиме theme сам почти
// прозрачный. Литеральный фолбэк не спасает — переменная существует, она просто
// прозрачная. Так на телефоне пропали обычные платформы «Дудл Джампа»: спецплатформы с
// литеральными цветами были видны, а обычные — нет.
//
// Список имён берётся из ИСХОДНИКОВ игр, а не переписывается сюда руками: новый цвет
// канваса попадает под правило сам, без правки теста.
//
// Запуск: node tests/shell/palette.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, assertEqual, report, test } from '../_harness.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const css = readFileSync(join(ROOT, 'style.css'), 'utf8');
// Комментарии выкидываем до разбора: в файле их много, и в них попадаются имена
// переменных с двоеточием («тот же тон, что и --stg-surface: …»). Наивный разбор
// объявлений принимает такое за объявление и съедает вместе с ним следующее — тест
// начинает ругаться на переменную, которая на месте.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

// Имена, которые JS читает через getComputedStyle и льёт в fillStyle/strokeStyle: их
// видно по строковому литералу '--stg-…' в коде игры. Скины «Дудл Джампа» держат свои
// имена в palette-таблицах, но записаны они теми же литералами и потому ловятся так же.
function collectNames(dir, found = new Set()) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) collectNames(full, found);
        else if (entry.name.endsWith('.js')) {
            const text = readFileSync(full, 'utf8');
            for (const m of text.matchAll(/'(--stg-[a-z0-9-]+)'/g)) found.add(m[1]);
        }
    }
    return found;
}

const names = [...collectNames(join(ROOT, 'src', 'games'))].sort();

// Три режима палитры — три блока объявлений. Ищем блок по селектору и режем до
// закрывающей скобки: вложенных блоков внутри них нет.
function block(selector) {
    const at = cssCode.indexOf(selector);
    if (at < 0) return null;
    const open = cssCode.indexOf('{', at);
    const close = cssCode.indexOf('}', open);
    const declarations = new Map();
    for (const m of cssCode.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
        // Последнее объявление побеждает — как и в браузере (в файле есть пары
        // «фолбэк, затем color-mix»).
        declarations.set(m[1], m[2].trim());
    }
    return declarations;
}

const MODES = [
    ['theme', block('.stg-root {')],
    ['dark', block(".stg-root[data-stg-theme='dark'] {")],
    ['light', block(".stg-root[data-stg-theme='light'] {")],
];

console.log('палитра');

test('в стилях нашлись все три блока палитры', () => {
    for (const [mode, declarations] of MODES) {
        assert(declarations, `блок режима ${mode} на месте`);
        assert(declarations.size > 10, `в режиме ${mode} есть объявления`);
    }
});

test('цвета канваса вообще есть в списке', () => {
    // Страховка от «тест позеленел, потому что ничего не нашёл»: если сбор имён сломается,
    // проверять станет нечего и все проверки ниже пройдут молча.
    assert(names.length >= 20, `имён цветов канваса собрано ${names.length}`);
    assert(names.includes('--stg-doodlejump-platform'), 'обычная платформа в списке');
    assert(names.includes('--stg-snake-body'), 'тело змейки в списке');
});

for (const [mode, declarations] of MODES) {
    test(`режим ${mode}: цвета канваса объявлены и заданы литералами`, () => {
        for (const name of names) {
            const value = declarations.get(name);
            assert(value, `${name} объявлен в режиме ${mode}`);
            assertEqual(
                /var\(/.test(value),
                false,
                `${name} в режиме ${mode} тянется из другой переменной (${value}): `
                + 'переменные темы ST бывают полупрозрачными, и заливка канваса пропадает',
            );
            assertEqual(
                /color-mix\(/.test(value),
                false,
                `${name} в режиме ${mode} задан через color-mix (${value}): `
                + 'до JS такое значение доезжает неразобранным',
            );
        }
    });
}

// --- Непрозрачные подложки.
//
// Вторая грань того же слоя. В режиме theme --stg-surface и --stg-bg полупрозрачны по
// замыслу (плашки поверх попапа ST должны просвечивать), и всё, что собрано из них через
// color-mix, наследует их альфу: у экрана проигрыша «Дудл Джампа» она вышла 0.041 против
// 0.82 в двух других режимах — оверлея фактически не было, платформы перечёркивали счёт,
// а на светлой теме таверны сквозь поле читался чат. Подложка, которая обязана
// перекрывать фон под собой, берёт --stg-solid.

const BACKDROPS = [
    '.doodlejump-stage',
    '.doodlejump-over',
    '.doodlejump-shop',
];

// Значение background-color правила: последнее объявление побеждает, как и в браузере.
function backgroundOf(selector) {
    const at = cssCode.indexOf(`\n${selector} {`);
    if (at < 0) return null;
    const open = cssCode.indexOf('{', at);
    const close = cssCode.indexOf('}', open);
    let value = null;
    for (const m of cssCode.slice(open + 1, close).matchAll(/background-color\s*:\s*([^;]+);/g)) {
        value = m[1].trim();
    }
    return value;
}

// Подложка и текст на ней — пара: раз цвет подложки не зависит от темы таверны, то и
// цвет текста не может от неё зависеть. Иначе выходит тёмное по тёмному — так в витрине
// пропали названия скинов и цены, когда подложку сделали непрозрачной, а текст оставили
// на --stg-fg (тот в режиме theme берётся из темы ST).
// Цвет текста правила: как backgroundOf, но по свойству color.
function colorOf(selector) {
    const at = cssCode.indexOf(`\n${selector} {`);
    if (at < 0) return null;
    const open = cssCode.indexOf('{', at);
    const close = cssCode.indexOf('}', open);
    let value = null;
    for (const m of cssCode.slice(open + 1, close).matchAll(/(?<!-)color\s*:\s*([^;]+);/g)) {
        value = m[1].trim();
    }
    return value;
}

test('--stg-solid и --stg-solid-fg объявлены литералами во всех трёх режимах', () => {
    for (const [mode, declarations] of MODES) {
        for (const name of ['--stg-solid', '--stg-solid-fg']) {
            const value = declarations.get(name);
            assert(value, `${name} объявлен в режиме ${mode}`);
            assert(
                /^#[0-9a-f]{6}$/.test(value),
                `${name} в режиме ${mode} — ${value}: подложка и текст на ней задаются `
                + 'непрозрачными литералами, иначе видно то, что они закрывают',
            );
        }
    }
});

test('подложки не собираются из полупрозрачных --stg-surface/--stg-bg', () => {
    for (const selector of BACKDROPS) {
        const value = backgroundOf(selector);
        assert(value, `у ${selector} задан background-color`);
        for (const name of ['--stg-surface', '--stg-bg']) {
            assertEqual(
                value.includes(name),
                false,
                `${selector} красится через ${name} (${value}): в режиме theme эта `
                + 'переменная полупрозрачна, и подложка перестаёт перекрывать фон',
            );
        }
        assert(
            value.includes('--stg-solid'),
            `${selector} красится не от --stg-solid (${value})`,
        );
        const text = colorOf(selector);
        assert(
            text === null || text.includes('--stg-solid-fg'),
            `${selector} берёт цвет текста не от --stg-solid-fg (${text}): на подложке, `
            + 'не зависящей от темы ST, текст из темы ST может оказаться невидимым',
        );
    }
});

report('палитра');
