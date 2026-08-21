// Canvas-экран «Дудл Джампа». Рисует состояние движка (core/engine.js) в device-пикселях:
// буфер canvas считается как cssW * devicePixelRatio, иначе на телефоне картинка мыльная.
//
// Отличие от квадратного канваса змейки: поле портретное, поэтому cssW и cssH берутся
// независимо друг от друга (у змейки высота просто приравнивалась к ширине). Мир живёт в
// своих единицах (wu) шириной WORLD_W, экран — окно высотой state.world.h; один и тот же
// коэффициент scale = canvas.width / WORLD_W переводит wu в device-пиксели по обеим осям,
// поэтому фигурка остаётся квадратной при любых пропорциях контейнера, а по вертикали
// видно ровно столько мира, сколько влезло.
//
// Всё рисуется относительно state.cameraY: screenY = (worldY - cameraY) * scale.
//
// Цвета берутся из общего слоя палитры (--stg-doodlejump-*, см. style.css) через
// getComputedStyle. Именно поэтому те переменные заданы литералами и var(), без
// color-mix: до канваса значение доезжает строкой, а color-mix() в ней fillStyle не
// понимает — вместо цвета вышел бы прозрачный чёрный.

import { PLATFORM_H, PLAYER_H, PLAYER_W, WORLD_W } from '../core/engine.js';

// Фолбэки размера — только для jsdom и для первого кадра до раскладки: в браузере
// clientWidth/clientHeight приходят из CSS (.doodlejump-stage задаёт aspect-ratio).
const FALLBACK_W = 320;
const FALLBACK_H = 512;

