// Управление «Дудл Джампом»: клавиатура (capture-фаза на document, пока смонтирован
// экран), экранные кнопки влево/вправо и ведение пальцем по полю.
//
// Отличие от змейки: ввод не дискретный ход, а непрерывное намерение — клавиша держится,
// фигурка едет. Поэтому нужны и keydown, и keyup, а направление выводится из ДВУХ флагов
// (leftDown/rightDown), а не из «последней нажатой клавиши»: при оверлапе нажатий
// (левая ещё зажата, правую уже отпустили) хранение «последнего» дало бы рывок не в ту
// сторону. Autorepeat браузера при этом безвреден — повторный keydown просто ставит уже
// стоящий флаг.
//
// Гасятся только обработанные клавиши, Esc не трогаем: его получает попап и закрывает
// окно целиком. «Обработанные» — это в том числе Enter и Space, на которые экран мог и не
// отреагировать: пауза при открытой витрине выходит сразу, рестарт — пока партия жива.
// Поэтому onPause() и onRestart() возвращают признак «сделал», и preventDefault ставится
// только по нему. Иначе Space съедался бы всегда — и список скинов в витрине переставал
// прокручиваться пробелом, не получая взамен ничего (правило 4 docs/games.md).

import { PLAYER_W, WORLD_W } from '../core/engine.js';

const LEFT_KEYS = new Set(['ArrowLeft', 'a', 'A', 'ф', 'Ф']);
const RIGHT_KEYS = new Set(['ArrowRight', 'd', 'D', 'в', 'В']);
const PAUSE_KEYS = new Set([' ', 'p', 'P', 'з', 'З']);

function isInteractiveTarget(e) {
    const target = e.target;
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName?.toLowerCase();
    return tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea';
}

// Слушателей у этой игры заметно больше, чем у змейки (keydown + keyup + пять событий на
// каждую кнопку), и забыть один при снятии — вопрос времени. Поэтому регистрация идёт
// через общий список: destroy() проходит по нему и снимает всё, что было навешано.
function listenerBag() {
    const listeners = [];
    return {
        on(target, type, handler, options) {
            target.addEventListener(type, handler, options);
            listeners.push({ target, type, handler, options });
        },
        off() {
            for (const { target, type, handler, options } of listeners) {
                target.removeEventListener(type, handler, options);
            }
            listeners.length = 0;
        },
    };
}

