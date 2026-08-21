// Второй заход точечных проверок «Дудл Джампа»: витрина (баланс и прокрутка) и экран
// проигрыша во всех режимах палитры. Файл временный, в репозитории не остаётся.
//
//   node tests/e2e/doodle-probe2.mjs [--headed]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS, dismissPopups, openTavern, resetSettings, startTavern } from './_st.mjs';

const HEADED = process.argv.includes('--headed');
const OUT = join(ARTIFACTS, 'doodle-over');

let browser = null;
let tavern = null;

const ST_LIGHT = {
    '--SmartThemeBodyColor': 'rgba(28, 28, 32, 1)',
    '--SmartThemeBorderColor': 'rgba(0, 0, 0, 0.25)',
    '--SmartThemeBlurTintColor': 'rgba(246, 243, 236, 0.92)',
    '--SmartThemeChatTintColor': 'rgba(251, 249, 245, 0.92)',
    '--SmartThemeQuoteColor': 'rgba(176, 118, 24, 1)',
};

async function main() {
    tavern = await startTavern({ port: Number(process.env.STGAMES_E2E_PORT || 8127) });
    const playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: !HEADED });
    try {
        await probeShop();
        await probeOver();
    } finally {
        await browser.close().catch(() => {});
        tavern.stop();
    }
}

