// Оболочка в живой таверне: расширение загрузилось, хаб открывается из wand-меню,
// окно закрывается, настройки переживают перезагрузку страницы.

import { assert, assertEqual } from '../_harness.mjs';
import { closeShell, e2eTest, flushSettings, openGame, openHub, readSettings, resetSettings, stgamesErrors } from './_st.mjs';

export default async function run(env) {
    const { page } = env;

    await e2eTest(env, 'расширение загрузилось без ошибок в консоли', async () => {
        const button = await page.$('#stgames_wand_button');
        assert(button, 'кнопки «STGames» нет в wand-меню');
        const errors = stgamesErrors(env);
        assertEqual(errors.length, 0, `ошибки STGames в консоли: ${errors.join(' | ')}`);
    });

    await e2eTest(env, 'хаб открывается из wand-меню и показывает все игры', async () => {
        await openHub(page);
        const ids = await page.$$eval('.stg-tile', (tiles) => tiles.map((t) => t.dataset.gameId));
        for (const id of ['sudoku', 'snake', 'reversi', 'words', 'minesweeper', 'nonogram', 'crossword', 'balda']) {
            assert(ids.includes(id), `в хабе нет игры ${id}, только: ${ids.join(', ')}`);
        }
        await closeShell(page);
    });

    await e2eTest(env, 'последняя игра запоминается и переживает перезагрузку', async () => {
        await resetSettings(page);
        await openHub(page);
        await openGame(page, 'snake');
        await closeShell(page);
        await flushSettings(page);

        assertEqual((await readSettings(page)).lastGame, 'snake', 'lastGame не записался');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#stgames_wand_button', { state: 'attached' });
        assertEqual((await readSettings(page)).lastGame, 'snake', 'lastGame не пережил перезагрузку');
    });
}