export function attachKeyboard({ onInput, onPause, onRestart }) {
    const bag = listenerBag();
    let leftDown = false;
    let rightDown = false;

    function emit() {
        onInput((rightDown ? 1 : 0) + (leftDown ? -1 : 0));
    }

    function onKeyDown(e) {
        // Интерактивные элементы (кнопки экрана, поле чата) должны сами решать, как
        // реагировать на Enter/Space: иначе Space на кнопке «влево» ставил бы паузу.
        if (isInteractiveTarget(e)) return;
        if (LEFT_KEYS.has(e.key) || RIGHT_KEYS.has(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            if (LEFT_KEYS.has(e.key)) leftDown = true;
            else rightDown = true;
            emit();
        } else if (PAUSE_KEYS.has(e.key)) {
            if (!onPause()) return;
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key === 'Enter') {
            if (!onRestart()) return;
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function onKeyUp(e) {
        if (!LEFT_KEYS.has(e.key) && !RIGHT_KEYS.has(e.key)) return;
        // Флаг снимается ВСЕГДА, даже если фокус успел уехать на кнопку или в поле чата:
        // иначе «зажал стрелку → кликнул по кнопке → отпустил стрелку» оставляло бы
        // направление залипшим до следующего нажатия. А вот гасить событие в таком случае
        // нельзя — preventDefault уедет элементу, который его не ждёт (нажатие там тоже
        // не гасилось).
        if (LEFT_KEYS.has(e.key)) leftDown = false;
        else rightDown = false;
        emit();
        if (isInteractiveTarget(e)) return;
        e.preventDefault();
        e.stopPropagation();
    }

    bag.on(document, 'keydown', onKeyDown, true);
    bag.on(document, 'keyup', onKeyUp, true);

    return {
        // Потеря фокуса вкладкой съедает keyup зажатой клавиши — браузер его просто не
        // пришлёт. Экран зовёт release() на blur, чтобы после возврата фигурка не ехала
        // сама по себе в сторону, которую игрок давно отпустил.
        release() {
            leftDown = false;
            rightDown = false;
            emit();
        },
        destroy() {
            leftDown = false;
            rightDown = false;
            bag.off();
        },
    };
}

// Экранные кнопки — по той же причине, что d-pad змейки: игра одной рукой на телефоне и
// паритет с десктопом. Флаги, а не «последнее событие»: те же грабли гонки, что у
// клавиатуры, и то же решение.
export function createButtons({ onInput }) {
    const bag = listenerBag();
    const root = document.createElement('div');
    root.className = 'doodlejump-buttons';

    let leftDown = false;
    let rightDown = false;

    function emit() {
        onInput((rightDown ? 1 : 0) + (leftDown ? -1 : 0));
    }

    function makeButton(side, label, aria) {
        const btn = document.createElement('button');
        btn.className = `doodlejump-btn doodlejump-btn-${side}`;
        btn.type = 'button';
        btn.textContent = label;
        btn.setAttribute('aria-label', aria);
        btn.tabIndex = 0;

        const set = (down) => {
            if (side === 'left') leftDown = down;
            else rightDown = down;
            emit();
        };

        // mousedown, а не click: click уводит фокус с корня окна на кнопку, а держать
        // направление нужно ровно пока палец/кнопка мыши прижаты.
        const press = (e) => {
            e.preventDefault();
            set(true);
        };
        const release = (e) => {
            e.preventDefault();
            set(false);
        };

        bag.on(btn, 'mousedown', press);
        bag.on(btn, 'mouseup', release);
        // Увести курсор с зажатой кнопки — то же, что отпустить: без этого направление
        // «залипало» бы до следующего клика.
        bag.on(btn, 'mouseleave', release);
        bag.on(btn, 'touchstart', press, { passive: false });
        bag.on(btn, 'touchend', release, { passive: false });
        bag.on(btn, 'touchcancel', release, { passive: false });

        root.appendChild(btn);
        return btn;
    }

    makeButton('left', '◀', 'Влево');
    makeButton('right', '▶', 'Вправо');

    return {
        root,
        // Симметрично клавиатуре: уход со вкладки с прижатым пальцем не даёт touchend.
        release() {
            leftDown = false;
            rightDown = false;
            emit();
        },
        destroy() {
            leftDown = false;
            rightDown = false;
            bag.off();
            root.remove();
        },
    };
}

// Ведение пальцем по полю — аналоговый ввод там, где кнопки дают только «на полную».
// Модель: палец говорит, ГДЕ должна быть фигурка. Она внизу-по-центру, палец естественно
// ложится ниже неё и её не закрывает, поэтому «где палец — туда и фигурка» читается без
// обучения; свайп-дельта такого не даёт.
//
// Намерение = доля расстояния до цели: далеко — полный ход, рядом — плавное подведение и
// остановка. Пересчитывается КАЖДЫЙ кадр через update(), а не только по pointermove:
// фигурка едет, палец стоит — расстояние меняется само, и без пересчёта она проскочила бы
// цель.
//
// touch-action: none на .doodlejump-canvas уже стоит, так что страница под пальцем
// не поедет.

// Полный ход дальше этого расстояния до цели, wu.
const STEER_ZONE = 60;
// Ближе этого фигурка считается приехавшей: иначе она дрожала бы под пальцем.
const STEER_DEAD_ZONE = 2;

export function createDrag({ canvas, getPlayerX, onInput }) {
    const bag = listenerBag();
    let pointerId = null;
    let clientX = 0;

    function intent() {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width) return 0;
        const desired = (clientX - rect.left) * (WORLD_W / rect.width);
        const delta = desired - (getPlayerX() + PLAYER_W / 2);
        if (Math.abs(delta) <= STEER_DEAD_ZONE) return 0;
        return Math.max(-1, Math.min(1, delta / STEER_ZONE));
    }

    // Пока палец на поле, он задаёт намерение целиком; отпустили — null, и экран
    // возвращается к сумме клавиатуры и кнопок.
    function emit() {
        onInput(pointerId === null ? null : intent());
    }

    function onPointerDown(e) {
        if (pointerId !== null) return; // второй палец не перехватывает управление
        pointerId = e.pointerId;
        clientX = e.clientX;
        e.preventDefault();
        // Захват — удобство (палец может уехать за край поля), а не необходимость:
        // в jsdom и на мыши его может не быть вовсе.
        try { canvas.setPointerCapture?.(e.pointerId); } catch { /* не судьба */ }
        emit();
    }

    function onPointerMove(e) {
        if (e.pointerId !== pointerId) return;
        clientX = e.clientX;
        e.preventDefault();
        emit();
    }

    // pointercancel прилетает от звонка, шторки и жеста системы — молча оставить
    // намерение висеть нельзя, иначе фигурка поедет сама.
    function onPointerUp(e) {
        if (e.pointerId !== pointerId) return;
        pointerId = null;
        try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* уже отпущен */ }
        emit();
    }

    bag.on(canvas, 'pointerdown', onPointerDown);
    bag.on(canvas, 'pointermove', onPointerMove);
    bag.on(canvas, 'pointerup', onPointerUp);
    bag.on(canvas, 'pointercancel', onPointerUp);
    // Те же два обработчика ещё и на документе. Захват указателя — «удобство, а не
    // необходимость» (см. выше), и там, где его нет, палец, уехавший за край поля и
    // отпущенный снаружи, не давал канвасу НИ ОДНОГО события: намерение оставалось
    // висеть, а оно старше клавиатуры и кнопок — управление становилось мёртвым до
    // следующего тапа по полю. Проверка по pointerId остаётся: чужой палец, отпущенный
    // где-то ещё, ведущего не отменяет. Когда захват работает, событие приходит дважды
    // (канвас, потом всплытие) — второй раз выходит по той же проверке.
    bag.on(document, 'pointerup', onPointerUp);
    bag.on(document, 'pointercancel', onPointerUp);

    return {
        // Зовётся каждый кадр: цель не двигалась, а фигурка — да.
        update() {
            if (pointerId !== null) emit();
        },
        isActive() {
            return pointerId !== null;
        },
        // Симметрично клавиатуре и кнопкам: уход со вкладки с прижатым пальцем
        // pointerup не даёт.
        release() {
            if (pointerId === null) return;
            pointerId = null;
            emit();
        },
        destroy() {
            pointerId = null;
            bag.off();
        },
    };
}
