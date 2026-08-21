// Прогон «Дудл Джампа» по темам и экранам с настоящей игрой до 5000 очков.
//
// Файл временный (как live-view.mjs и theme-sweep.mjs), в репозитории не остаётся.
//
//   node tests/e2e/doodle-sweep.mjs [--headed] [--case=<id>] [--vp=desktop|tablet|mobile]
//                                   [--goal=5000] [--skip-play]
//
// Что делает на каждой паре «экран × режим оформления»:
//   1. открывает игру, снимает старт;
//   2. включает автопилот (читает состояние движка и жмёт стрелки), играет до --goal;
//   3. снимает кадры на промежуточных отметках счёта;
//   4. роняет фигурку, снимает экран проигрыша;
//   5. открывает витрину скинов, снимает её и прокручивает;
//   6. снимает паузу и панель настроек игры;
//   7. на каждом шаге снимает мерку: за экран, наложения, мелкие цели, контраст,
//      прозрачность/непрорисовку канваса и цвета палитры канваса.
//
// Доступ к состоянию движка: ответ на index.js игры перехватывается и в него
// дописывается публикация state в window.__stgDJ. Исходники при этом не трогаются.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACTS, dismissPopups, flushSettings, openTavern, startTavern } from './_st.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const HEADED = argv.includes('--headed');
const SKIP_PLAY = argv.includes('--skip-play');
const ONLY_CASE = flag('case', null);
const ONLY_VP = flag('vp', null);
const GOAL = Number(flag('goal', 5000));
// Настройки игры на прогон: по умолчанию заводские. Бустеры выключают, чтобы прогон
// шёл на настоящем платформинге, а не на полёте.
const BOOSTERS = flag('boosters', 'on') !== 'off';
const DIFFICULTY = flag('difficulty', null);
const TAG = flag('tag', '');

const OUT = join(ARTIFACTS, TAG ? `doodle-${TAG}` : 'doodle');

const VIEWPORTS = [
    { id: 'desktop', width: 1280, height: 900, touch: false, dpr: 1 },
    { id: 'tablet', width: 834, height: 1112, touch: true, dpr: 2 },
    { id: 'mobile', width: 390, height: 844, touch: true, dpr: 3 },
    // Телефон в альбоме: у «Слов» и «Балды» на этот случай есть свои правила, у
    // «Дудл Джампа» — нет, и высоты сцены тут заведомо мало.
    { id: 'mobile-land', width: 844, height: 390, touch: true, dpr: 3 },
];

const CASES = [
    { id: 'auto-on-dark', appearance: 'auto', st: 'dark', expect: 'dark' },
    { id: 'auto-on-light', appearance: 'auto', st: 'light', expect: 'light' },
    { id: 'light-on-dark', appearance: 'light', st: 'dark', expect: 'light' },
    { id: 'dark-on-light', appearance: 'dark', st: 'light', expect: 'dark' },
    { id: 'theme-on-dark', appearance: 'theme', st: 'dark', expect: 'theme' },
    { id: 'theme-on-light', appearance: 'theme', st: 'light', expect: 'theme' },
];

const ST_LIGHT = {
    '--SmartThemeBodyColor': 'rgba(28, 28, 32, 1)',
    '--SmartThemeEmColor': 'rgba(96, 96, 104, 1)',
    '--SmartThemeQuoteColor': 'rgba(176, 118, 24, 1)',
    '--SmartThemeBorderColor': 'rgba(0, 0, 0, 0.25)',
    '--SmartThemeBlurTintColor': 'rgba(246, 243, 236, 0.92)',
    '--SmartThemeChatTintColor': 'rgba(251, 249, 245, 0.92)',
    '--SmartThemeUserMesBlurTintColor': 'rgba(240, 236, 228, 0.92)',
    '--SmartThemeBotMesBlurTintColor': 'rgba(251, 249, 245, 0.92)',
    '--SmartThemeShadowColor': 'rgba(0, 0, 0, 0.2)',
};

const findings = [];
const runs = [];
const widths = [];

function finding(where, kind, text) {
    findings.push({ ...where, kind, text });
    console.log(`  ! [${kind}] ${where.vp}/${where.case}/${where.stage}: ${text}`);
}

