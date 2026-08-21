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
    // dir — куда уводится вырез (назад по ходу), base — та же сторона в углах пути.
    const dir = facing < 0 ? 1 : -1;
    const gap = outer * 0.62;
    const base = dir > 0 ? 0 : Math.PI;

    // Серп рисуется контуром из двух дуг, а не «двумя кругами с evenodd»: вырез шире
    // диска и торчит за его край, а evenodd залил бы этот торчащий кусок отдельной
    // линзой — её-то и обрезал край канваса в витрине магазина. Здесь путь идёт по
    // дуге диска СНАРУЖИ выреза, а обратно — по дуге выреза ВНУТРИ диска, между двумя
    // общими точками окружностей; за габарит w × h такой контур не выходит никогда.
    //
    // alpha — половина угла, под которым точки пересечения видны из центра диска,
    // beta — из центра выреза (теорема косинусов; clamp страхует от ошибки округления).
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const alpha = Math.acos(clamp((gap * gap + outer * outer - inner * inner) / (2 * gap * outer)));
    const beta = Math.acos(clamp((gap * gap + inner * inner - outer * outer) / (2 * gap * inner)));

    ctx2d.fillStyle = colors.body;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, outer, base + alpha, base + Math.PI * 2 - alpha);
    ctx2d.arc(cx + dir * gap, cy, inner, base - beta, base + beta, true);
    ctx2d.fill();

    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, cx + (facing < 0 ? -outer * 0.6 : outer * 0.6), cy - outer * 0.28, w * 0.075);
}

// «Лягушка»: приземистое тело, а над ним два круглых бугра-глаза — единственный силуэт
// набора, у которого габарит сверху занят не корпусом, а выступами; снизу из-под тела
// торчат четыре лапы. Направление даёт язык: он выстреливает изо рта в сторону взгляда и
// виден раньше, чем разглядишь сдвинутые туда же зрачки.
function drawFrog(ctx2d, x, y, w, h, facing, colors) {
    const bodyTop = y + h * 0.44;
    const bodyH = h * 0.4;

    // Лапы рисуются до тела: их основания уходят под корпус и не мозолят глаз.
    // Толщина линии вылезает наружу пути на половину, поэтому концы держатся от края.
    ctx2d.strokeStyle = colors.body;
    ctx2d.lineWidth = Math.max(1, w * 0.07);
    ctx2d.beginPath();
    for (const side of [-1, 1]) {
        const inner = x + w * (side < 0 ? 0.3 : 0.7);
        ctx2d.moveTo(inner, bodyTop + bodyH * 0.5);
        ctx2d.lineTo(x + w * (side < 0 ? 0.07 : 0.93), y + h * 0.93);
        ctx2d.moveTo(inner, bodyTop + bodyH * 0.8);
        ctx2d.lineTo(x + w * (side < 0 ? 0.32 : 0.68), y + h * 0.95);
    }
    ctx2d.stroke();

    ctx2d.fillStyle = colors.body;
    fillBox(ctx2d, x + w * 0.14, bodyTop, w * 0.72, bodyH, bodyH * 0.45);
    // Бугры-глаза сидят выше корпуса и шире его краёв — по ним лягушка и узнаётся.
    dot(ctx2d, x + w * 0.27, y + h * 0.29, w * 0.16);
    dot(ctx2d, x + w * 0.73, y + h * 0.29, w * 0.16);

    ctx2d.fillStyle = colors.eye;
    const pupil = facing < 0 ? -w * 0.05 : w * 0.05;
    dot(ctx2d, x + w * 0.27 + pupil, y + h * 0.29, w * 0.07);
    dot(ctx2d, x + w * 0.73 + pupil, y + h * 0.29, w * 0.07);

    const tipX = x + w * (facing < 0 ? 0.08 : 0.92);
    const tipY = y + h * 0.7;
    ctx2d.strokeStyle = colors.tongue;
    ctx2d.lineWidth = Math.max(1, w * 0.06);
    ctx2d.beginPath();
    ctx2d.moveTo(x + w * 0.5, bodyTop + bodyH * 0.45);
    ctx2d.lineTo(tipX, tipY);
    ctx2d.stroke();
    ctx2d.fillStyle = colors.tongue;
    dot(ctx2d, tipX, tipY, w * 0.045);
}

