// Прогон палитр (Фаза 14) по всем играм: каждая игра доигрывается до конца в каждом
// режиме оформления, на десктопе и на узком экране телефона. На каждом шаге снимается
// скриншот и берётся мерка: выходы за экран, наложения плашек, мелкие цели, контраст
// текста к своей подложке.
//
// Файл временный (как live-view.mjs), в репозитории не остаётся.
//
//   node tests/e2e/theme-sweep.mjs [--headed] [--case=<id>] [--game=<id>] [--vp=desktop|mobile]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { slotsFromGrid } from '../../src/games/crossword/core/puzzles.js';
import { ARTIFACTS, dismissPopups, flushSettings, openTavern, readSettings, startTavern } from './_st.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};
const HEADED = argv.includes('--headed');
const ONLY_CASE = flag('case', null);
const ONLY_GAME = flag('game', null);
const ONLY_VP = flag('vp', null);

const OUT = join(ARTIFACTS, 'themes');

// --- Оси прогона

const VIEWPORTS = [
    { id: 'desktop', width: 1280, height: 900, touch: false },
    { id: 'mobile', width: 360, height: 640, touch: true },
];

// Тема таверны важна не меньше режима палитры: «авто» смотрит на цвет текста ST, а
// режим «Цвета таверны» целиком из неё и состоит. Все штатные темы ST тёмные, светлая
// бывает только самодельная — поэтому светлую подкладываем переменными :root, ровно
// теми, что ставит сама таверна.
const CASES = [
    { id: 'auto-on-dark', appearance: 'auto', st: 'dark', expect: 'dark' },
    { id: 'auto-on-light', appearance: 'auto', st: 'light', expect: 'light' },
    { id: 'light-on-dark', appearance: 'light', st: 'dark', expect: 'light' },
    { id: 'dark-on-light', appearance: 'dark', st: 'light', expect: 'dark' },
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
const notes = [];

function finding(where, kind, text) {
    findings.push({ ...where, kind, text });
    console.log(`  ! [${kind}] ${where.vp}/${where.case}/${where.game}/${where.stage}: ${text}`);
}

// --- Запуск

let browser = null;
let tavern = null;

async function main() {
    tavern = await startTavern({ port: Number(process.env.STGAMES_E2E_PORT || 8125) });
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
        writeFileSync(join(OUT, 'findings.json'), JSON.stringify({ findings, notes }, null, 2), 'utf8');
        console.log(`\nнайдено замечаний: ${findings.length} → ${join(OUT, 'findings.json')}`);
        await browser.close().catch(() => {});
        tavern.stop();
    }
}

// --- Один прогон «экран × режим»

async function runCase(vp, kase) {
    console.log(`\n=== ${vp.id} · ${kase.id} (палитра ${kase.appearance}, тема ST ${kase.st})`);
    const session = await openTavern(browser, tavern.url, {
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.touch,
        isMobile: vp.touch,
        deviceScaleFactor: vp.touch ? 2 : 1,
    });
    const { page } = session;

    try {
        await prepare(page, kase);

        // Хаб — тоже экран расширения, и на узком экране плитки съезжают первыми.
        await openHub(page);
        await capture(page, { vp: vp.id, case: kase.id, game: 'hub', stage: 'start' }, kase, null);
        await closeShell(page);

        for (const game of GAMES) {
            if (ONLY_GAME && game.id !== ONLY_GAME) continue;
            const where = { vp: vp.id, case: kase.id, game: game.id };
            try {
                await openHub(page);
                // Тосты ST живут дольше окна игры и в кадре следующей игры выглядят её
                // сообщением. Свои тосты каждая игра покажет заново.
                await page.evaluate(() => globalThis.toastr?.clear?.());
                await page.click(`.stg-tile[data-game-id="${game.id}"]`);
                await page.waitForSelector(game.ready, { timeout: 30_000 });
                await game.play(page, {
                    shot: (stage) => capture(page, { ...where, stage }, kase, game.board),
                    where,
                    kase,
                    vp,
                });
            } catch (err) {
                finding({ ...where, stage: 'прогон' }, 'сбой', `игру не удалось доиграть: ${err.message}`);
                await capture(page, { ...where, stage: 'fail' }, kase, game.board).catch(() => {});
            }
            await closeShell(page).catch(() => {});
        }

        const noise = session.errors.filter((line) => /STGames|stgames/i.test(line));
        for (const line of noise.slice(0, 10)) {
            finding({ vp: vp.id, case: kase.id, game: '-', stage: 'консоль' }, 'консоль', line.slice(0, 300));
        }
    } finally {
        await session.context.close().catch(() => {});
    }
}

