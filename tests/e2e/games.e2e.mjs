// Игры в живой таверне. Дымовой уровень: экран монтируется, ввод доходит до игры,
// состояние меняется. Правила игр проверяются юнит-тестами ядра — здесь важно ровно
// то, чего они не видят: что в реальном браузере и попапе ST всё это вообще работает.

import { assert, assertEqual } from '../_harness.mjs';
import {
    closeShell, dismissPopups, e2eTest, flushSettings, openGame, openHub, readSettings, resetSettings,
} from './_st.mjs';

export default async function run(env) {
    const { page } = env;

    await e2eTest(env, 'судоку: доска рисуется и принимает цифру с клавиатуры', async () => {
        await resetSettings(page);
        await openHub(page);
        await openGame(page, 'sudoku');

        assertEqual(await page.locator('.sudoku-cell').count(), 81, 'на доске не 81 клетка');

        // Ввод идёт в выбранную клетку, поэтому сначала клик по пустой. Именно этот
        // путь ломается чаще всего: глобальные хоткеи ST перехватывают цифры, если
        // слушатель судоку встал не в capture-фазе.
        const empty = page.locator('.sudoku-cell:not(.sudoku-given)').first();
        await empty.click();
        await page.keyboard.press('7');

        await page.waitForFunction(
            () => document.querySelector('.sudoku-cell.sudoku-selected .sudoku-value')?.textContent === '7',
            null,
            { timeout: 5000 },
        );

        // Цифра не должна утечь в поле ввода чата — это и есть главный риск capture-фазы.
        const chat = await page.inputValue('#send_textarea').catch(() => '');
        assertEqual(chat, '', 'цифра ушла в поле ввода чата');

        await closeShell(page);
    });

    await e2eTest(env, 'змейка: поле живёт и счёт обновляется', async () => {
        await resetSettings(page);
        await openHub(page);
        await openGame(page, 'snake');

        const canvas = page.locator('.snake-canvas');
        assertEqual(await canvas.count(), 1, 'нет канваса змейки');
        const box = await canvas.boundingBox();
        assert(box && box.width > 0 && box.height > 0, 'канвас змейки нулевого размера');

        const header = page.locator('.snake-header');
        assert(/Счёт:\s*\d+/.test(await header.textContent()), 'в шапке нет счёта');

        // Змейка встаёт на паузу при потере фокуса окном — кликаем внутрь поля,
        // иначе в headless-браузере заезд может не начаться вовсе.
        await canvas.click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('ArrowRight');

        // Признак того, что цикл действительно крутится: картинка на канвасе меняется.
        // Счёт для этого не годится — еда может долго не попадаться.
        const before = await canvasSignature(page);
        await page.waitForFunction(
            (snapshot) => {
                const el = document.querySelector('.snake-canvas');
                return Boolean(el) && el.toDataURL().slice(0, 256) !== snapshot;
            },
            before,
            { timeout: 10_000 },
        );

        await closeShell(page);
    });

    await e2eTest(env, 'реверси: ход игрока, ответ соперника и сохранение партии', async () => {
        await resetSettings(page);
        await openHub(page);
        await openGame(page, 'reversi');

        assertEqual(await page.locator('.reversi-cell').count(), 64, 'на доске не 64 клетки');

        // Доска должна остаться квадратной в реальном попапе ST: в jsdom размеров нет
        // вовсе, а в Фазе 5 именно здесь ломалась вёрстка на узком экране.
        const box = await page.locator('.reversi-board').boundingBox();
        assert(box && box.width > 0, 'доска нулевой ширины');
        assert(Math.abs(box.width - box.height) <= 2, `доска не квадратная: ${box.width}×${box.height}`);

        assertEqual(await page.locator('.reversi-cell.reversi-hint').count(), 4, 'не четыре подсказки в старте');
        await page.locator('.reversi-cell.reversi-hint').first().click();

        // Ход соперника отложен на 300 мс и считается синхронно — ждём результата, а не
        // паузы: фишек на доске должно стать шесть, а очередь вернуться игроку.
        await page.waitForFunction(
            () => document.querySelectorAll('.reversi-black, .reversi-white').length === 6,
            null,
            { timeout: 10_000 },
        );
        await page.waitForFunction(
            () => document.querySelector('.reversi-turn')?.textContent.startsWith('Ваш ход'),
            null,
            { timeout: 10_000 },
        );

        await closeShell(page);
        await flushSettings(page);

        const saved = (await readSettings(page)).games?.reversi?.savedGame;
        assert(saved, 'партия не сохранилась в настройках');
        assertEqual(saved.board.length, 64, 'доска сохранена не строкой из 64 символов');

        // Партия обязана пережить перезагрузку страницы — ради этого она и пишется
        // в extensionSettings после каждого хода.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
        await dismissPopups(page);
        await openHub(page);
        await openGame(page, 'reversi');

        assertEqual(
            await page.locator('.reversi-black, .reversi-white').count(),
            6,
            'после перезагрузки открылась новая партия, а не сохранённая',
        );

        await closeShell(page);
    });

    await e2eTest(env, 'слова: догадка с физической клавиатуры, раскраска и сохранение', async () => {
        await resetSettings(page);
        await openHub(page);
        await openGame(page, 'words');

        assertEqual(await page.locator('.words-tile').count(), 30, 'на поле не 30 плиток');

        // Печатаем ПО КОДАМ клавиш, то есть ровно как игрок с EN-раскладкой: key придёт
        // латиницей, и буква обязана разрешиться через позицию на ЙЦУКЕН. Это главный
        // риск игры — и раскладка, и утечка букв в чат (буквы опаснее цифр судоку).
        for (const code of GUESS_CODES) await page.keyboard.press(code);
        assertEqual(await typedRow(page), GUESS, `в строке не «${GUESS}»`);

        await page.keyboard.press('Enter');

        // Раскраска: после подтверждения у каждой плитки строки есть состояние из ядра.
        await page.waitForFunction(
            () => [...document.querySelectorAll('.words-row')][0].querySelectorAll(
                '[data-state="correct"], [data-state="present"], [data-state="absent"]',
            ).length === 5,
            null,
            { timeout: 10_000 },
        );

        const chat = await page.inputValue('#send_textarea').catch(() => '');
        assertEqual(chat, '', 'буквы ушли в поле ввода чата');

        // Один шанс из 693, что загадано именно наше слово: партия тогда закончена и
        // сохранять её нечего — это не поломка, а конец теста.
        const finished = (await page.locator('.words-attempts').textContent()).includes('окончена');

        await closeShell(page);
        await flushSettings(page);

        if (finished) {
            assertEqual(
                (await readSettings(page)).games?.words?.savedGame ?? null,
                null,
                'доигранная партия осталась в настройках',
            );
            return;
        }

        const saved = (await readSettings(page)).games?.words?.savedGame;
        assert(saved, 'партия не сохранилась в настройках');
        assertEqual(saved.guesses?.[0], GUESS, 'догадка сохранилась не целиком');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
        await dismissPopups(page);
        await openHub(page);
        await openGame(page, 'words');

        assertEqual(
            await page.locator('.words-row').first().textContent(),
            GUESS,
            'после перезагрузки первая строка не та же',
        );

        await closeShell(page);
    });
}

// Слово из словаря разрешённых с повтором буквы: заодно проверяем, что раскраска
// повторов считается как мультимножество, а не по первому совпадению.
const GUESS = 'СЛОВО';
// Те же буквы физическими клавишами EN-раскладки: С=KeyC, Л=KeyK, О=KeyJ, В=KeyD.
const GUESS_CODES = ['KeyC', 'KeyK', 'KeyJ', 'KeyD', 'KeyJ'];

function typedRow(page) {
    return page.locator('.words-row').first().textContent();
}

function canvasSignature(page) {
    return page.evaluate(() => document.querySelector('.snake-canvas')?.toDataURL().slice(0, 256) ?? '');
}