// --- Запуск

let browser = null;
let tavern = null;

async function main() {
    tavern = await startTavern({ port: Number(process.env.STGAMES_E2E_PORT || 8126) });
    console.log(`таверна: ${tavern.url}`);
    const playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: !HEADED });

    try {
        for (const vp of VIEWPORTS) {
            if (ONLY_VP && vp.id !== ONLY_VP) continue;
            for (const kase of CASES) {
                if (ONLY_CASE && kase.id !== ONLY_CASE) continue;
                await runCase(vp, kase);
            }
        }
    } finally {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, 'findings.json'), JSON.stringify({ goal: GOAL, runs, findings, widths }, null, 2), 'utf8');
        console.log(`\nзамечаний: ${findings.length} → ${join(OUT, 'findings.json')}`);
        await browser.close().catch(() => {});
        tavern.stop();
    }
}

async function runCase(vp, kase) {
    console.log(`\n=== ${vp.id} · ${kase.id}`);
    const session = await openTavern(browser, tavern.url, {
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        isMobile: vp.touch,
        deviceScaleFactor: vp.dpr,
    });
    const { page } = session;
    const where0 = { vp: vp.id, case: kase.id };

    try {
        await guardPopups(page);
        await instrument(page);
        await prepare(page, kase);
        // Без записи на диск reload() поднимет таверну со старыми настройками, и режим
        // палитры окажется не тот, ради которого прогон и затевался.
        await flushSettings(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#stgames_wand_button', { state: 'attached', timeout: 90_000 });
        await dismissPopups(page);
        await applyStTheme(page, kase);

        await openHub(page);
        await capture(page, { ...where0, stage: 'hub' }, kase);
        await page.click('.stg-tile[data-game-id="doodlejump"]');
        await page.waitForSelector('.doodlejump-canvas', { timeout: 30_000 });
        await page.waitForTimeout(500);

        const hooked = await page.evaluate(() => Boolean(window.__stgDJ));
        if (!hooked) finding({ ...where0, stage: 'старт' }, 'сбой', 'состояние движка не опубликовано — автопилот невозможен');

        await capture(page, { ...where0, stage: '01-start' }, kase);

        let result = { best: 0, deaths: 0 };
        if (!SKIP_PLAY && hooked) {
            result = await play(page, { ...where0 }, kase);
        }
        runs.push({ vp: vp.id, case: kase.id, ...result });

        // Пауза (клавиша P) — оверлей паузы поверх поля
        await page.keyboard.press('p').catch(() => {});
        await page.waitForTimeout(400);
        await capture(page, { ...where0, stage: '04a-pause' }, kase);
        await page.keyboard.press('p').catch(() => {});
        await page.waitForTimeout(300);

        // Экран проигрыша
        if (hooked) {
            await die(page);
            await page.waitForTimeout(700);
            await capture(page, { ...where0, stage: '05-over' }, kase);
        }

        // Витрина скинов
        const shopBtn = page.locator('.doodlejump-over-shop, .doodlejump-shop-open').first();
        if (await shopBtn.count()) {
            await shopBtn.click().catch(() => {});
            await page.waitForTimeout(600);
            if (await page.locator('.doodlejump-shop').count()) {
                await capture(page, { ...where0, stage: '06-shop' }, kase);
                await page.evaluate(() => {
                    const box = document.querySelector('.doodlejump-shop-items');
                    if (box) box.scrollTop = box.scrollHeight;
                });
                await page.waitForTimeout(400);
                await capture(page, { ...where0, stage: '07-shop-bottom' }, kase);
                await page.locator('.doodlejump-shop-close').first().click().catch(() => {});
                await page.waitForTimeout(400);
            } else {
                finding({ ...where0, stage: 'витрина' }, 'сбой', 'кнопка витрины есть, а витрина не открылась');
            }
        } else {
            finding({ ...where0, stage: 'витрина' }, 'сбой', 'кнопки витрины нет ни на экране проигрыша, ни в шапке');
        }

        // Возврат в хаб кнопкой «назад» — тоже экран расширения
        const back = page.locator('.stg-back').first();
        if (await back.count()) {
            await back.click().catch(() => {});
            await page.waitForTimeout(500);
            await capture(page, { ...where0, stage: '08-hub-back' }, kase);
        }

        // Панель расширения в ящике Extensions: настройки игры и статистика
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);
        await shotDrawer(page, { ...where0, stage: '09-drawer' });

        const noise = session.errors.filter((line) => /STGames|stgames|doodle/i.test(line));
        for (const line of noise.slice(0, 10)) {
            finding({ ...where0, stage: 'консоль' }, 'консоль', line.slice(0, 300));
        }
    } catch (err) {
        finding({ ...where0, stage: 'прогон' }, 'сбой', err.message);
        await capture(page, { ...where0, stage: 'fail' }, kase).catch(() => {});
    } finally {
        await session.context.close().catch(() => {});
    }
}