// «Снежинка»: шесть лучей с парными ответвлениями — силуэт вообще без сплошного тела,
// одни колючки, и спутать его не с чем. Направление показывает передний луч: он один
// заканчивается наконечником-стрелкой, остальные ветвятся ёлочкой к центру.
function drawSnowflake(ctx2d, x, y, w, h, facing, colors) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const R = Math.min(w, h) * 0.44;
    const dir = facing < 0 ? Math.PI : 0;

    ctx2d.strokeStyle = colors.body;
    ctx2d.lineWidth = Math.max(1, w * 0.055);
    ctx2d.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const ex = cx + Math.cos(a) * R;
        const ey = cy + Math.sin(a) * R;
        ctx2d.moveTo(cx, cy);
        ctx2d.lineTo(ex, ey);

        const front = Math.abs(Math.cos(a - dir) - 1) < 0.001;
        if (front) {
            // Наконечник: две штриха от кончика назад-наружу — стрелка по ходу движения.
            for (const s of [-1, 1]) {
                ctx2d.moveTo(ex, ey);
                ctx2d.lineTo(
                    ex + Math.cos(a + Math.PI + s * 0.6) * R * 0.34,
                    ey + Math.sin(a + Math.PI + s * 0.6) * R * 0.34,
                );
            }
            continue;
        }
        for (const at of [0.5, 0.78]) {
            const bx = cx + Math.cos(a) * R * at;
            const by = cy + Math.sin(a) * R * at;
            for (const s of [-1, 1]) {
                ctx2d.moveTo(bx, by);
                ctx2d.lineTo(
                    bx + Math.cos(a + s * 0.7) * R * 0.26,
                    by + Math.sin(a + s * 0.7) * R * 0.26,
                );
            }
        }
    }
    ctx2d.stroke();

    ctx2d.fillStyle = colors.body;
    dot(ctx2d, cx, cy, w * 0.13);

    ctx2d.fillStyle = colors.eye;
    const near = facing < 0 ? -w * 0.09 : w * 0.01;
    dot(ctx2d, cx + near, cy - h * 0.01, w * 0.04);
    dot(ctx2d, cx + near + w * 0.08, cy - h * 0.01, w * 0.04);
}

// «Пакмэн»: круг с вырезанным сектором — единственная фигура, у которой facing читается
// самим контуром и ничем больше: рот всегда раскрыт по ходу движения. Рисуется одной
// дугой от края рта до края рта плюс точка-глаз ближе к затылку.
function drawPacman(ctx2d, x, y, w, h, facing, colors) {
    const R = Math.min(w, h) / 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const mouth = 0.42;
    const base = facing < 0 ? Math.PI : 0;

    ctx2d.fillStyle = colors.body;
    ctx2d.beginPath();
    // Из центра к верхней губе, дальше по дуге мимо затылка к нижней; fill() замкнёт.
    ctx2d.moveTo(cx, cy);
    ctx2d.lineTo(cx + Math.cos(base + mouth) * R, cy + Math.sin(base + mouth) * R);
    ctx2d.arc(cx, cy, R, base + mouth, base + Math.PI * 2 - mouth);
    ctx2d.fill();

    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, cx + (facing < 0 ? R * 0.22 : -R * 0.22), cy - R * 0.45, w * 0.075);
}