export function createView() {
    const root = document.createElement('div');
    root.className = 'doodlejump-view';
    const canvas = document.createElement('canvas');
    canvas.className = 'doodlejump-canvas';
    root.appendChild(canvas);

    let ctx2d = null;
    let lastW = 0;
    let lastH = 0;

    // Скруглённый прямоугольник там, где браузер это умеет, и обычный там, где нет
    // (в том числе в jsdom-заглушке 2d-контекста): форма фигурки — украшение, а не
    // геометрия, и ветвиться на неё дешевле, чем тянуть свой путь из дуг.
    function fillBox(x, y, w, h, radius) {
        if (typeof ctx2d.roundRect === 'function') {
            ctx2d.beginPath();
            ctx2d.roundRect(x, y, w, h, radius);
            ctx2d.fill();
            return;
        }
        ctx2d.fillRect(x, y, w, h);
    }

    // Пружинка над платформой — зигзаг в четыре звена: рисуется нейтральным цветом
    // платформы, а не своим, чтобы читаться и на жёлтой пружине, и на любой теме.
    function drawSpring(x, top, w, scale, color) {
        const cx = x + w / 2;
        const half = 8 * scale;
        const h = 10 * scale;
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = Math.max(1, 2 * scale);
        ctx2d.beginPath();
        ctx2d.moveTo(cx - half, top);
        ctx2d.lineTo(cx + half, top - h * 0.4);
        ctx2d.lineTo(cx - half, top - h * 0.7);
        ctx2d.lineTo(cx + half, top - h);
        ctx2d.stroke();
    }

    // Трещины сломанной платформы: три коротких косых линии во всю её высоту. Блёклая
    // заливка одна сообщала бы «просто дальняя», трещины — «под ногами уже не опора».
    function drawCracks(x, top, w, h, color) {
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = Math.max(1, h * 0.14);
        ctx2d.beginPath();
        for (let i = 1; i <= 3; i++) {
            const cx = x + (w * i) / 4;
            ctx2d.moveTo(cx - w * 0.035, top);
            ctx2d.lineTo(cx + w * 0.035, top + h);
        }
        ctx2d.stroke();
    }

    function drawPlayer(px, py, facing, scale, bodyColor, eyeColor) {
        const w = PLAYER_W * scale;
        const h = PLAYER_H * scale;
        const x = px * scale;
        const y = py * scale;

        ctx2d.fillStyle = bodyColor;
        fillBox(x, y, w, h, Math.min(w, h) * 0.3);

        // «Глаза» смотрят по facing — единственная деталь, дающая ощущение направления
        // без спрайтов. Точки, а не зрачки: на 40 wu ширины больше и не читалось бы.
        const r = w * 0.09;
        const eyeY = y + h * 0.34;
        const near = facing < 0 ? x + w * 0.24 : x + w * 0.6;
        const far = facing < 0 ? x + w * 0.44 : x + w * 0.8;
        ctx2d.fillStyle = eyeColor;
        for (const cx of [near, far]) {
            ctx2d.beginPath();
            ctx2d.arc(cx, eyeY, r, 0, Math.PI * 2);
            ctx2d.fill();
        }
    }

    function draw(state) {
        // jsdom без пакета canvas возвращает null — тогда отрисовка становится no-op,
        // а экран продолжает жить: то же осознанное ограничение, что у змейки.
        if (!ctx2d) {
            ctx2d = canvas.getContext('2d');
            if (!ctx2d) return;
        }

        // Портрет: ширина и высота считаются порознь. Пересчёт при каждом изменении
        // любой из них — поворот телефона меняет обе.
        const cssW = canvas.clientWidth || FALLBACK_W;
        const cssH = canvas.clientHeight || FALLBACK_H;
        if (cssW !== lastW || cssH !== lastH) {
            lastW = cssW;
            lastH = cssH;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.max(1, Math.round(cssW * dpr));
            canvas.height = Math.max(1, Math.round(cssH * dpr));
        }

        const w = canvas.width;
        const h = canvas.height;
        const scale = w / WORLD_W;

        ctx2d.clearRect(0, 0, w, h);

        const style = getComputedStyle(canvas);
        // Фолбэки — на случай, если style.css почему-то не загрузился: без них canvas
        // получил бы пустую строку и не нарисовал вообще ничего.
        const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
        const playerColor = pick('--stg-doodlejump-player', '#6ca0dc');
        const eyeColor = pick('--stg-doodlejump-player-eye', '#14161b');
        const platformColor = pick('--stg-doodlejump-platform', '#888');
        const movingColor = pick('--stg-doodlejump-platform-moving', '#7fae5a');
        const crumblingColor = pick('--stg-doodlejump-platform-crumbling', '#b58a4a');
        const springColor = pick('--stg-doodlejump-spring', '#e0c34d');

        const cameraY = state.cameraY;
        const platformH = PLATFORM_H * scale;
        const worldTop = cameraY - PLATFORM_H;
        const worldBottom = cameraY + h / scale + PLATFORM_H;

        for (const platform of state.platforms) {
            // За краями экрана рисовать нечего: платформы генерируются далеко вверх про
            // запас, и без отсечения кадр тратился бы на невидимое.
            if (platform.y < worldTop || platform.y > worldBottom) continue;
            let color = platformColor;
            if (platform.kind === 'moving') color = movingColor;
            else if (platform.kind === 'crumbling') color = crumblingColor;
            else if (platform.kind === 'spring') color = springColor;
            const px = platform.x * scale;
            const top = (platform.y - cameraY) * scale;
            const pw = platform.w * scale;
            ctx2d.fillStyle = color;
            // Сломанная платформа остаётся видимой, но блёклой: игрок должен понимать,
            // что под ногами уже не опора.
            ctx2d.globalAlpha = platform.broken ? 0.35 : 1;
            fillBox(px, top, pw, platformH, platformH * 0.4);
            ctx2d.globalAlpha = 1;
            if (platform.broken) drawCracks(px, top, pw, platformH, crumblingColor);
            else if (platform.kind === 'spring') drawSpring(px, top, pw, scale, platformColor);
        }

        const player = state.player;
        const py = player.y - cameraY;
        drawPlayer(player.x, py, player.facing, scale, playerColor, eyeColor);
        // Wrap-копия у противоположного края: ядро (overlapsX) считает фигурку, свисающую
        // за правый край, стоящей и слева тоже — отрисовка обязана показывать то же
        // самое, иначе прыжок «из воздуха» выглядел бы багом.
        if (player.x + PLAYER_W > WORLD_W) {
            drawPlayer(player.x - WORLD_W, py, player.facing, scale, playerColor, eyeColor);
        } else if (player.x < 0) {
            drawPlayer(player.x + WORLD_W, py, player.facing, scale, playerColor, eyeColor);
        }
    }

    return {
        root,
        canvas,
        draw,
        destroy() {
            root.remove();
        },
    };
}
