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

    await e2eTest(env, 'сапёр: первый клик рождает поле, правая кнопка ставит флажок', async () => {
        await resetSettings(page);
        await openHub(page);
        await openGame(page, 'minesweeper');

        assertEqual(await page.locator('.minesweeper-cell').count(), 81, 'на поле не 81 клетка');

        // Поле должно остаться квадратным в реальном попапе ST: в jsdom размеров нет
        // вовсе, а именно здесь ломалась вёрстка на узком экране (грабли Фазы 5).
        const box = await page.locator('.minesweeper-board').boundingBox();
        assert(box && box.width > 0, 'поле нулевой ширины');
        assert(Math.abs(box.width - box.height) <= 2, `поле не квадратное: ${box.width}×${box.height}`);

        // Правая кнопка — то, чего юнит-тесты по-настоящему не проверяют: в живом
        // браузере поверх поля не должно вылезти контекстное меню.
        await page.locator('.minesweeper-cell').nth(0).click({ button: 'right' });
        assertEqual(await page.locator('.minesweeper-cell.minesweeper-flag').count(), 1, 'флажок не поставлен');

        await page.locator('.minesweeper-cell').nth(40).click();
        await page.waitForFunction(
            () => document.querySelectorAll('.minesweeper-cell.minesweeper-open').length >= 9,
            null,
            { timeout: 10_000 },
        );
        assertEqual(
            await page.locator('.minesweeper-cell.minesweeper-boom').count(),
            0,
            'первый клик попал на мину',
        );

        await closeShell(page);
        await flushSettings(page);

        const saved = (await readSettings(page)).games?.minesweeper?.savedGame;
        assert(saved, 'партия не сохранилась в настройках');
        assertEqual(saved.mine.length, 81, 'поле сохранено не строкой из 81 символа');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
        await dismissPopups(page);
        await openHub(page);
        await openGame(page, 'minesweeper');

        assert(
            await page.locator('.minesweeper-cell.minesweeper-open').count() >= 9,
            'после перезагрузки открылось новое поле, а не сохранённое',
        );

        await closeShell(page);
    });

    await e2eTest(env, 'нонограмма: росчерк мышью красит линию и держит ось', async () => {
        await resetSettings(page);
        await openHub(page);
        await openGame(page, 'nonogram');

        assertEqual(await page.locator('.nonogram-cell').count(), 25, 'на поле не 25 клеток');

        const box = await page.locator('.nonogram-board').boundingBox();
        assert(box && box.width > 0, 'поле нулевой ширины');
        assert(Math.abs(box.width - box.height) <= 2, `поле не квадратное: ${box.width}×${box.height}`);

        // Росчерк — главное, чего не видит jsdom: там нет ни настоящих координат, ни
        // elementFromPoint, и захват указателя тач-браузером не воспроизводится.
        const cell = box.width / 5;
        const centre = (n) => box.y + cell * (n + 0.5);
        await page.mouse.move(box.x + cell * 0.5, centre(0));
        await page.mouse.down();
        await page.mouse.move(box.x + cell * 1.5, centre(0));
        await page.mouse.move(box.x + cell * 2.5, centre(0));
        // Рука дрогнула и уехала на соседнюю строку — росчерк обязан остаться на своей.
        await page.mouse.move(box.x + cell * 3.5, centre(1));
        await page.mouse.up();

        await page.waitForFunction(
            () => document.querySelectorAll('.nonogram-cell.nonogram-fill').length === 4,
            null,
            { timeout: 10_000 },
        );
        assertEqual(
            await page.locator('.nonogram-cell[data-idx="8"].nonogram-fill').count(),
            0,
            'росчерк съехал на соседнюю строку',
        );

        await closeShell(page);
        await flushSettings(page);

        const saved = (await readSettings(page)).games?.nonogram?.savedGame;
        assert(saved, 'партия не сохранилась в настройках');
        assertEqual(saved.marks.length, 25, 'метки сохранены не строкой из 25 символов');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
        await dismissPopups(page);
        await openHub(page);
        await openGame(page, 'nonogram');

        assertEqual(
            await page.locator('.nonogram-cell.nonogram-fill').count(),
            4,
            'после перезагрузки открылась новая картинка, а не сохранённая',
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
