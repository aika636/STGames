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
    const at = css.indexOf(selector);
    if (at < 0) return null;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    const declarations = new Map();
    for (const m of css.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
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

report('палитра');
