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

// «Кристалл»: ромб без единой скруглённой стороны — силуэт целиком из прямых, острый
// сверху и снизу, ни на что круглое не похожий. Направление даёт грань-блик: она всегда
// на той стороне, куда смотрит фигурка, и подпирается сдвинутыми туда же глазами.
function drawCrystal(ctx2d, x, y, w, h, facing, colors) {
    const cx = x + w / 2;
    const waist = y + h * 0.36;

    ctx2d.fillStyle = colors.body;
    ctx2d.beginPath();
    ctx2d.moveTo(cx, y);
    ctx2d.lineTo(x + w, waist);
    ctx2d.lineTo(cx, y + h);
    ctx2d.lineTo(x, waist);
    ctx2d.fill();

    // Блик — треугольник от вершины к «плечу» и к центру: одна светлая грань из четырёх.
    const shoulder = facing < 0 ? x : x + w;
    ctx2d.fillStyle = colors.facet;
    ctx2d.beginPath();
    ctx2d.moveTo(cx, y);
    ctx2d.lineTo(shoulder, waist);
    ctx2d.lineTo(cx, y + h * 0.62);
    ctx2d.fill();

    const eyeY = y + h * 0.44;
    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, cx + (facing < 0 ? -w * 0.16 : w * 0.16), eyeY, w * 0.075);
    dot(ctx2d, cx + (facing < 0 ? -w * 0.02 : w * 0.02), eyeY, w * 0.075);
}

// «Капля»: широкое круглое дно и острый носик сверху, завалившийся по ходу движения.
// Верх-низ у неё несимметричны — этим и отличается от ромба со звездой, а наклон носика
// показывает направление раньше, чем разглядишь глаза.
function drawDrop(ctx2d, x, y, w, h, facing, colors) {
    const r = w * 0.42;
    const cx = x + w / 2;
    const cy = y + h - r * 1.02;

    ctx2d.fillStyle = colors.body;
    // Носик отдельной заливкой поверх круга: объединение двух простых фигур читается как
    // одна капля и не требует кривых, которых нет в jsdom-заглушке контекста.
    ctx2d.beginPath();
    ctx2d.moveTo(cx + (facing < 0 ? -w * 0.2 : w * 0.2), y);
    ctx2d.lineTo(cx - r * 0.72, cy - r * 0.5);
    ctx2d.lineTo(cx + r * 0.72, cy - r * 0.5);
    ctx2d.fill();
    dot(ctx2d, cx, cy, r);

    const eyeY = cy - r * 0.18;
    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, cx + (facing < 0 ? -r * 0.5 : r * 0.06), eyeY, w * 0.085);
    dot(ctx2d, cx + (facing < 0 ? -r * 0.06 : r * 0.5), eyeY, w * 0.085);
}

// «Звезда»: пять лучей — контур с провалами между вершинами, единственный такой в наборе:
// у всех остальных силуэт выпуклый. Наклон всей звезды по facing работает как поза «несёт
// вперёд», глаза в середине подтверждают направление.
function drawStar(ctx2d, x, y, w, h, facing, colors) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const outer = Math.min(w, h) * 0.5;
    const inner = outer * 0.44;
    const tilt = (facing < 0 ? -1 : 1) * 0.22;

    ctx2d.fillStyle = colors.body;
    ctx2d.beginPath();
    for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + tilt + (i * Math.PI) / 5;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        if (i === 0) ctx2d.moveTo(px, py);
        else ctx2d.lineTo(px, py);
    }
    ctx2d.fill();

    const eyeY = cy + h * 0.02;
    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, cx + (facing < 0 ? -w * 0.15 : w * 0.02), eyeY, w * 0.07);
    dot(ctx2d, cx + (facing < 0 ? -w * 0.02 : w * 0.15), eyeY, w * 0.07);
}