// --- Подготовка

// Публикация состояния движка: перехватываем ответ с index.js игры и дописываем
// присвоение в window.__stgDJ рядом с каждой отрисовкой кадра.
// Чужие расширения таверны показывают свои попапы прямо посреди прогона и перехватывают
// клики. Гасим их сами: закрываем каждый dialog.popup, внутри которого нет .stg-root,
// — окно STGames при этом не трогаем (Escape закрыл бы и его).
async function guardPopups(page) {
    await page.addInitScript(() => {
        const kill = () => {
            for (const dlg of document.querySelectorAll('dialog.popup[open]')) {
                if (dlg.querySelector('.stg-root')) continue;
                try { dlg.close(); } catch { /* уже закрыт */ }
                dlg.remove();
            }
        };
        setInterval(kill, 500);
    });
}

async function instrument(page) {
    await page.route('**/games/doodlejump/index.js*', async (route) => {
        const res = await route.fetch();
        let body = await res.text();
        const before = body;
        body = body.split('view.draw(state);').join('window.__stgDJ = state; view.draw(state);');
        if (body === before) console.log('  ! не нашли view.draw(state) в index.js игры');
        await route.fulfill({
            status: res.status(),
            headers: { ...res.headers(), 'content-type': 'text/javascript; charset=utf-8' },
            body,
        });
    });
}

async function prepare(page, kase) {
    const game = { boosters: BOOSTERS };
    if (DIFFICULTY) game.difficulty = DIFFICULTY;
    await page.evaluate(({ mode, game }) => {
        const root = SillyTavern.getContext().extensionSettings;
        delete root.Sudoku;
        root.STGames = { version: 1, lastGame: null, appearance: mode, games: { doodlejump: game } };
    }, { mode: kase.appearance, game });
}

async function applyStTheme(page, kase) {
    if (kase.st !== 'light') return;
    await page.evaluate((vars) => {
        for (const [name, value] of Object.entries(vars)) {
            document.documentElement.style.setProperty(name, value);
        }
        const bg = document.querySelector('#bg1');
        if (bg) {
            bg.style.backgroundImage = 'none';
            bg.style.backgroundColor = '#efeae0';
        }
    }, ST_LIGHT);
}

async function openHub(page) {
    await dismissPopups(page);
    await page.click('#extensionsMenuButton');
    await page.click('#stgames_wand_button');
    await page.waitForSelector('.stg-root .stg-hub');
    await page.waitForTimeout(600);
}

// --- Автопилот

const BOT_RESUME = 'window.__stgBotSuicide = false;';

