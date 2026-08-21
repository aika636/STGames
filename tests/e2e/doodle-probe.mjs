// Точечная проверка подозрений по «Дудл Джампу» в живой таверне: каждый пункт —
// отдельный сценарий, который либо подтверждает баг, либо снимает подозрение.
//
// Файл временный, в репозитории не остаётся.
//
//   node tests/e2e/doodle-probe.mjs [--headed]

import { dismissPopups, openTavern, flushSettings, readSettings, resetSettings, startTavern } from './_st.mjs';

const HEADED = process.argv.includes('--headed');
const results = [];

const fmt = (v) => (v === null || v === undefined ? '?' : `${v.toFixed(0)} wu/с`);

function verdict(name, ok, note) {
    results.push({ name, ok, note });
    console.log(`${ok ? 'ПОДТВЕРДИЛОСЬ' : 'не подтвердилось'} — ${name}\n    ${note}`);
}

let browser = null;
let tavern = null;

async function main() {
    tavern = await startTavern({ port: Number(process.env.STGAMES_E2E_PORT || 8127) });
    const playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: !HEADED });
    try {
        await probeStuckPointer();
        await probeEnterSwallowed();
        await probeRecordOnClose();
        await probeShopCanvas();
    } finally {
        console.log('\n--- итог');
        for (const r of results) console.log(`${r.ok ? '[баг] ' : '[ок]  '} ${r.name}`);
        await browser.close().catch(() => {});
        tavern.stop();
    }
}

async function session() {
    const s = await openTavern(browser, tavern.url, { viewport: { width: 1280, height: 900 }, hasTouch: true });
    // Тот же приём, что в doodle-sweep.mjs: публикуем состояние движка, не трогая исходники.
    await s.page.route('**/games/doodlejump/index.js*', async (route) => {
        const res = await route.fetch();
        const body = (await res.text()).split('view.draw(state);').join('window.__stgDJ = state; view.draw(state);');
        await route.fulfill({ status: res.status(), headers: { ...res.headers(), 'content-type': 'text/javascript; charset=utf-8' }, body });
    });
    await s.page.addInitScript(() => {
        setInterval(() => {
            for (const dlg of document.querySelectorAll('dialog.popup[open]')) {
                if (dlg.querySelector('.stg-root')) continue;
                try { dlg.close(); } catch { /* уже закрыт */ }
                dlg.remove();
            }
        }, 500);
    });
    // Перехват и init-скрипт вешаются уже после первой загрузки — перезагружаем, иначе
    // модуль игры приедет неинструментированным и window.__stgDJ не появится.
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await s.page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
    await dismissPopups(s.page);
    return s;
}

async function openGame(page) {
    await dismissPopups(page);
    await page.click('#extensionsMenuButton');
    await page.click('#stgames_wand_button');
    await page.waitForSelector('.stg-root .stg-hub');
    await page.click('.stg-tile[data-game-id="doodlejump"]');
    await page.waitForSelector('.doodlejump-canvas');
    await page.waitForTimeout(400);
}

// 1. Указатель отпущен ЗА пределами канваса. Две подпробы: с рабочим
//    setPointerCapture (штатный браузер) и с падающим (там, где его нет, — код ловит
//    ошибку и идёт дальше без страховки).
async function probeStuckPointer() {
    for (const breakCapture of [false, true]) {
        const s = await session();
        const { page } = s;
        try {
            if (breakCapture) {
                await page.addInitScript(() => {
                    Element.prototype.setPointerCapture = function () { throw new Error('нет захвата'); };
                });
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
            }
            await openGame(page);
            const box = await page.locator('.doodlejump-canvas').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 5 });
            await page.mouse.move(box.x + box.width + 240, box.y + box.height / 2, { steps: 5 });
            await page.mouse.up();
            await page.waitForTimeout(400);

            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(700);
            const vx = await page.evaluate(() => window.__stgDJ?.player?.vx ?? null);
            await page.waitForTimeout(3000);
            const vxLate = await page.evaluate(() => window.__stgDJ?.player?.vx ?? null);
            await page.keyboard.up('ArrowLeft');

            // Лечится ли это само: новый тап по полю и отпускание уже внутри канваса.
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.up();
            await page.waitForTimeout(300);
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(700);
            const vxAfterTap = await page.evaluate(() => window.__stgDJ?.player?.vx ?? null);
            await page.keyboard.up('ArrowLeft');

            verdict(
                `палец отпущен за краем канваса (${breakCapture ? 'без setPointerCapture' : 'с захватом указателя'})`,
                vx !== null && vx > -100,
                `зажата «влево»: через 0,7 с vx = ${fmt(vx)}, через 3,7 с vx = ${fmt(vxLate)}`
                + ` (при работающей клавиатуре ≈ −420); после нового тапа по полю vx = ${fmt(vxAfterTap)}`,
            );
        } finally {
            await s.context.close().catch(() => {});
        }
    }
}

// 2. Enter во время живой партии: доходит ли он до таверны.
async function probeEnterSwallowed() {
    const s = await session();
    const { page } = s;
    try {
        await openGame(page);
        await page.evaluate(() => {
            window.__probeEnter = { bubble: 0, capture: 0 };
            document.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__probeEnter.bubble++; }, false);
            window.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__probeEnter.capture++; }, false);
        });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        const seen = await page.evaluate(() => window.__probeEnter);
        const alive = await page.evaluate(() => window.__stgDJ?.alive);
        verdict(
            'Enter во время живой партии гасится и до таверны не доходит',
            seen.bubble === 0,
            `партия жива=${alive}; слушателей на всплытии сработало: document ${seen.bubble}, window ${seen.capture}`,
        );
    } finally {
        await s.context.close().catch(() => {});
    }
}