async function session(appearance = 'auto', stLight = false) {
    const s = await openTavern(browser, tavern.url, { viewport: { width: 1280, height: 900 } });
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
    await resetSettings(s.page);
    await s.page.evaluate((mode) => {
        const root = SillyTavern.getContext().extensionSettings;
        root.STGames = { version: 1, lastGame: null, appearance: mode, games: {} };
        SillyTavern.getContext().saveSettingsDebounced();
    }, appearance);
    await s.page.waitForTimeout(1500);
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await s.page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
    await dismissPopups(s.page);
    if (stLight) {
        await s.page.evaluate((vars) => {
            for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
            const bg = document.querySelector('#bg1');
            if (bg) { bg.style.backgroundImage = 'none'; bg.style.backgroundColor = '#efeae0'; }
        }, ST_LIGHT);
    }
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

// 1. Витрина: совпадает ли баланс с монетами заезда и прокручивается ли список.
async function probeShop() {
    const s = await session('dark');
    const { page } = s;
    try {
        await openGame(page);
        await page.evaluate(BOT);
        await page.waitForFunction(() => (window.__stgDJ?.coins ?? 0) >= 2, null, { timeout: 90_000 }).catch(() => {});
        const live = await page.evaluate(() => ({ coins: window.__stgDJ.coins, score: window.__stgDJ.score }));
        await page.evaluate(() => window.__stgBotStop?.());
        await page.locator('.doodlejump-shop-open').first().click();
        await page.waitForTimeout(600);

        const shown = await page.evaluate(() => ({
            header: document.querySelector('.doodlejump-header')?.textContent?.trim() ?? '',
            balance: document.querySelector('.doodlejump-shop-balance')?.textContent?.trim() ?? '',
        }));
        console.log(`\n[витрина, баланс] в заезде собрано монет: ${live.coins}`);
        console.log(`  шапка:  ${shown.header}`);
        console.log(`  баланс: ${shown.balance}`);

        const scroll = await page.evaluate(() => {
            const out = {};
            for (const sel of ['.doodlejump-shop', '.doodlejump-shop-content', '.doodlejump-shop-items']) {
                const el = document.querySelector(sel);
                if (!el) { out[sel] = null; continue; }
                const cs = getComputedStyle(el);
                out[sel] = {
                    scrollH: el.scrollHeight,
                    clientH: el.clientHeight,
                    overflowY: cs.overflowY,
                    canScroll: el.scrollHeight > el.clientHeight + 2,
                };
            }
            const items = [...document.querySelectorAll('.doodlejump-shop-item')];
            out.items = items.length;
            const box = document.querySelector('.doodlejump-shop-content')?.getBoundingClientRect();
            const lastRect = items.at(-1)?.getBoundingClientRect();
            out.lastVisible = box && lastRect ? lastRect.bottom <= box.bottom + 1 : null;
            const close = document.querySelector('.doodlejump-shop-close')?.getBoundingClientRect();
            out.closeVisible = close && box ? close.bottom <= window.innerHeight + 1 : null;
            return out;
        });
        console.log('  прокрутка:', JSON.stringify(scroll, null, 2).replace(/\n/g, '\n  '));

        // Пробуем реально прокрутить каждый кандидат и смотрим, сдвинулось ли что-нибудь.
        const moved = await page.evaluate(() => {
            const res = {};
            for (const sel of ['.doodlejump-shop', '.doodlejump-shop-content', '.doodlejump-shop-items']) {
                const el = document.querySelector(sel);
                if (!el) continue;
                el.scrollTop = 9999;
                res[sel] = el.scrollTop;
            }
            return res;
        });
        console.log('  после scrollTop=9999:', JSON.stringify(moved));
    } finally {
        await s.context.close().catch(() => {});
    }
}

// 2. Экран проигрыша в каждой палитре: появляется ли он и какова его фактическая подложка.
async function probeOver() {
    mkdirSync(OUT, { recursive: true });
    const cases = [
        { id: 'auto-on-dark', appearance: 'auto', light: false },
        { id: 'auto-on-light', appearance: 'auto', light: true },
        { id: 'light', appearance: 'light', light: false },
        { id: 'dark', appearance: 'dark', light: true },
        { id: 'theme-on-dark', appearance: 'theme', light: false },
        { id: 'theme-on-light', appearance: 'theme', light: true },
    ];
    console.log('\n[экран проигрыша]');
    for (const kase of cases) {
        const s = await session(kase.appearance, kase.light);
        const { page } = s;
        try {
            await openGame(page);
            // Без ввода фигурка бесконечно скачет на стартовой платформе, поэтому роняем
            // её осознанно: уводим в сторону от ближайшей платформы под ногами.
            await page.evaluate(SUICIDE);
            await page.waitForFunction(() => window.__stgDJ && !window.__stgDJ.alive, null, { timeout: 60_000 });
            await page.waitForTimeout(700);
            await page.screenshot({ path: join(OUT, `${kase.id}.png`) });
            const m = await page.evaluate(() => {
                const over = document.querySelector('.doodlejump-over');
                if (!over) return { error: 'оверлея нет в разметке' };
                const cs = getComputedStyle(over);
                const canvas = document.querySelector('.doodlejump-canvas');
                return {
                    display: cs.display,
                    background: cs.backgroundColor,
                    text: over.textContent.trim().replace(/\s+/g, ' ').slice(0, 80),
                    canvasHidden: canvas ? getComputedStyle(canvas.parentElement).display : '(нет)',
                };
            });
            // Chrome отдаёт и rgba(...), и color(srgb r g b / a) — берём число после «/».
            const alpha = (() => {
                const css = String(m.background || '');
                const slash = css.match(/\/\s*([0-9.]+)\s*\)/);
                if (slash) return Number(slash[1]);
                const rgba = css.match(/rgba?\(([^)]+)\)/);
                if (!rgba) return null;
                const parts = rgba[1].split(/[,\s]+/).filter(Boolean).map(Number);
                return parts.length > 3 ? parts[3] : 1;
            })();
            console.log(`  ${kase.id.padEnd(15)} display=${m.display} фон=${m.background} альфа=${alpha ?? '?'} «${m.text}»`);
        } catch (err) {
            console.log(`  ${kase.id.padEnd(15)} СБОЙ: ${err.message.split('\n')[0]}`);
        } finally {
            await s.context.close().catch(() => {});
        }
    }
    console.log(`  снимки: ${OUT}`);
}

const SUICIDE = `
(() => {
    const PW = 40, PH = 40, W = 400;
    let held = 0;
    const key = (dir, type) => {
        const name = dir < 0 ? 'ArrowLeft' : 'ArrowRight';
        document.dispatchEvent(new KeyboardEvent(type, { key: name, code: name, bubbles: true, cancelable: true }));
    };
    const press = (dir) => { if (dir === held) return; if (held) key(held, 'keyup'); held = dir; if (held) key(held, 'keydown'); };
    const timer = setInterval(() => {
        const s = window.__stgDJ;
        if (!s || !s.alive) { press(0); clearInterval(timer); return; }
        const p = s.player;
        const cx = p.x + PW / 2;
        const feet = p.y + PH;
        // Ближайшая платформа под ногами — и уходим от неё, чтобы гарантированно мимо.
        let near = null;
        for (const pl of s.platforms) {
            if (pl.broken || pl.y < feet) continue;
            if (!near || pl.y < near.y) near = pl;
        }
        if (!near) { press(1); return; }
        let dx = (near.x + near.w / 2) - cx;
        if (dx > W / 2) dx -= W;
        if (dx < -W / 2) dx += W;
        press(dx > 0 ? -1 : 1);
    }, 25);
})();
`;

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