const BOT = `
(() => {
    if (window.__stgBotTimer) clearInterval(window.__stgBotTimer);
    const W = 400, PW = 40, PH = 40, G = 2200;
    let held = 0;
    const key = (dir, type) => {
        const name = dir < 0 ? 'ArrowLeft' : 'ArrowRight';
        document.dispatchEvent(new KeyboardEvent(type, { key: name, code: name, bubbles: true, cancelable: true }));
    };
    const press = (dir) => {
        if (dir === held) return;
        if (held) key(held, 'keyup');
        held = dir;
        if (held) key(held, 'keydown');
    };
    window.__stgBotStop = () => { press(0); clearInterval(window.__stgBotTimer); window.__stgBotTimer = null; };
    window.__stgBotSuicide = false;
    window.__stgBotTimer = setInterval(() => {
        const s = window.__stgDJ;
        if (!s || !s.alive) { press(0); return; }
        if (window.__stgBotSuicide) { press(0); return; }
        const p = s.player;
        const cx = p.x + PW / 2;
        // Во время бустера рулить незачем — платформы всё равно не ловят.
        if (p.boost) { press(0); return; }
        // Приземляется подошва, а не макушка: всё считаем от p.y + PH. Иначе автопилот
        // целится в платформу на рост фигурки выше достижимой, стабильно промахивается
        // и топчется на месте (проверено прогоном политики прямо на ядре под node).
        const feet = p.y + PH;
        const apex = p.vy < 0 ? feet - (p.vy * p.vy) / (2 * G) : feet;
        const floor = p.vy > 0 ? feet : -Infinity;
        const cands = s.platforms.filter((pl) => !pl.broken && pl.y > apex + 6 && pl.y > floor - 4);
        if (!cands.length) { press(0); return; }
        let top = Infinity;
        for (const pl of cands) if (pl.y < top) top = pl.y;
        const near = cands.filter((pl) => pl.y < top + 260);
        const dxOf = (pl) => {
            let dx = (pl.x + pl.w / 2) - cx;
            if (dx > W / 2) dx -= W;
            if (dx < -W / 2) dx += W;
            return dx;
        };
        // Сколько секунд лететь до платформы и сколько за это время можно пройти вбок:
        // без этого автопилот целится в самую верхнюю платформу, не успевает под неё
        // подойти и проваливается мимо всех.
        const timeTo = (pl) => {
            const dy = pl.y - (p.y + PH);
            const disc = p.vy * p.vy + 2 * G * dy;
            if (disc < 0) return null;
            return (-p.vy + Math.sqrt(disc)) / G;
        };
        const rising = p.vy < 0;
        let best = null, bestCost = Infinity;
        for (const pl of near) {
            const dx = dxOf(pl);
            const t = timeTo(pl);
            const reach = t === null ? 0 : 420 * t + 24;
            // На подъёме высота дороже, на падении дороже дотянуться: упасть мимо всего
            // хуже, чем недобрать этаж.
            let cost = rising
                ? (pl.y - top) * 1.6 + Math.abs(dx) * 0.5
                : (pl.y - top) * 0.5 + Math.abs(dx) * 1.0;
            if (Math.abs(dx) > reach) cost += 500 + (Math.abs(dx) - reach) * 2;
            if (pl.kind === 'crumbling') cost += 200;
            if (pl.kind === 'spring') cost -= 120;
            if (cost < bestCost) { bestCost = cost; best = pl; }
        }
        if (!best) { press(0); return; }
        const dx = dxOf(best);
        // Тормозим заранее: на подлёте гасим скорость, иначе проскакиваем край.
        const brake = p.vx * 0.09;
        const aim = dx - brake;
        press(Math.abs(aim) < 5 ? 0 : (aim > 0 ? 1 : -1));
    }, 25);
})();
`;