// «Краб»: приземистое тело с выступами по краям — клешни сверху и лапы по бокам. Контур
// рваный не снизу (как у призрака), а по всему периметру, и держится ниже центра габарита.
// Направление показывает поднятая клешня: она всегда с той стороны, куда смотрит краб.
function drawCrab(ctx2d, x, y, w, h, facing, colors) {
    const bodyTop = y + h * 0.42;
    const bodyH = h * 0.36;
    const cy = bodyTop + bodyH / 2;

    // Лапы — три косые линии с каждой стороны, торчат за габарит тела.
    ctx2d.strokeStyle = colors.limb;
    ctx2d.lineWidth = Math.max(1, w * 0.06);
    ctx2d.beginPath();
    for (const k of [0.15, 0.5, 0.85]) {
        const ly = bodyTop + bodyH * k;
        ctx2d.moveTo(x + w * 0.22, ly);
        ctx2d.lineTo(x, ly + h * 0.14);
        ctx2d.moveTo(x + w * 0.78, ly);
        ctx2d.lineTo(x + w, ly + h * 0.14);
    }
    ctx2d.stroke();

    ctx2d.fillStyle = colors.body;
    fillBox(ctx2d, x + w * 0.12, bodyTop, w * 0.76, bodyH, bodyH * 0.45);

    // Клешни: ближняя к направлению взгляда крупнее и выше — по ней и читается facing.
    ctx2d.fillStyle = colors.limb;
    const nearX = facing < 0 ? x + w * 0.12 : x + w * 0.88;
    const farX = facing < 0 ? x + w * 0.88 : x + w * 0.12;
    dot(ctx2d, nearX, y + h * 0.24, w * 0.16);
    dot(ctx2d, farX, y + h * 0.36, w * 0.11);

    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, x + w * (facing < 0 ? 0.34 : 0.5), cy - bodyH * 0.12, w * 0.075);
    dot(ctx2d, x + w * (facing < 0 ? 0.5 : 0.66), cy - bodyH * 0.12, w * 0.075);
}

// «Месяц»: единственный вогнутый силуэт набора — серп с дырой посередине, сквозь которую
// видно поле. Вырез уводится назад, поэтому толстая доля всегда впереди: получается
// «нос по ходу движения», и facing читается по одной только форме.
function drawMoon(ctx2d, x, y, w, h, facing, colors) {
    const outer = Math.min(w, h) / 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const inner = outer * 0.82;
    const shift = (facing < 0 ? 1 : -1) * outer * 0.62;

    // Два круга в одном пути и заливка по правилу evenodd: внутренний вырезает серп.
    // Отдельный moveTo перед вторым кругом обязателен — иначе браузер соединил бы дуги
    // хордой и вырез поехал бы.
    ctx2d.fillStyle = colors.body;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx2d.moveTo(cx + shift + inner, cy);
    ctx2d.arc(cx + shift, cy, inner, 0, Math.PI * 2);
    ctx2d.fill('evenodd');

    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, cx + (facing < 0 ? -outer * 0.6 : outer * 0.6), cy - outer * 0.28, w * 0.075);
}

// Порядок в списке — порядок плиток в магазине: сначала бесплатный, дальше по цене.
//
// Цены: 0 / 25 / 60 / 105 / 160 / 225 / 300 / 385 — шаг растёт ровно на 10 монет
// (25, 35, 45, 55, 65, 75, 85). Заезд при coinChance ≈ 0.3 на этаж приносит порядка
// двух-трёх десятков монет, так что первые скины берутся за заезд-другой, а самый дорогой
// — примерно за полтора десятка: копить есть смысл, но потолок не уходит за горизонт.
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
    Object.freeze({
        id: 'crystal',
        title: 'Кристалл',
        price: 105,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-crystal', '#7ad0e8'],
            facet: ['--stg-doodlejump-skin-crystal-facet', '#cdf3fb'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawCrystal,
    }),
    Object.freeze({
        id: 'drop',
        title: 'Капля',
        price: 160,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-drop', '#77d18a'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawDrop,
    }),
    Object.freeze({
        id: 'star',
        title: 'Звезда',
        price: 225,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-star', '#f0c548'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawStar,
    }),
    Object.freeze({
        id: 'crab',
        title: 'Краб',
        price: 300,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-crab', '#e07a4d'],
            limb: ['--stg-doodlejump-skin-crab-limb', '#f2a071'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawCrab,
    }),
    Object.freeze({
        id: 'moon',
        title: 'Месяц',
        price: 385,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-moon', '#f2e8b0'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawMoon,
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
