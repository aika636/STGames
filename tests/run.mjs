// Единый раннер: собирает все *.test.mjs под tests/ и гоняет каждый отдельным
// процессом. jsdom-тесты вешают на процесс глобальные window/document/SillyTavern,
// поэтому в одном процессе они бы мешали друг другу.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function collectTests(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...collectTests(full));
        } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
            found.push(full);
        }
    }
    return found;
}

let files = collectTests(TESTS_DIR).sort();

const filter = process.argv[2];
if (filter) {
    const matched = files.filter((f) => f.includes(filter));
    if (matched.length === 0) {
        console.error(`Фильтр «${filter}» не совпал ни с одним тестом. Найдены файлы:`);
        for (const f of files) console.error(`  ${relative(ROOT, f)}`);
        process.exit(1);
    }
    files = matched;
}

let jsdomReady = true;
try {
    await import('jsdom');
} catch {
    jsdomReady = false;
}

let failed = 0;

// Без jsdom UI-тесты не пропускаем, а даём им упасть на импорте: угадывать «нужен ли
// файлу jsdom» по его тексту ненадёжно — тест, получающий окружение через _harness.mjs,
// сам слова «jsdom» не содержит и молча уехал бы в зелёный прогон. Подсказку печатаем
// в конце, чтобы причина падений была очевидна.
for (const file of files) {
    const rel = relative(ROOT, file);
    const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
    if (result.status !== 0) {
        failed++;
        console.error(`  ✗ ${rel}: код выхода ${result.status ?? result.error?.message ?? 'неизвестен'}`);
    }
}

if (!jsdomReady && failed > 0) {
    console.error('⚠ jsdom не установлен — UI-тесты падают на импорте: npm install --no-save jsdom');
}

console.log(`\n${files.length} файлов, ${failed} упало`);
process.exitCode = failed > 0 ? 1 : 0;
