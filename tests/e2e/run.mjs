// Раннер e2e: один запуск таверны и один браузер на весь прогон, все наборы —
// в этом же процессе (у _harness.mjs счётчик тестов на модуль, и отдельные процессы
// пришлось бы сводить руками).
//
// Обычные unit-тесты живут в *.test.mjs и запускаются через tests/run.mjs; e2e лежат
// в *.e2e.mjs и намеренно не попадают в тот прогон — им нужны и SillyTavern, и браузер.
//
//   STGAMES_ST_DIR=<каталог SillyTavern> node tests/e2e/run.mjs [фильтр] [--headed] [--fresh]
//
// --headed открывает настоящее окно браузера и по окончании прогона НЕ закрывает его,
// пока не нажмёшь Enter: иначе окно пропадает ровно в тот момент, ради которого headed
// и включали (особенно при падении — finally срабатывает сразу после catch).
// --close-at-end отключает это ожидание, если headed нужен без ручного финала.

import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { report } from '../_harness.mjs';
import { openTavern, startTavern, REPO } from './_st.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const fresh = argv.includes('--fresh');
const keepOpen = headed && !argv.includes('--close-at-end');
const filter = argv.find((arg) => !arg.startsWith('--'));
const port = Number(process.env.STGAMES_E2E_PORT || 8123);

let files = readdirSync(DIR)
    .filter((name) => name.endsWith('.e2e.mjs'))
    .sort()
    .map((name) => join(DIR, name));

if (filter) {
    files = files.filter((file) => file.includes(filter));
    if (files.length === 0) {
        console.error(`Фильтр «${filter}» не совпал ни с одним набором e2e.`);
        process.exit(1);
    }
}

let playwright;
try {
    playwright = await import('playwright');
} catch {
    console.error('⚠ playwright не установлен: npm install --no-save jsdom playwright && npx playwright install chromium');
    process.exit(1);
}

let tavern = null;
let browser = null;
let session = null;

try {
    console.log(`Запускаю SillyTavern на порту ${port}…`);
    tavern = await startTavern({ port, fresh });
    console.log(`  ${tavern.url}  (данные: ${tavern.dataRoot})`);

    browser = await playwright.chromium.launch({ headless: !headed });
    session = await openTavern(browser, tavern.url);

    const env = { ...session, browser, url: tavern.url };

    for (const file of files) {
        console.log(`\n${relative(REPO, file)}`);
        const suite = await import(pathToFileURL(file).href);
        await suite.default(env);
    }

    report('e2e');
} catch (err) {
    console.error(`\n✗ прогон не состоялся: ${err.message}`);
    process.exitCode = 1;
} finally {
    if (keepOpen && browser?.isConnected()) await waitForEnter();
    await session?.context.close().catch(() => {});
    await browser?.close().catch(() => {});
    tavern?.stop();
}

// Держим окно и таверну живыми, пока смотрим глазами. stdin в pipe (запуск из-под
// обвязки без терминала) ждать нечего — просто выходим.
function waitForEnter() {
    if (!process.stdin.isTTY) return Promise.resolve();
    console.log('\nОкно оставлено открытым — Enter, чтобы закрыть браузер и таверну.');
    return new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.once('data', () => {
            process.stdin.pause();
            resolve();
        });
    });
}
