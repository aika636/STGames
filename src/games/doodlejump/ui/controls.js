// Управление «Дудл Джампом»: клавиатура (capture-фаза на document, пока смонтирован
// экран) и экранные кнопки влево/вправо.
//
// Отличие от змейки: ввод не дискретный ход, а непрерывное намерение — клавиша держится,
// фигурка едет. Поэтому нужны и keydown, и keyup, а направление выводится из ДВУХ флагов
// (leftDown/rightDown), а не из «последней нажатой клавиши»: при оверлапе нажатий
// (левая ещё зажата, правую уже отпустили) хранение «последнего» дало бы рывок не в ту
// сторону. Autorepeat браузера при этом безвреден — повторный keydown просто ставит уже
// стоящий флаг.
//
// Гасятся только обработанные клавиши, Esc не трогаем: его получает попап и закрывает
// окно целиком.

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
            e.preventDefault();
            e.stopPropagation();
            onPause();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onRestart();
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