// 3. Закрытие окна посреди заезда: монеты сохраняются, а рекорд?
async function probeRecordOnClose() {
    const s = await session();
    const { page } = s;
    try {
        // Иначе рекорд от прошлых прогонов в том же data-root перебьёт результат заезда,
        // и проверка ничего не докажет.
        await resetSettings(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
        await dismissPopups(page);
        await openGame(page);
        // Играем автопилотом до заметной высоты.
        await page.evaluate(BOT);
        await page.waitForFunction(() => (window.__stgDJ?.score ?? 0) > 1200, null, { timeout: 90_000 });
        const live = await page.evaluate(() => ({ score: window.__stgDJ.score, coins: window.__stgDJ.coins }));
        await page.evaluate(() => window.__stgBotStop?.());
        // Закрываем окно посреди заезда.
        await page.keyboard.press('Escape');
        await page.waitForSelector('.stg-root', { state: 'detached', timeout: 10_000 });
        await flushSettings(page);
        const saved = (await readSettings(page))?.games?.doodlejump ?? {};
        const best = saved.stats?.bestScore ?? 0;
        const coins = saved.wallet?.coins ?? 0;
        verdict(
            'брошенный посреди заезда результат теряет рекорд',
            best < live.score,
            `настройки перед заездом обнулены; в заезде было ${live.score} высоты и ${live.coins} монет; `
            + `сохранено: рекорд ${best}, монет ${coins}`,
        );
    } finally {
        await s.context.close().catch(() => {});
    }
}

// 4. Витрина скрывает канвас — пересобирается ли буфер в фолбэк 320×512.
async function probeShopCanvas() {
    const s = await session();
    const { page } = s;
    try {
        await openGame(page);
        const before = await page.evaluate(() => {
            const c = document.querySelector('.doodlejump-canvas');
            return { w: c.width, h: c.height, css: c.clientWidth };
        });
        await page.locator('.doodlejump-shop-open').first().click();
        await page.waitForTimeout(600);
        const during = await page.evaluate(() => {
            const c = document.querySelector('.doodlejump-canvas');
            return { w: c.width, h: c.height, css: c.clientWidth };
        });
        await page.locator('.doodlejump-shop-close').first().click();
        await page.waitForTimeout(600);
        const after = await page.evaluate(() => {
            const c = document.querySelector('.doodlejump-canvas');
            return { w: c.width, h: c.height, css: c.clientWidth };
        });
        verdict(
            'открытие витрины пересобирает буфер канваса в фолбэк',
            during.w !== before.w,
            `до ${before.w}×${before.h} (css ${before.css}), при витрине ${during.w}×${during.h} (css ${during.css}), после ${after.w}×${after.h}`,
        );
    } finally {
        await s.context.close().catch(() => {});
    }
}

const BOT = `
(() => {
    const W = 400, PW = 40, PH = 40, G = 2200;
    let held = 0;
    const key = (dir, type) => {
        const name = dir < 0 ? 'ArrowLeft' : 'ArrowRight';
        document.dispatchEvent(new KeyboardEvent(type, { key: name, code: name, bubbles: true, cancelable: true }));
    };
    const press = (dir) => { if (dir === held) return; if (held) key(held, 'keyup'); held = dir; if (held) key(held, 'keydown'); };
    window.__stgBotStop = () => { press(0); clearInterval(window.__stgBotTimer); };
    window.__stgBotTimer = setInterval(() => {
        const s = window.__stgDJ;
        if (!s || !s.alive) { press(0); return; }
        const p = s.player;
        const cx = p.x + PW / 2;
        if (p.boost) { press(0); return; }
        const feet = p.y + PH;
        const apex = p.vy < 0 ? feet - (p.vy * p.vy) / (2 * G) : feet;
        const floor = p.vy > 0 ? feet : -Infinity;
        const cands = s.platforms.filter((pl) => !pl.broken && pl.y > apex + 6 && pl.y > floor - 4);
        if (!cands.length) { press(0); return; }
        let top = Infinity;
        for (const pl of cands) if (pl.y < top) top = pl.y;
        const near = cands.filter((pl) => pl.y < top + 260);
        const dxOf = (pl) => { let dx = (pl.x + pl.w / 2) - cx; if (dx > W / 2) dx -= W; if (dx < -W / 2) dx += W; return dx; };
        const timeTo = (pl) => { const dy = pl.y - feet; const d = p.vy * p.vy + 2 * G * dy; return d < 0 ? null : (-p.vy + Math.sqrt(d)) / G; };
        const rising = p.vy < 0;
        let best = null, bc = Infinity;
        for (const pl of near) {
            const dx = dxOf(pl);
            const t = timeTo(pl);
            const reach = t === null ? 0 : 420 * t + 24;
            let c = rising ? (pl.y - top) * 1.6 + Math.abs(dx) * 0.5 : (pl.y - top) * 0.5 + Math.abs(dx) * 1.0;
            if (Math.abs(dx) > reach) c += 500 + (Math.abs(dx) - reach) * 2;
            if (pl.kind === 'crumbling') c += 200;
            if (pl.kind === 'spring') c -= 120;
            if (c < bc) { bc = c; best = pl; }
        }
        if (!best) { press(0); return; }
        const aim = dxOf(best) - p.vx * 0.09;
        press(Math.abs(aim) < 5 ? 0 : (aim > 0 ? 1 : -1));
    }, 25);
})();
`;

main().catch((err) => { console.error(err); process.exitCode = 1; });