// «Черепок»: широкая коробка сверху, перехват и узкая челюсть снизу — талия, которой нет
// ни у призрака, ни у капли. Глазницы и нос сдвинуты вперёд, а по затылку идёт трещина:
// три признака facing разом, и на 40 wu хватает даже одного.
function drawSkull(ctx2d, x, y, w, h, facing, colors) {
    const cx = x + w / 2;
    const R = w * 0.4;
    const domeY = y + h * 0.42;
    const jaw = w * 0.26;
    const lean = facing < 0 ? -w * 0.04 : w * 0.04;

    ctx2d.fillStyle = colors.body;
    ctx2d.beginPath();
    ctx2d.arc(cx, domeY, R, Math.PI, 0);
    ctx2d.lineTo(cx + R, y + h * 0.58);
    ctx2d.lineTo(cx + jaw, y + h * 0.66);
    ctx2d.lineTo(cx + jaw, y + h * 0.95);
    ctx2d.lineTo(cx - jaw, y + h * 0.95);
    ctx2d.lineTo(cx - jaw, y + h * 0.66);
    ctx2d.lineTo(cx - R, y + h * 0.58);
    ctx2d.fill();

    ctx2d.fillStyle = colors.eye;
    dot(ctx2d, cx + lean - w * 0.17, y + h * 0.4, w * 0.125);
    dot(ctx2d, cx + lean + w * 0.17, y + h * 0.4, w * 0.125);
    // Нос — треугольник остриём вверх, тоже сдвинут по ходу взгляда.
    ctx2d.beginPath();
    ctx2d.moveTo(cx + lean, y + h * 0.52);
    ctx2d.lineTo(cx + lean + w * 0.055, y + h * 0.62);
    ctx2d.lineTo(cx + lean - w * 0.055, y + h * 0.62);
    ctx2d.fill();

    // Зубы: два штриха поперёк челюсти делят её на три — челюсть читается как челюсть.
    ctx2d.strokeStyle = colors.eye;
    ctx2d.lineWidth = Math.max(1, w * 0.045);
    ctx2d.beginPath();
    for (const k of [-0.33, 0.33]) {
        ctx2d.moveTo(cx + jaw * k, y + h * 0.72);
        ctx2d.lineTo(cx + jaw * k, y + h * 0.93);
    }
    // Трещина по затылку — ломаная на той стороне, куда череп НЕ смотрит.
    const back = facing < 0 ? 1 : -1;
    ctx2d.moveTo(cx + back * R * 0.42, y + h * 0.08);
    ctx2d.lineTo(cx + back * R * 0.64, y + h * 0.15);
    ctx2d.lineTo(cx + back * R * 0.48, y + h * 0.21);
    ctx2d.lineTo(cx + back * R * 0.72, y + h * 0.27);
    ctx2d.stroke();
}

// Порядок в списке — порядок плиток в магазине: сначала бесплатный, дальше по цене.
//
// Цены: 0 / 25 / 60 / 105 / 160 / 225 / 300 / 385 / 480 / 585 / 700 / 825 — шаг растёт
// ровно на 10 монет (25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 125). Заезд при
// coinChance ≈ 0.3 на этаж приносит порядка двух-трёх десятков монет, так что первые скины
// берутся за заезд-другой, а самый дорогой — за три десятка: копить есть смысл, но и
// последняя плитка витрины остаётся достижимой целью, а не украшением.
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
    Object.freeze({
        id: 'frog',
        title: 'Лягушка',
        price: 480,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-frog', '#6cbf5a'],
            tongue: ['--stg-doodlejump-skin-frog-tongue', '#e07a92'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawFrog,
    }),
    Object.freeze({
        id: 'snowflake',
        title: 'Снежинка',
        price: 585,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-snowflake', '#b6e3f5'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawSnowflake,
    }),
    Object.freeze({
        id: 'pacman',
        title: 'Пакмэн',
        price: 700,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-pacman', '#f2d34a'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawPacman,
    }),
    Object.freeze({
        id: 'skull',
        title: 'Черепок',
        price: 825,
        palette: Object.freeze({
            body: ['--stg-doodlejump-skin-skull', '#e6e2d4'],
            eye: ['--stg-doodlejump-player-eye', '#14161b'],
        }),
        draw: drawSkull,
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
