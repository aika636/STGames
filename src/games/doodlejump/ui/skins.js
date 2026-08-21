// Реестр скинов фигурки «Дудл Джампа» (docs/plan-doodlejump-fixes.md §G.3).
//
// Скин — это функция отрисовки плюс набор цветов, а не картинка: расширение без сборки не
// таскает спрайты, а форма, нарисованная примитивами, одинаково читается при любом DPI и
// на любой теме.
//
// Контракт формы: draw(ctx2d, x, y, w, h, facing, colors) рисует фигурку в габарите
// w × h (это PLAYER_W × PLAYER_H в device-пикселях) от левого верхнего угла (x, y);
// facing < 0 — смотрит влево, иначе вправо; colors — уже разрешённые цвета палитры
// (см. resolveColors ниже), ключи те же, что в skin.palette.
//
// Ядро о скинах не знает вообще: реестр живёт в ui/, а покупку и надевание считает
// core/wallet.js, которому цену передаёт вызывающий. Поэтому цены лежат здесь, рядом с
// формой, а не в чистом модуле.
//
// Цвета — только имена переменных слоя --stg-doodlejump-* с литеральным фолбэком: до
// канваса значение доезжает строкой, поэтому в самой палитре нет color-mix (см. шапку
// view.js).

import { DEFAULT_SKIN } from '../core/wallet.js';

// Скруглённый прямоугольник там, где браузер это умеет, и обычный там, где нет (в том
// числе в jsdom-заглушке 2d-контекста). Общий примитив форм: им рисуют и скины, и
// платформы во view.js, поэтому он лежит здесь, а не в замыкании одного из них.
export function fillBox(ctx2d, x, y, w, h, radius) {
    if (typeof ctx2d.roundRect === 'function') {
        ctx2d.beginPath();
        ctx2d.roundRect(x, y, w, h, radius);
        ctx2d.fill();
        return;
    }
    ctx2d.fillRect(x, y, w, h);
}

function dot(ctx2d, cx, cy, r) {
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
    ctx2d.fill();
}

// Форма по умолчанию — та самая фигурка, что была в игре до магазина: скруглённый
// прямоугольник и два глаза-точки, смотрящие по facing. Точки, а не зрачки: на 40 wu
// ширины больше и не читалось бы.
function drawDefault(ctx2d, x, y, w, h, facing, colors) {
    ctx2d.fillStyle = colors.body;
    fillBox(ctx2d, x, y, w, h, Math.min(w, h) * 0.3);

    const r = w * 0.09;
    const eyeY = y + h * 0.34;
    const near = facing < 0 ? x + w * 0.24 : x + w * 0.6;
    const far = facing < 0 ? x + w * 0.44 : x + w * 0.8;
    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, near, eyeY, r);
    dot(ctx2d, far, eyeY, r);
}

// «НЛО»: широкий плоский корпус и купол сверху — силуэт лежачий, а не стоячий, и его не
// спутать с прыгуном даже боковым зрением. Пилот в куполе смещён по facing: у тарелки нет
// «лица», и направление показывает он.
function drawUfo(ctx2d, x, y, w, h, facing, colors) {
    const hullTop = y + h * 0.52;
    const hullH = h * 0.3;
    ctx2d.fillStyle = colors.body;
    fillBox(ctx2d, x, hullTop, w, hullH, hullH * 0.5);
    // Юбка под корпусом — уже и ниже: даёт тарелке толщину, а не блин.
    fillBox(ctx2d, x + w * 0.22, hullTop + hullH * 0.75, w * 0.56, h * 0.14, h * 0.07);

    ctx2d.fillStyle = colors.dome;
    fillBox(ctx2d, x + w * 0.26, y + h * 0.18, w * 0.48, h * 0.42, w * 0.24);

    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, x + w * (facing < 0 ? 0.4 : 0.6), y + h * 0.36, w * 0.08);
    // Огни по нижнему краю корпуса — три точки, читаются как «летит», а не «лежит».
    const lightY = hullTop + hullH * 0.55;
    for (const k of [0.18, 0.5, 0.82]) dot(ctx2d, x + w * k, lightY, w * 0.055);
}

// «Призрак»: круглая макушка и рваный подол из трёх зубцов — контур без единой прямой
// стороны, самый непохожий на прямоугольник из трёх. Рисуется одним путём, без
// closePath(): fill() и так замыкает контур сам.
function drawGhost(ctx2d, x, y, w, h, facing, colors) {
    const r = w / 2;
    const hemY = y + r;
    const bottom = y + h;
    const tooth = h * 0.12;

    ctx2d.fillStyle = colors.body;
    ctx2d.beginPath();
    ctx2d.arc(x + r, hemY, r, Math.PI, 0);
    ctx2d.moveTo(x + w, hemY);
    ctx2d.lineTo(x + w, bottom);
    ctx2d.lineTo(x + w * 0.83, bottom - tooth);
    ctx2d.lineTo(x + w * 0.66, bottom);
    ctx2d.lineTo(x + w * 0.5, bottom - tooth);
    ctx2d.lineTo(x + w * 0.34, bottom);
    ctx2d.lineTo(x + w * 0.17, bottom - tooth);
    ctx2d.lineTo(x, bottom);
    ctx2d.lineTo(x, hemY);
    ctx2d.fill();

    const eyeY = y + h * 0.36;
    const near = facing < 0 ? x + w * 0.2 : x + w * 0.56;
    const far = facing < 0 ? x + w * 0.44 : x + w * 0.8;
    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, near, eyeY, w * 0.11);
    dot(ctx2d, far, eyeY, w * 0.11);
}

// Порядок в списке — порядок плиток в магазине: сначала бесплатный, дальше по цене.
export const SKINS = Object.freeze([
    Object.freeze({
        id: DEFAULT_SKIN,
        title: 'Прыгун',
        price: 0,
        palette: Object.freeze({
            body: ['--stg-doodlejump-player', '#6ca0dc'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawDefault,
    }),
    Object.freeze({
        id: 'ufo',
        title: 'НЛО',
        price: 25,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-ufo', '#a8b0c0'],
            dome: ['--stg-doodlejump-skin-ufo-dome', '#8fe0d0'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawUfo,
    }),
    Object.freeze({
        id: 'ghost',
        title: 'Призрак',
        price: 60,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-ghost', '#d9d6e8'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawGhost,
    }),
]);

// Скин по id. Битый current (скин переименовали, настройки правили руками) не должен
// ронять отрисовку — падаем на бесплатный, он в реестре есть всегда.
export function getSkin(id) {
    return SKINS.find((skin) => skin.id === id)
        ?? SKINS.find((skin) => skin.id === DEFAULT_SKIN);
}

// Разрешает палитру скина через переданный pick(имя, фолбэк): и view.js, и превью в
// магазине уже держат свой getComputedStyle, второй здесь заводить незачем.
export function resolveColors(skin, pick) {
    const colors = {};
    for (const [key, [name, fallback]] of Object.entries(skin.palette)) {
        colors[key] = pick(name, fallback);
    }
    return colors;
}
