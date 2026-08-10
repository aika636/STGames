// Мобильная вёрстка в живой таверне: узкий экран, альбомная ориентация, тач вместо мыши.
//
// Основной прогон идёт на 1280×900 — там ни одна из этих граблей не видна. Здесь набор
// поднимает свой контекст (360×640 и 640×360, hasTouch, isMobile) и по каждой игре
// снимает мерку: не вылезает ли что-то за экран по горизонтали, жив ли размер доски,
// осталась ли она квадратной, помещается ли экран игры в попап без прокрутки и не
// мельчают ли кнопки до нетыкаемых. Цифры печатаются целиком: часть из них — не
// поломка, а повод посмотреть глазами.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { assert } from '../_harness.mjs';
import { ARTIFACTS, closeShell, e2eTest, openGame, openHub, openTavern, resetSettings } from './_st.mjs';

const VIEWPORTS = Object.freeze([
    { label: 'портрет 360×640', width: 360, height: 640 },
    { label: 'ландшафт 640×360', width: 640, height: 360 },
]);

// Доска игры и признак «обязана быть квадратной». Змейка — канвас (квадрат держит сама
// игра), «слова» — сетка 5×6, квадратом быть не должна.
const GAMES = Object.freeze([
    { id: 'sudoku', board: '.sudoku-board', square: true },
    { id: 'snake', board: '.snake-canvas', square: true },
    { id: 'reversi', board: '.reversi-board', square: true },
    { id: 'words', board: '.words-grid', square: false },
    { id: 'minesweeper', board: '.minesweeper-board', square: true },
    { id: 'nonogram', board: '.nonogram-board', square: true },
    { id: 'crossword', board: '.crossword-board', square: true },
    { id: 'balda', board: '.balda-board', square: true },
]);

// Минимальный тыкаемый размер: 24 CSS-пикселя — нижняя граница WCAG 2.2 (2.5.8).
const MIN_TAP = 24;

export default async function run(env) {
    for (const viewport of VIEWPORTS) {
        await runViewport(env, viewport);
    }
}

async function runViewport(outer, viewport) {
    const session = await openTavern(outer.browser, outer.url, {
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
    });
    const { page } = session;
    // Скриншоты на падении обязаны сниматься с мобильной страницы, а не с основной:
    // e2eTest снимает env.page, поэтому подменяем его на свою.
    const env = { ...outer, page };
    const shots = join(ARTIFACTS, 'mobile', viewport.width > viewport.height ? 'landscape' : 'portrait');

    try {
        await e2eTest(env, `${viewport.label}: хаб помещается в экран`, async () => {
            await resetSettings(page);
            await openHub(page);

            const m = await measure(page, '.stg-hub');
            report(`хаб · ${viewport.label}`, m);
            await shot(page, shots, 'hub');
            assertFits(m, 'хаб');

            await closeShell(page);
        });

        for (const game of GAMES) {
            await e2eTest(env, `${viewport.label}: ${game.id}`, async () => {
                await resetSettings(page);
                await openHub(page);
                await openGame(page, game.id);

                const m = await measure(page, game.board);
                report(`${game.id} · ${viewport.label}`, m);
                await shot(page, shots, game.id);

                assert(m.board && m.board.w > 0 && m.board.h > 0, `${game.id}: доска нулевого размера`);
                if (game.square) {
                    assert(
                        Math.abs(m.board.w - m.board.h) <= 2,
                        `${game.id}: доска не квадратная — ${Math.round(m.board.w)}×${Math.round(m.board.h)}`,
                    );
                }
                assertFits(m, game.id);

                await closeShell(page);
            });
        }

        // Тач вместо мыши: на мобильном у игрока нет ни правой кнопки, ни hover. Проверяем
        // самое ходовое — что тап по клетке вообще доходит до игры.
        await e2eTest(env, `${viewport.label}: тап по клетке доходит до игры`, async () => {
            await resetSettings(page);
            await openHub(page);
            await openGame(page, 'sudoku');

            await page.locator('.sudoku-cell:not(.sudoku-given)').first().tap();
            await page.waitForFunction(
                () => document.querySelectorAll('.sudoku-cell.sudoku-selected').length === 1,
                null,
                { timeout: 10_000 },
            );

            await closeShell(page);
        });

        const noise = session.errors.filter((line) => /STGames|stgames/i.test(line));
        await e2eTest(env, `${viewport.label}: расширение молчит в консоли`, async () => {
            assert(noise.length === 0, `ошибки консоли:\n${noise.join('\n')}`);
        });
    } finally {
        await session.context.close().catch(() => {});
    }
}