async function prepare(page, kase) {
    await page.evaluate((mode) => {
        const root = SillyTavern.getContext().extensionSettings;
        delete root.Sudoku;
        root.STGames = { version: 1, lastGame: null, appearance: mode, games: {} };
    }, kase.appearance);
    await applyStTheme(page, kase);
}

async function applyStTheme(page, kase) {
    if (kase.st !== 'light') return;
    await page.evaluate((vars) => {
        for (const [name, value] of Object.entries(vars)) {
            document.documentElement.style.setProperty(name, value);
        }
        // Обои таверны — картинка; под светлой темой она тоже светлая, иначе попап
        // полупрозрачным фоном ляжет на тёмное и сравнение будет нечестным.
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
    // Попап ST появляется с анимацией: снимок сразу после клика ловит полупрозрачное
    // окно и ещё открытое wand-меню за ним.
    await page.waitForTimeout(600);
}

async function closeShell(page) {
    if (await page.locator('.stg-root').count() === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForSelector('.stg-root', { state: 'detached', timeout: 10_000 });
}

// --- Снимок + мерка

async function capture(page, where, kase, boardSelector) {
    const dir = join(OUT, where.vp, where.case);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${where.game}-${where.stage}.png`);
    await page.screenshot({ path: file });

    const m = await measure(page, boardSelector, kase.expect);
    if (!m || m.error) {
        finding(where, 'мерка', m?.error ?? 'мерку снять не удалось');
        return;
    }

    if (m.themeAttr !== kase.expect) {
        finding(where, 'палитра', `data-stg-theme="${m.themeAttr}", ожидалось "${kase.expect}"`);
    }
    if (m.doc.scrollW > m.doc.clientW + 1) {
        finding(where, 'вбок', `страница едет вбок: scrollWidth ${m.doc.scrollW} при ${m.doc.clientW}`);
    }
    for (const o of m.overflow) {
        finding(where, 'за-экран', `${o.cls} [${o.left}…${o.right}] при ширине ${m.vw}`);
    }
    for (const c of m.collisions) finding(where, 'наложение', c);
    if (m.clipped) finding(where, 'обрезано', m.clipped);
    for (const s of m.small) finding(where, 'мелкая-цель', `${s.cls} ${s.w}×${s.h}`);
    for (const c of m.contrast) {
        finding(where, 'контраст', `${c.cls} «${c.text}» ${c.ratio} (${c.fg} на ${c.bg})`);
    }
    for (const t of m.transparent) finding(where, 'подложка', t);
    for (const v of m.unresolved) finding(where, 'переменная', v);
}

function measure(page, boardSelector, expect) {
    return page.evaluate(({ selector, expect: mode, minTap }) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const root = document.querySelector('.stg-root');
        if (!root) return { error: 'нет .stg-root' };

        const name = (el) => (typeof el.className === 'string' && el.className) || el.id || el.tagName.toLowerCase();
        const short = (el, n = 40) => String(name(el)).slice(0, n);

        // --- габариты
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
                scroller = { scrollH: el.scrollHeight, clientH: el.clientHeight, bottom: el.getBoundingClientRect().bottom };
                break;
            }
        }
        const limit = scroller ? Math.min(scroller.bottom, vh) : vh;
        const rootRect = root.getBoundingClientRect();
        const clipped = rootRect.bottom > limit + 2
            ? `экран игры ниже края на ${Math.round(rootRect.bottom - limit)}px`
            : '';

        // --- наложения (только листья со статическим позиционированием)
        const leaves = [...root.querySelectorAll('*')].filter((el) => {
            if (el.children.length > 0) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            const cs = getComputedStyle(el);
            if (cs.position !== 'static' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
            // Осознанные наложения — оверлей конца заезда, подсветки, значки — лежат
            // внутри позиционированного предка. Их содержимое обязано накрывать поле.
            for (let node = el.parentElement; node && node !== root.parentElement; node = node.parentElement) {
                const ns = getComputedStyle(node);
                if (ns.position !== 'static') return false;
                // Уехавшее за край прокручиваемого предка не видно, но рамку имеет —
                // и без этой проверки читается как наложение на то, что под блоком.
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

        // --- мелкие цели
        const small = [];
        for (const el of root.querySelectorAll('button, select, .stg-tile, [role="button"], .words-key, .balda-key, .crossword-word')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (Math.min(r.width, r.height) < minTap) {
                small.push({
                    cls: `${short(el)} «${(el.textContent || el.dataset.key || '').trim().slice(0, 10)}»`,
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                });
            }
        }

        // --- цвет: контраст текста к своей фактической подложке
        const parse = (css) => {
            const m = String(css).match(/^rgba?\(([^)]+)\)$/);
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
        // Фактическая подложка: снизу вверх по предкам, пока не наберётся непрозрачный
        // слой. Ниже .stg-root — попап ST, он поверх обоев, поэтому в режиме 'theme'
        // честного ответа нет и контраст там не проверяем.
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

        // --- переменные палитры, которые читает JS (канвас змейки): color-mix до
        // fillStyle не доезжает, и такая переменная рисует прозрачным.
        const cs = getComputedStyle(root);
        for (const key of ['--stg-snake-head', '--stg-snake-body', '--stg-snake-food', '--stg-snake-grid', '--stg-snake-bg']) {
            const value = cs.getPropertyValue(key).trim();
            if (!value) continue;
            if (/color-mix|var\(/.test(value)) unresolved.push(`${key}: ${value}`);
        }

        const board = selector ? document.querySelector(selector) : null;
        const rect = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };

        return {
            vw,
            vh,
            themeAttr: root.dataset.stgTheme ?? '(нет)',
            doc: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth },
            board: board ? rect(board) : null,
            overflow: overflow.slice(0, 6),
            collisions,
            clipped,
            small: small.slice(0, 6),
            contrast,
            transparent,
            unresolved,
        };
    }, { selector: boardSelector, expect, minTap: 24 });
}

// --- Игры: каждая доигрывается до конца

async function settings(page) {
    await flushSettings(page);
    return readSettings(page);
}

const GAMES = [
    {
        id: 'sudoku',
        ready: '.sudoku-board',
        board: '.sudoku-board',
        async play(page, { shot }) {
            await page.selectOption('.sudoku-select', 'easy').catch(() => {});
            await page.waitForTimeout(200);
            await shot('start');

            // Раскладка известна только партии — вытаскиваем её из сохранёнки, а она
            // случается с первого хода.
            const first = page.locator('.sudoku-cell:not(.sudoku-given)').first();
            await first.click();
            await page.keyboard.press('1');
            const saved = (await settings(page)).games?.sudoku?.savedGame;
            if (!saved?.solution) throw new Error('в сохранённой партии нет решения');

            const empty = [];
            for (let i = 0; i < 81; i++) if (!saved.puzzle[i]) empty.push(i);
            for (let n = 0; n < empty.length; n++) {
                const idx = empty[n];
                await page.locator(`.sudoku-cell[data-idx="${idx}"]`).click();
                await page.keyboard.press(String(saved.solution[idx]));
                if (n === Math.floor(empty.length / 2)) await shot('mid');
            }
            // Клик и клавиша изредка расходятся во времени — добираем то, что не встало,
            // иначе доска остаётся на одну цифру недорешённой и победы нет.
            for (let pass = 0; pass < 3; pass++) {
                const wrong = await page.evaluate((solution) => [...document.querySelectorAll('.sudoku-cell')]
                    .map((cell, i) => ((cell.textContent || '').trim() === String(solution[i]) ? -1 : i))
                    .filter((i) => i >= 0), saved.solution);
                if (!wrong.length) break;
                for (const idx of wrong) {
                    await page.locator(`.sudoku-cell[data-idx="${idx}"]`).click();
                    await page.keyboard.press(String(saved.solution[idx]));
                    await page.waitForTimeout(40);
                }
            }
            await page.waitForSelector('.sudoku-board-done', { timeout: 15_000 });
            await shot('end');
        },
    },
    {
        id: 'snake',
        ready: '.snake-canvas',
        board: '.snake-canvas',
        async play(page, { shot }) {
            await shot('start');
            // Сквозные стены выключаем: иначе заезд не кончится сам.
            await page.evaluate(() => {
                const s = SillyTavern.getContext().extensionSettings.STGames.games.snake;
                if (s) s.wrapWalls = false;
            });
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(600);
            await shot('mid');
            for (let i = 0; i < 40 && await page.locator('.snake-over').count() === 0; i++) {
                await page.keyboard.press('ArrowRight');
                await page.waitForTimeout(200);
            }
            await page.waitForSelector('.snake-over', { timeout: 20_000 });
            await shot('end');
        },
    },
    {
        id: 'reversi',
        ready: '.reversi-board',
        board: '.reversi-board',
        async play(page, { shot }) {
            await shot('start');
            for (let move = 0; move < 70; move++) {
                const status = await page.locator('.reversi-status').textContent().catch(() => '');
                if (/окончена|Победа|Ничья|Поражение|Новая игра/i.test(status || '')) break;
                const hint = page.locator('.reversi-cell.reversi-hint').first();
                if (await hint.count() === 0) { await page.waitForTimeout(400); continue; }
                await hint.click();
                await page.waitForTimeout(450);
                if (move === 8) await shot('mid');
            }
            await shot('end');
        },
    },
    {
        id: 'words',
        ready: '.words-grid',
        board: '.words-grid',
        async play(page, { shot }) {
            await shot('start');
            for (const ch of 'СЛОВО') await typeLetter(page, ch);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1500);
            await shot('mid');

            const saved = (await settings(page)).games?.words?.savedGame;
            const secret = saved?.secret;
            if (!secret) { await shot('end'); return; }
            for (let attempt = 0; attempt < 5; attempt++) {
                if (await page.locator('.words-row-reveal').count() > 0
                    && /отгад|Загадано|Новая|Победа/i.test(await page.locator('.words-status').textContent() || '')) break;
                for (const ch of secret) await typeLetter(page, ch);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(1800);
                break;
            }
            await shot('end');
        },
    },
    {
        id: 'minesweeper',
        ready: '.minesweeper-board',
        board: '.minesweeper-board',
        async play(page, { shot }) {
            await page.selectOption('.minesweeper-select', 'easy').catch(() => {});
            await page.waitForTimeout(200);
            await shot('start');

            await page.locator('.minesweeper-cell').first().click();
            const saved = (await settings(page)).games?.minesweeper?.savedGame;
            if (!saved?.mine) throw new Error('в сохранённой партии нет мин');
            const safe = [];
            for (let i = 0; i < saved.mine.length; i++) if (saved.mine[i] === '0') safe.push(i);
            for (let n = 0; n < safe.length; n++) {
                const cell = page.locator(`.minesweeper-cell[data-idx="${safe[n]}"]`);
                if (await cell.evaluate((el) => el.classList.contains('minesweeper-open')).catch(() => true)) continue;
                await cell.click();
                if (n === Math.floor(safe.length / 2)) await shot('mid');
            }
            await page.waitForTimeout(400);
            await shot('end');
        },
    },
    {
        id: 'nonogram',
        ready: '.nonogram-board',
        board: '.nonogram-board',
        async play(page, { shot }) {
            await page.selectOption('.nonogram-select', 'easy').catch(() => {});
            await page.waitForTimeout(300);
            await shot('start');

            await page.locator('.nonogram-cell[data-idx="0"]').click();
            const saved = (await settings(page)).games?.nonogram?.savedGame;
            if (!saved?.solution) throw new Error('в сохранённой партии нет картинки');
            if (saved.solution[0] === '0') await page.locator('.nonogram-cell[data-idx="0"]').click();

            const filled = [];
            for (let i = 0; i < saved.solution.length; i++) if (saved.solution[i] === '1') filled.push(i);
            for (let n = 0; n < filled.length; n++) {
                if (filled[n] === 0) continue;
                await page.locator(`.nonogram-cell[data-idx="${filled[n]}"]`).click();
                if (n === Math.floor(filled.length / 2)) await shot('mid');
            }
            await page.waitForTimeout(400);
            await shot('end');
        },
    },
    {
        id: 'crossword',
        ready: '.crossword-board',
        board: '.crossword-board',
        async play(page, { shot }) {
            await page.selectOption('.crossword-select', flag('level', 'easy')).catch(() => {});
            await page.waitForSelector('.crossword-word', { timeout: 20_000 });
            await page.waitForTimeout(300);
            await shot('start');

            await page.locator('.crossword-cell:not(.crossword-block)').first().click();
            await page.locator('.crossword-word.crossword-word-fit').first().click();
            const saved = (await settings(page)).games?.crossword?.savedGame;
            if (!saved?.solution) throw new Error('в сохранённой партии нет раскладки');
            const slots = slotsFromGrid(saved.grid, saved.cols, saved.rows);
            const solution = saved.solution.split(',').map(Number);

            const placed = page.locator('.crossword-word.crossword-word-used');
            if (await placed.count() > 0) await placed.first().click();

            for (let index = 0; index < slots.length; index++) {
                await selectSlot(page, slots[index]);
                await page.locator(`.crossword-word[data-word="${solution[index]}"]`).click();
                await page.waitForFunction(
                    (word) => document.querySelector(`.crossword-word[data-word="${word}"]`)?.classList.contains('crossword-word-used') === true,
                    solution[index],
                    { timeout: 10_000 },
                );
                if (index === Math.floor(slots.length / 2)) await shot('mid');
            }
            await page.waitForTimeout(300);
            await shot('end');
        },
    },
    {
        id: 'balda',
        ready: '.balda-board',
        board: '.balda-board',
        async play(page, { shot, kase }) {
            await shot('start');

            // Ход игрока по известной позиции: слово ПОРОГ в среднем ряду, буква А
            // над «Р», путь ГОРА росчерком мыши.
            await closeShell(page);
            await seedBalda(page, 0);
            await openHub(page);
            await page.click('.stg-tile[data-game-id="balda"]');
            await page.waitForSelector('.balda-board', { timeout: 20_000 });
            await applyStTheme(page, kase);

            await page.locator('.balda-cell[data-idx="7"]').click();
            await page.keyboard.press('KeyF');
            await page.waitForFunction(
                () => document.querySelector('.balda-cell[data-idx="7"] .balda-glyph')?.textContent === 'А',
                null,
                { timeout: 10_000 },
            );

            const box = await page.locator('.balda-board').boundingBox();
            const step = box.width / 5;
            const at = (i) => ({ x: box.x + step * ((i % 5) + 0.5), y: box.y + step * (Math.floor(i / 5) + 0.5) });
            const stroke = [14, 13, 12, 7];
            await page.mouse.move(at(stroke[0]).x, at(stroke[0]).y);
            await page.mouse.down();
            for (const i of stroke.slice(1)) await page.mouse.move(at(i).x, at(i).y);
            await page.mouse.up();
            await page.waitForFunction(
                () => document.querySelector('.balda-status')?.textContent === 'Слово: ГОРА',
                null,
                { timeout: 10_000 },
            );
            await shot('mid');
            await page.locator('.balda-submit').click();
            await page.waitForFunction(
                () => ['Ваш ход', 'Партия окончена'].includes(document.querySelector('.balda-turn')?.textContent),
                null,
                { timeout: 20_000 },
            );

            // Конец партии: поле почти полное и один пас в запасе — «Пас» закрывает
            // партию сразу, иначе доигрывать 25 клеток на каждом режиме нечем.
            await closeShell(page);
            await seedBalda(page, 1);
            await openHub(page);
            await page.click('.stg-tile[data-game-id="balda"]');
            await page.waitForSelector('.balda-board', { timeout: 20_000 });
            await applyStTheme(page, kase);
            await page.locator('.balda-pass').click();
            await page.waitForTimeout(1200);
            await shot('end');
        },
    },
];

// Буквы «Слов» набираем экранной клавиатурой: физическая раскладка проверяется
// отдельным e2e-набором, а здесь важно, что буква доехала до доски на любом режиме.
async function typeLetter(page, ch) {
    await page.locator(`.words-key[data-key="${ch}"]`).click();
    await page.waitForTimeout(40);
}

async function selectSlot(page, slot) {
    const cell = page.locator(`.crossword-cell[data-idx="${slot.cells[0]}"]`);
    for (let attempt = 0; attempt < 3; attempt++) {
        await cell.click();
        const active = await page.$$eval('.crossword-cell.crossword-active', (cells) => cells.map((el) => Number(el.dataset.idx)));
        if (active.join(',') === slot.cells.join(',')) return;
    }
    throw new Error(`не удалось выбрать слот в клетке ${slot.cells[0]}`);
}

// Партия балды с известным словом. passes=1 означает «ещё один пас — и конец».
function seedBalda(page, passes) {
    return page.evaluate((p) => {
        const root = SillyTavern.getContext().extensionSettings;
        root.STGames.games.balda = {
            ...(root.STGames.games.balda ?? {}),
            savedGame: {
                size: 5,
                start: 'ПОРОГ',
                board: `${'.'.repeat(10)}ПОРОГ${'.'.repeat(10)}`,
                turn: 0,
                human: 0,
                passes: p,
                words: [[], []],
                level: 'medium',
            },
        };
    }, passes);
}

await main();
