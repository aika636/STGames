// Ввод балды с клавиатуры: физическая (с чужой раскладкой) и экранная раскладка.
//
// Модуль знает про DOM, но ничего не знает ни о партии, ни о SillyTavern: наружу он
// отдаёт три события — буква, подтверждение хода, отмена шага.
//
// Две вещи, ради которых этот файл существует отдельно от экрана:
//
//   1. Раскладка ОС. `event.key` даёт букву по ТЕКУЩЕЙ раскладке: у игрока с EN придёт
//      `f` вместо «а». Разрешение двухступенчатое — если key уже кириллица, берём её;
//      иначе `event.code` через таблицу позиций ЙЦУКЕН (KeyF → А). Приём взят из
//      «Слов» и скопирован, а не импортирован: игры в проекте друг у друга ничего не
//      берут, иначе правка ввода одной молча меняет другую.
//   2. Экранная клавиатура ОБЯЗАТЕЛЬНА, а не опциональна: в окне игры нет ни одного
//      поля ввода, поэтому на телефоне системная клавиатура не появится вовсе и букву
//      физически нечем поставить. Завести настоящий <input> ради неё нельзя — фокус
//      попапа ST уедет в него при открытии.

import { LETTERS, normalize } from '../core/engine.js';

/** Что игрок сделал. Одно и то же для тапа по экранной клавише и для физической. */
export const LETTER = 'letter';
export const SUBMIT = 'submit';
export const UNDO = 'undo';

// Позиции ЙЦУКЕН по физическим клавишам. Backquote — «ё», и она сразу мапится в Е:
// буквы «ё» в игре не существует нигде (см. core/engine.js → normalize).
const CODE_TO_LETTER = Object.freeze({
    Backquote: 'Е',
    KeyQ: 'Й', KeyW: 'Ц', KeyE: 'У', KeyR: 'К', KeyT: 'Е', KeyY: 'Н',
    KeyU: 'Г', KeyI: 'Ш', KeyO: 'Щ', KeyP: 'З', BracketLeft: 'Х', BracketRight: 'Ъ',
    KeyA: 'Ф', KeyS: 'Ы', KeyD: 'В', KeyF: 'А', KeyG: 'П', KeyH: 'Р',
    KeyJ: 'О', KeyK: 'Л', KeyL: 'Д', Semicolon: 'Ж', Quote: 'Э',
    KeyZ: 'Я', KeyX: 'Ч', KeyC: 'С', KeyV: 'М', KeyB: 'И', KeyN: 'Т',
    KeyM: 'Ь', Comma: 'Б', Period: 'Ю',
});

// Экранная раскладка: те же три ряда, что в «Словах» (12 + 11 + 9), но без ⏎ и ⌫ —
// подтверждение и отмена живут кнопками под полем, рядом с «Пас»: в балде это действия
// над ходом, а не над строкой, и на клавиатуре их искали бы дольше.
const ROWS = Object.freeze([
    Object.freeze([...'ЙЦУКЕНГШЩЗХЪ']),
    Object.freeze([...'ФЫВАПРОЛДЖЭ']),
    Object.freeze([...'ЯЧСМИТЬБЮ']),
]);

/**
 * Что означает нажатие клавиши.
 *
 * @returns {{ action: string, letter?: string }|null} null — клавиша не наша,
 *          её нельзя ни гасить, ни обрабатывать.
 */
export function resolveKey(event) {
    // Комбинации отдаём таверне целиком: иначе съедим её хоткеи.
    if (event.ctrlKey || event.altKey || event.metaKey) return null;

    if (event.key === 'Enter') return { action: SUBMIT };
    if (event.key === 'Backspace') return { action: UNDO };

    // Шаг 1 — раскладка уже русская: буква приходит прямо в key.
    if (typeof event.key === 'string' && event.key.length === 1) {
        const letter = normalize(event.key);
        if (LETTERS.includes(letter)) return { action: LETTER, letter };
    }

    // Шаг 2 — раскладка чужая: берём позицию клавиши на физической ЙЦУКЕН.
    const byCode = CODE_TO_LETTER[event.code];
    if (byCode) return { action: LETTER, letter: byCode };

    return null;
}

function isTextField(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea';
}

/**
 * Физическая клавиатура. Слушатель висит на document в фазе перехвата и живёт только
 * пока открыт экран игры; гасятся ТОЛЬКО съеденные клавиши — 32 буквы, Enter и
 * Backspace. Esc не трогаем вовсе: его получает попап и закрывает окно (правило 3).
 */
export function attachKeyboard(handlers = {}) {
    const onKeyDown = (event) => {
        // В текстовых полях (поле ввода чата, поиск ST) игрок печатает — не мешаем.
        if (isTextField(event.target)) return;

        const hit = resolveKey(event);
        if (!hit) return;

        // Ради этих двух строк слушатель и висит в capture: иначе буква уедет в чат.
        event.preventDefault();
        event.stopPropagation();
        dispatch(hit, handlers);
    };

    document.addEventListener('keydown', onKeyDown, true);

    return {
        destroy() {
            document.removeEventListener('keydown', onKeyDown, true);
        },
    };
}

// Единственная точка, через которую проходят и тап, и физическая клавиша: две ветки
// с одинаковыми правилами разъезжаются на первой же правке.
function dispatch(hit, handlers) {
    if (hit.action === LETTER) handlers.onLetter?.(hit.letter);
    else if (hit.action === SUBMIT) handlers.onSubmit?.();
    else if (hit.action === UNDO) handlers.onUndo?.();
}

/**
 * Экранная клавиатура из 32 букв.
 *
 * Клавиши — <button type="button"> с tabindex="-1": 32 кнопки в Tab-порядке попапа —
 * ровно та проблема, из-за которой клетки реверси сделаны div'ами.
 *
 * @returns {{ root: HTMLElement, keys: Map<string, HTMLElement>, setEnabled: Function, destroy: Function }}
 */
export function createKeyboard(handlers = {}) {
    const root = document.createElement('div');
    root.className = 'balda-keyboard';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Экранная клавиатура');

    const keys = new Map();

    for (const row of ROWS) {
        const rowEl = document.createElement('div');
        rowEl.className = 'balda-keyboard-row';

        for (const letter of row) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'balda-key';
            button.tabIndex = -1;
            button.dataset.key = letter;
            button.textContent = letter;
            button.setAttribute('aria-label', letter);
            rowEl.appendChild(button);
            keys.set(letter, button);
        }

        root.appendChild(rowEl);
    }

    // Без этого кнопка забирает фокус у корня окна, и следующая физическая клавиша
    // уходит ей, а не нашему слушателю (грабля из ряда цифр судоку).
    const onMouseDown = (event) => {
        if (event.target.closest?.('.balda-key')) event.preventDefault();
    };

    const onClick = (event) => {
        const button = event.target.closest?.('.balda-key');
        if (!button || !root.contains(button)) return;
        dispatch({ action: LETTER, letter: button.dataset.key }, handlers);
    };

    root.addEventListener('mousedown', onMouseDown);
    root.addEventListener('click', onClick);

    return {
        root,
        keys,
        // Клавиатура гаснет, когда ставить букву некуда (ход соперника, конец партии):
        // «нажал — ничего не произошло» читается как поломка, а погасшая клавиатура —
        // как «сейчас не ваш ход».
        setEnabled(enabled) {
            root.classList.toggle('balda-keyboard-off', !enabled);
        },
        destroy() {
            root.removeEventListener('mousedown', onMouseDown);
            root.removeEventListener('click', onClick);
            root.remove();
        },
    };
}