// Горизонталь — жёсткое требование: страница не должна ездить вбок, а экран игры
// не должен выходить за края попапа. Вертикаль печатается, но не роняет тест:
// в ландшафте 360px высоты прокрутка внутри попапа — норма, а не поломка.
function assertFits(m, name) {
    assert(
        m.doc.scrollW <= m.doc.clientW + 1,
        `${name}: страница едет вбок — scrollWidth ${m.doc.scrollW} при ширине ${m.doc.clientW}`,
    );
    assert(
        m.overflow.length === 0,
        `${name}: за экран по горизонтали вылезло ${m.overflowCount} элем.: `
        + m.overflow.map((o) => `${o.cls} [${o.left}…${o.right}]`).join('; '),
    );
    assert(
        m.collisions.length === 0,
        `${name}: элементы налезают друг на друга (${m.collisionCount}): ${m.collisions.join('; ')}`,
    );
}

// Снимок ровно того, что видит игрок: без fullPage — нас интересует видимая часть экрана.
async function shot(page, dir, name) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${name}.png`) });
}

function report(title, m) {
    const line = [
        `    ${title}`,
        `экран ${m.vw}×${m.vh}`,
        m.board ? `доска ${Math.round(m.board.w)}×${Math.round(m.board.h)}` : 'доски нет',
        m.scroller
            ? `внутри попапа ${m.scroller.scrollH}/${m.scroller.clientH}${m.scroller.scrollH > m.scroller.clientH + 2 ? ' ← прокрутка' : ''}`
            : 'прокрутки нет',
        m.clipped ? `ЗА ВИДИМОЙ ЧАСТЬЮ: ${m.clipped}` : 'всё видно',
        m.smallCount ? `мелкие цели (<${MIN_TAP}px): ${m.small.map((s) => `${s.cls} ${s.w}×${s.h}`).join(', ')}` : 'цели ≥24px',
    ];
    console.log(line.join(' · '));
}

/**
 * Мерка экрана игры в браузере: габариты, выходы за края, прокрутка попапа,
 * размеры тыкаемых элементов.
 */
function measure(page, boardSelector) {
    return page.evaluate(({ selector, minTap }) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const root = document.querySelector('.stg-root');
        if (!root) return { vw, vh, error: 'нет .stg-root' };

        const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        const name = (el) => (typeof el.className === 'string' && el.className)
            || el.id
            || el.tagName.toLowerCase();

        // Что вылезло за края экрана по горизонтали. Ноль-размерное и скрытое не считаем.
        const overflow = [];
        for (const el of [root, ...root.querySelectorAll('*')]) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.right > vw + 1 || r.left < -1) {
                overflow.push({ cls: String(name(el)).slice(0, 48), left: Math.round(r.left), right: Math.round(r.right) });
            }
        }

        // Ближайший прокручиваемый предок — контейнер попапа ST.
        let scroller = null;
        for (let el = root; el && el !== document.documentElement; el = el.parentElement) {
            if (el.scrollHeight > el.clientHeight + 2) {
                scroller = { cls: String(name(el)).slice(0, 48), scrollH: el.scrollHeight, clientH: el.clientHeight, bottom: el.getBoundingClientRect().bottom };
                break;
            }
        }

        // Что не влезло по вертикали в видимую часть попапа (то есть требует прокрутки).
        const limit = scroller ? Math.min(scroller.bottom, vh) : vh;
        const rootRect = rect(root);
        const clipped = rootRect.bottom > limit + 2
            ? `экран игры ниже края на ${Math.round(rootRect.bottom - limit)}px`
            : '';

        // Наложения: на узком экране flex-строка не переносится, а элементы залезают
        // друг на друга — за края экрана при этом ничего не выходит, поэтому ловим
        // отдельно. Сравниваем только листья (элементы без детей): у предков рамки
        // пересекаются по определению.
        const leaves = [...root.querySelectorAll('*')].filter((el) => {
            if (el.children.length > 0) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return false;
            const cs = getComputedStyle(el);
            // Осознанные наложения — подсветки и значки поверх клеток — позиционированы.
            return cs.position === 'static' && cs.visibility !== 'hidden' && cs.opacity !== '0';
        });
        const collisions = [];
        for (let i = 0; i < leaves.length; i++) {
            for (let j = i + 1; j < leaves.length; j++) {
                const a = leaves[i].getBoundingClientRect();
                const b = leaves[j].getBoundingClientRect();
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (w > 2 && h > 2) {
                    collisions.push(
                        `${String(name(leaves[i])).slice(0, 28)} × ${String(name(leaves[j])).slice(0, 28)}`
                        + ` (${Math.round(w)}×${Math.round(h)}px)`,
                    );
                }
            }
        }

        const small = [];
        for (const el of root.querySelectorAll('button, select, input, .stg-tile, [role="button"], .words-key, .balda-key, .crossword-word')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (Math.min(r.width, r.height) < minTap) {
                small.push({ cls: String(name(el)).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
            }
        }

        const board = selector ? document.querySelector(selector) : null;

        return {
            vw,
            vh,
            doc: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth },
            root: rootRect,
            board: board ? rect(board) : null,
            overflow: overflow.slice(0, 8),
            overflowCount: overflow.length,
            collisions: collisions.slice(0, 6),
            collisionCount: collisions.length,
            scroller,
            clipped,
            small: small.slice(0, 8),
            smallCount: small.length,
        };
    }, { selector: boardSelector, minTap: MIN_TAP });
}
