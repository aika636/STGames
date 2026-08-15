// Разовая «витрина»: поднимает таверну, открывает нонограмму 15×15, закрашивает всю
// картинку кроме одной клетки — и оставляет окно открытым, пока процесс не убьют.
// Файл временный, в репозитории не остаётся.

import { dismissPopups, openTavern, startTavern } from './_st.mjs';

const playwright = await import('playwright');

const tavern = await startTavern({ port: Number(process.env.STGAMES_E2E_PORT || 8124) });
console.log(`таверна: ${tavern.url}`);

const browser = await playwright.chromium.launch({ headless: false });
const { page } = await openTavern(browser, tavern.url);

await page.evaluate(() => {
    const ctx = SillyTavern.getContext();
    delete ctx.extensionSettings.STGames;
    ctx.saveSettingsDebounced();
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
await dismissPopups(page);

await page.click('#extensionsMenuButton');
await page.click('#stgames_wand_button');
await page.waitForSelector('.stg-root .stg-hub');
await page.click('.stg-tile[data-game-id="nonogram"]');
await page.waitForSelector('.nonogram-board');

await page.selectOption('.nonogram-select', 'hard');
await page.waitForFunction(() => document.querySelectorAll('.nonogram-cell').length === 225);

// Картинка наружу попадает только через сохранение, а оно случается с первой отметки.
await page.click('.nonogram-cell[data-idx="0"]');
const saved = await page.evaluate(async () => {
    const ctx = SillyTavern.getContext();
    ctx.saveSettingsDebounced();
    return ctx.extensionSettings.STGames.games.nonogram.savedGame;
});
const solution = saved.solution;
console.log(`рисунок: ${saved.picture ? saved.picture.title : '(случайный)'}`);

if (solution[0] === '0') await page.click('.nonogram-cell[data-idx="0"]');

const filled = [];
for (let i = 0; i < solution.length; i++) {
    if (solution[i] === '1') filled.push(i);
}
const leave = filled.pop();
for (const idx of filled) {
    if (idx === 0 && solution[0] === '1') continue;
    await page.click(`.nonogram-cell[data-idx="${idx}"]`);
}
console.log(`закрашено ${filled.length} клеток, пустой оставлена клетка ${leave}`);
console.log('окно открыто — снимайте скриншот. Процесс держит таверну и браузер, пока его не остановят.');

await new Promise(() => {});