async function play(page, where, kase) {
    await page.evaluate(BOT);
    const deadline = Date.now() + 240_000;
    const marks = [Math.round(GOAL * 0.3), Math.round(GOAL * 0.6), GOAL];
    let markIdx = 0;
    let deaths = 0;
    let best = 0;
    let stalledMs = 0;
    let lastBest = -1;
    let restarts = 0;

    for (;;) {
        const snap = await page.evaluate(() => {
            const s = window.__stgDJ;
            return s ? { score: s.score, alive: s.alive, coins: s.coins, landings: s.landings } : null;
        });
        if (!snap) break;
        if (snap.score > best) best = snap.score;

        while (markIdx < marks.length && best >= marks[markIdx]) {
            await capture(page, { ...where, stage: `0${markIdx + 2}-score-${marks[markIdx]}` }, kase);
            markIdx++;
        }
        if (best >= GOAL) break;

        // Автопилот иногда застревает в «качелях» между двумя этажами. Ждать 240 с
        // ради этого незачем — начинаем заезд заново.
        if (best === lastBest) stalledMs += 200; else { stalledMs = 0; lastBest = best; }
        if (stalledMs > 30_000 && snap.alive) {
            restarts++;
            stalledMs = 0;
            if (restarts > 4) {
                finding({ ...where, stage: 'игра' }, 'игра', `автопилот встал: счёт замер на ${best}`);
                break;
            }
            await die(page, false);
            await page.waitForTimeout(400);
            await page.keyboard.press('Enter');
            await page.evaluate(BOT_RESUME);
            await page.waitForTimeout(500);
            continue;
        }

        if (!snap.alive) {
            deaths++;
            if (deaths > 6) {
                finding({ ...where, stage: 'игра' }, 'игра', `автопилот погиб ${deaths} раз, лучший счёт ${best}`);
                break;
            }
            await capture(page, { ...where, stage: `x-death-${deaths}` }, kase);
            await page.keyboard.press('Enter');
            await page.evaluate(BOT_RESUME);
            await page.waitForTimeout(500);
        }
        if (Date.now() > deadline) {
            finding({ ...where, stage: 'игра' }, 'игра', `за 240 с набрано только ${best} очков (цель ${GOAL})`);
            break;
        }
        await page.waitForTimeout(200);
    }

    const tail = await page.evaluate(() => {
        const s = window.__stgDJ;
        return s ? { score: s.score, coins: s.coins, landings: s.landings } : null;
    });
    console.log(`  счёт ${best}, платформ ${tail?.landings ?? '?'}, монет ${tail?.coins ?? '?'}, падений ${deaths}`);
    return { best, deaths, landings: tail?.landings ?? null, coins: tail?.coins ?? null };
}

// stop=false — уронить фигурку, но оставить автопилот включённым (перезапуск заезда).
async function die(page, stop = true) {
    await page.evaluate(() => { window.__stgBotSuicide = true; });
    await page.waitForFunction(() => !window.__stgDJ || !window.__stgDJ.alive, null, { timeout: 30_000 })
        .catch(() => {});
    if (stop) await page.evaluate(() => window.__stgBotStop?.());
}

// Панель расширения в ящике Extensions: только снимок — .stg-root там нет, мерка
// заточена под окно игры.
async function shotDrawer(page, where) {
    const dir = join(OUT, where.vp, where.case);
    mkdirSync(dir, { recursive: true });
    try {
        await dismissPopups(page);
        if (await page.locator('.stg-root').count()) {
            await page.keyboard.press('Escape');
            await page.waitForSelector('.stg-root', { state: 'detached', timeout: 5000 }).catch(() => {});
        }
        await page.click('#extensionsMenuButton');
        await page.waitForTimeout(300);
        await page.evaluate(() => {
            const block = document.querySelector('#stgames_settings, [id*="stgames" i]');
            block?.scrollIntoView({ block: 'center' });
            const drawer = block?.closest('.inline-drawer');
            const content = drawer?.querySelector('.inline-drawer-content');
            if (content) content.style.display = 'block';
        });
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(dir, `${where.stage}.png`), fullPage: false });
    } catch (err) {
        finding(where, 'сбой', `панель расширения не открылась: ${err.message}`);
    }
}

// --- Снимок и мерка

async function capture(page, where, kase) {
    const dir = join(OUT, where.vp, where.case);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${where.stage}.png`) });

    const m = await measure(page, kase.expect);
    if (!m || m.error) {
        finding(where, 'мерка', m?.error ?? 'мерку снять не удалось');
        return;
    }
    if (m.themeAttr !== kase.expect) {
        finding(where, 'палитра', `data-stg-theme="${m.themeAttr}", ожидалось "${kase.expect}"`);
    }
    if (m.doc.scrollW > m.doc.clientW + 1) {
        finding(where, 'вбок', `страница едет вбок: ${m.doc.scrollW} при ${m.doc.clientW}`);
    }
    for (const o of m.overflow) finding(where, 'за-экран', `${o.cls} [${o.left}…${o.right}] при ширине ${m.vw}`);
    for (const c of m.collisions) finding(where, 'наложение', c);
    if (m.clipped) finding(where, 'обрезано', m.clipped);
    for (const s of m.small) finding(where, 'мелкая-цель', `${s.cls} ${s.w}×${s.h}`);
    for (const c of m.contrast) finding(where, 'контраст', `${c.cls} «${c.text}» ${c.ratio} (${c.fg} на ${c.bg})`);
    for (const t of m.transparent) finding(where, 'подложка', t);
    for (const v of m.unresolved) finding(where, 'переменная', v);
    for (const v of m.canvasColors) finding(where, 'канвас-цвет', v);
    if (m.geom) {
        const g = m.geom;
        if (g.header && g.stage && g.header.w > g.stage.w + 4) {
            finding(where, 'шире-поля', `шапка ${g.header.w}px при поле ${g.stage.w}px — счётчики торчат за края`);
        }
        if (g.buttons && g.buttons.bottom > m.vh + 1) {
            finding(where, 'ниже-края', `кнопки влево/вправо ниже видимой области на ${g.buttons.bottom - m.vh}px`);
        }
        if (g.status && g.status.bottom > m.vh + 1) {
            finding(where, 'ниже-края', `строка статуса ниже видимой области на ${g.status.bottom - m.vh}px`);
        }
        if (g.shopItems && g.shop && g.shopItems.h > 0 && g.shopItems.bottom > m.vh + 1) {
            finding(where, 'ниже-края', `список скинов уходит ниже экрана на ${g.shopItems.bottom - m.vh}px`);
        }
        widths.push({ ...where, w: g.root?.w ?? null });
    }
    if (m.canvas) {
        if (m.canvas.coverage < 0.004) {
            finding(where, 'канвас-пусто', `нарисовано ${(m.canvas.coverage * 100).toFixed(2)}% пикселей — поле почти пустое`);
        }
        if (m.canvas.faint > 0.5 && m.canvas.coverage > 0.004) {
            finding(where, 'канвас-полупрозрачно', `${(m.canvas.faint * 100).toFixed(0)}% нарисованного с альфой < 0.5`);
        }
        if (m.canvas.blurry) finding(where, 'канвас-мыло', m.canvas.blurry);
        if (m.canvas.hidden) {
            finding(where, 'канвас-скрыт', `канвас скрыт (clientWidth 0), но кадры рисуются — буфер пересобран в фолбэк ${m.canvas.px}`);
        }
    }
}

function measure(page, expect) {
    return page.evaluate(({ expect: mode, minTap }) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const root = document.querySelector('.stg-root');
        if (!root) return { error: 'нет .stg-root' };

        const name = (el) => (typeof el.className === 'string' && el.className) || el.id || el.tagName.toLowerCase();
        const short = (el, n = 44) => String(name(el)).slice(0, n);

        const overflow = [];
        for (const el of [root, ...root.querySelectorAll('*')]) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.right > vw + 1 || r.left < -1) {
                overflow.push({ cls: short(el, 48), left: Math.round(r.left), right: Math.round(r.right) });
            }
        }

        let scroller = null;
        for (let el = root; el && el !== document.documentElement; el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight + 2) {
                scroller = { bottom: el.getBoundingClientRect().bottom };
                break;
            }
        }
        const limit = scroller ? Math.min(scroller.bottom, vh) : vh;
        const rootRect = root.getBoundingClientRect();
        const clipped = rootRect.bottom > limit + 2
            ? `экран игры ниже края на ${Math.round(rootRect.bottom - limit)}px`
            : '';

        const leaves = [...root.querySelectorAll('*')].filter((el) => {
            if (el.children.length > 0) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            const cs = getComputedStyle(el);
            if (cs.position !== 'static' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
            for (let node = el.parentElement; node && node !== root.parentElement; node = node.parentElement) {
                const ns = getComputedStyle(node);
                if (ns.position !== 'static') return false;
                if (ns.display === 'none' || ns.visibility === 'hidden') return false;
                if (ns.overflowY !== 'visible' || ns.overflowX !== 'visible') {
                    const box = node.getBoundingClientRect();
                    if (r.bottom > box.bottom + 1 || r.top < box.top - 1
                        || r.right > box.right + 1 || r.left < box.left - 1) return false;
                }
            }
            return true;
        });
        const collisions = [];
        for (let i = 0; i < leaves.length && collisions.length < 8; i++) {
            for (let j = i + 1; j < leaves.length && collisions.length < 8; j++) {
                const a = leaves[i].getBoundingClientRect();
                const b = leaves[j].getBoundingClientRect();
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (w > 2 && h > 2) {
                    collisions.push(`${short(leaves[i], 28)} × ${short(leaves[j], 28)} (${Math.round(w)}×${Math.round(h)}px)`);
                }
            }
        }

        const small = [];
        for (const el of root.querySelectorAll('button, select, .stg-tile, [role="button"], .doodlejump-btn, .doodlejump-shop-item')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (Math.min(r.width, r.height) < minTap) {
                small.push({
                    cls: `${short(el)} «${(el.textContent || '').trim().slice(0, 12)}»`,
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                });
            }
        }

        const parse = (css) => {
            const s = String(css).trim();
            const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
            if (hex) {
                const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
                return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
            }
            const m = s.match(/^rgba?\(([^)]+)\)$/);
            if (!m) return null;
            const p = m[1].replace(/[,/]/g, ' ').trim().split(/\s+/).map(Number);
            if (p.length < 3 || p.some((n) => !Number.isFinite(n))) return null;
            return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
        };
        const over = (fg, bg) => ({
            r: fg.r * fg.a + bg.r * (1 - fg.a),
            g: fg.g * fg.a + bg.g * (1 - fg.a),
            b: fg.b * fg.a + bg.b * (1 - fg.a),
            a: 1,
        });
        const lum = ({ r, g, b }) => {
            const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (a, b) => {
            const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
            return (hi + 0.05) / (lo + 0.05);
        };
        const backdrop = (el) => {
            const stack = [];
            for (let node = el; node; node = node.parentElement) {
                const c = parse(getComputedStyle(node).backgroundColor);
                if (!c || c.a === 0) continue;
                stack.push(c);
                if (c.a >= 0.999) break;
            }
            if (!stack.length) return null;
            let acc = stack.pop();
            if (acc.a < 0.999) return null;
            while (stack.length) acc = over(stack.pop(), acc);
            return acc;
        };

        const contrast = [];
        const unresolved = [];
        const transparent = [];

        if (mode === 'light' || mode === 'dark') {
            const rootBg = parse(getComputedStyle(root).backgroundColor);
            if (!rootBg || rootBg.a < 0.99) {
                transparent.push(`.stg-root без непрозрачной подложки (${getComputedStyle(root).backgroundColor})`);
            }
            const seen = new Set();
            for (const el of root.querySelectorAll('*')) {
                const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
                if (!own) continue;
                const r = el.getBoundingClientRect();
                if (r.width < 4 || r.height < 4) continue;
                const cs = getComputedStyle(el);
                if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.35) continue;
                const fg = parse(cs.color);
                const bg = backdrop(el);
                if (!fg || !bg) continue;
                const mixed = fg.a < 1 ? over(fg, bg) : fg;
                const cr = ratio(mixed, bg);
                const key = `${short(el)}|${Math.round(cr * 10)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (cr < 3) {
                    contrast.push({
                        cls: short(el),
                        text: (el.textContent || '').trim().slice(0, 18),
                        ratio: cr.toFixed(2),
                        fg: cs.color,
                        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
                    });
                }
                if (contrast.length >= 8) break;
            }
        }

        // --- цвета, которые канвас читает через getComputedStyle
        const cs = getComputedStyle(root);
        const canvasEl = document.querySelector('.doodlejump-canvas');
        const canvasVars = [];
        const NAMES = [
            '--stg-doodlejump-player', '--stg-doodlejump-player-eye', '--stg-doodlejump-platform',
            '--stg-doodlejump-platform-moving', '--stg-doodlejump-platform-crumbling',
            '--stg-doodlejump-spring', '--stg-doodlejump-propeller', '--stg-doodlejump-rocket',
            '--stg-doodlejump-coin',
            '--stg-doodlejump-skin-ufo', '--stg-doodlejump-skin-ufo-dome', '--stg-doodlejump-skin-ghost',
            '--stg-doodlejump-skin-crystal', '--stg-doodlejump-skin-crystal-facet', '--stg-doodlejump-skin-drop',
            '--stg-doodlejump-skin-star', '--stg-doodlejump-skin-crab', '--stg-doodlejump-skin-crab-limb',
            '--stg-doodlejump-skin-moon', '--stg-doodlejump-skin-frog', '--stg-doodlejump-skin-frog-tongue',
            '--stg-doodlejump-skin-snowflake', '--stg-doodlejump-skin-pacman', '--stg-doodlejump-skin-skull',
            '--stg-snake-head', '--stg-snake-body', '--stg-snake-food', '--stg-snake-grid', '--stg-snake-bg',
        ];
        const canvasBg = canvasEl ? backdrop(canvasEl) : null;
        for (const key of NAMES) {
            const raw = cs.getPropertyValue(key).trim();
            if (!raw) continue;
            if (/color-mix|var\(/.test(raw)) {
                unresolved.push(`${key}: ${raw} — до fillStyle доедет строкой и не покрасит`);
                continue;
            }
            const c = parse(raw);
            if (!c) { unresolved.push(`${key}: ${raw} — не разбирается как цвет`); continue; }
            // Разлиновка змейки полупрозрачна намеренно — это сетка, а не фигура.
            if (c.a < 0.9 && key !== '--stg-snake-grid') canvasVars.push(`${key}: ${raw} — полупрозрачный, на канвасе даст блёклую фигуру`);
            const detail = /-eye$|-facet$|-tongue$|-limb$|-dome$/.test(key);
            if (canvasBg && key.startsWith('--stg-doodlejump') && !detail) {
                const eff = c.a < 1 ? over(c, canvasBg) : c;
                const cr = ratio(eff, canvasBg);
                if (cr < 1.35) canvasVars.push(`${key}: ${raw} сливается с полем (контраст ${cr.toFixed(2)})`);
            }
        }

        // --- сам канвас: сколько на нём нарисовано и не блёклое ли это
        let canvas = null;
        if (canvasEl && canvasEl.width > 0) {
            try {
                const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
                const { width, height } = canvasEl;
                const img = ctx.getImageData(0, 0, width, height).data;
                let drawn = 0, faint = 0, total = 0;
                for (let i = 3; i < img.length; i += 4 * 7) {
                    total++;
                    const a = img[i];
                    if (a > 8) { drawn++; if (a < 128) faint++; }
                }
                const rect = canvasEl.getBoundingClientRect();
                // Сравниваем с clientWidth: именно его читает view.js. У
                // getBoundingClientRect ширина дробная, и разница в пиксель-другой —
                // это округление, а не мыло.
                const cssW = canvasEl.clientWidth;
                const wantW = Math.round(cssW * (window.devicePixelRatio || 1));
                canvas = {
                    coverage: total ? drawn / total : 0,
                    faint: drawn ? faint / drawn : 0,
                    px: `${width}×${height}`,
                    css: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
                    hidden: cssW === 0,
                    blurry: cssW > 0 && Math.abs(width - wantW) > 2
                        ? `буфер ${width}px при css ${cssW}px × dpr ${window.devicePixelRatio} — картинка мыльная`
                        : '',
                };
            } catch (err) {
                canvas = { coverage: 1, faint: 0, blurry: '', error: String(err.message) };
            }
        }

        const boxOf = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
        };
        const geom = {
            root: boxOf('.doodlejump-root'),
            stage: boxOf('.doodlejump-stage'),
            header: boxOf('.doodlejump-header'),
            buttons: boxOf('.doodlejump-buttons'),
            status: boxOf('.doodlejump-status'),
            shop: boxOf('.doodlejump-shop-content'),
            shopItems: boxOf('.doodlejump-shop-items'),
            stgRoot: boxOf('.stg-root'),
        };

        return {
            vw,
            vh,
            geom,
            themeAttr: root.dataset.stgTheme ?? '(нет)',
            doc: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth },
            overflow: overflow.slice(0, 6),
            collisions,
            clipped,
            small: small.slice(0, 6),
            contrast,
            transparent,
            unresolved,
            canvasColors: canvasVars.slice(0, 8),
            canvas,
        };
    }, { expect, minTap: 24 });
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
