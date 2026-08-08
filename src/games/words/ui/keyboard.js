// Ввод «Слов»: физическая клавиатура (с чужой раскладкой) и экранная раскладка.
//
// Модуль знает про DOM, но ничего не знает ни о партии, ни о SillyTavern: наружу он
// отдаёт три события — буква, ввод, стирание — и рисует 32 клавиши, которые красит
// по состоянию букв из core/mark.js.
//
// Два подводных камня фазы:
//
//   1. Раскладка ОС. `event.key` даёт букву по ТЕКУЩЕЙ раскладке: у игрока с EN придёт
//      `f` вместо `а`. Разрешение двухступенчатое — если key уже кириллица, берём её;
//      иначе `event.code` через таблицу позиций ЙЦУКЕН (KeyF → А). Игрок с EN печатает
//      вслепую по позициям, как и привык. Прецедент есть в змейке (ЙЦУКЕН → WASD).
//   2. Экранная клавиатура ОБЯЗАТЕЛЬНА, а не опциональна: в окне игры нет ни одного
//      поля ввода, поэтому на телефоне системная клавиатура не появится вовсе и букву
//      физически нечем ввести. Завести настоящий <input> ради неё нельзя — фокус попапа
//      ST уедет в него при открытии, а capture-слушатель обязан его пропускать.

import { CORRECT, PRESENT, ABSENT, UNKNOWN, letterState } from '../core/mark.js';
import { alphabet, normalize } from '../core/dictionary.js';

/** Что игрок сделал. Одно и то же для тапа и для физической клавиши. */
export const LETTER = 'letter';
export const ENTER = 'enter';
export const BACKSPACE = 'backspace';

const LETTERS = alphabet();

// Позиции ЙЦУКЕН по физическим клавишам. Backquote — «ё», и она сразу мапится в Е:
// буквы «ё» в игре не существует нигде (см. core/dictionary.js).
const CODE_TO_LETTER = Object.freeze({
    Backquote: 'Е',
    KeyQ: 'Й', KeyW: 'Ц', KeyE: 'У', KeyR: 'К', KeyT: 'Е', KeyY: 'Н',
    KeyU: 'Г', KeyI: 'Ш', KeyO: 'Щ', KeyP: 'З', BracketLeft: 'Х', BracketRight: 'Ъ',
    KeyA: 'Ф', KeyS: 'Ы', KeyD: 'В', KeyF: 'А', KeyG: 'П', KeyH: 'Р',
    KeyJ: 'О', KeyK: 'Л', KeyL: 'Д', Semicolon: 'Ж', Quote: 'Э',
    KeyZ: 'Я', KeyX: 'Ч', KeyC: 'С', KeyV: 'М', KeyB: 'И', KeyN: 'Т',
    KeyM: 'Ь', Comma: 'Б', Period: 'Ю',
});

// Экранная раскладка: 12 + 11 + 9 букв плюс ввод и стирание по краям нижнего ряда.
// Редкие Э и Ъ стоят по краям, где промах дешевле.
const ROWS = Object.freeze([
    Object.freeze([...'ЙЦУКЕНГШЩЗХЪ']),
    Object.freeze([...'ФЫВАПРОЛДЖЭ']),
    Object.freeze([ENTER, ...'ЯЧСМИТЬБЮ', BACKSPACE]),
]);

const SPECIAL = Object.freeze({
    [ENTER]: { label: '⏎', aria: 'Ввод' },
    [BACKSPACE]: { label: '⌫', aria: 'Стереть' },
});

const STATE_LABEL = Object.freeze({
    [CORRECT]: 'на месте',
    [PRESENT]: 'есть в слове',
    [ABSENT]: 'нет в слове',
});

/**
 * Что означает нажатие клавиши.
 *
 * @returns {{ action: string, letter?: string }|null} null — клавиша не наша,
 *          её нельзя ни гасить, ни обрабатывать.
 */
export function resolveKey(event) {
    // Комбинации отдаём таверне целиком: иначе съедим её хоткеи.
    if (event.ctrlKey || event.altKey || event.metaKey) return null;

    if (event.key === 'Enter') return { action: ENTER };
    if (event.key === 'Backspace') return { action: BACKSPACE };

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
 *
 * @param {{ onLetter?: Function, onEnter?: Function, onBackspace?: Function }} handlers
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
    else if (hit.action === ENTER) handlers.onEnter?.();
    else if (hit.action === BACKSPACE) handlers.onBackspace?.();
}

/**
 * Экранная клавиатура.
 *
 * Клавиши — <button type="button"> с tabindex="-1": 32 кнопки в Tab-порядке попапа —
 * ровно та проблема, из-за которой клетки реверси сделаны div'ами. У клавиатурного
 * игрока есть настоящая клавиатура, экранная нужна пальцу.
 *
 * @returns {{ root: HTMLElement, render: Function, destroy: Function }}
 */
export function createKeyboard(handlers = {}) {
    const root = document.createElement('div');
    root.className = 'words-keyboard';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Экранная клавиатура');

    const keys = new Map();

    for (const row of ROWS) {
        const rowEl = document.createElement('div');
        rowEl.className = 'words-keyboard-row';

        for (const item of row) {
            const special = SPECIAL[item];
            const button = document.createElement('button');
            button.type = 'button';
            button.className = special ? 'words-key words-key-wide' : 'words-key';
            button.tabIndex = -1;
            button.dataset.key = item;
            button.textContent = special ? special.label : item;
            button.setAttribute('aria-label', special ? special.aria : item);
            rowEl.appendChild(button);
            if (!special) keys.set(item, button);
        }

        root.appendChild(rowEl);
    }

    // Без этого кнопка забирает фокус у корня окна, и следующая физическая клавиша
    // уходит ей, а не нашему слушателю (грабля из ряда цифр судоку).
    const onMouseDown = (event) => {
        if (event.target.closest?.('.words-key')) event.preventDefault();
    };

    const onClick = (event) => {
        const button = event.target.closest?.('.words-key');
        if (!button || !root.contains(button)) return;
        const key = button.dataset.key;
        if (key === ENTER || key === BACKSPACE) dispatch({ action: key }, handlers);
        else dispatch({ action: LETTER, letter: key }, handlers);
    };

    root.addEventListener('mousedown', onMouseDown);
    root.addEventListener('click', onClick);

    // state — Map буква → статус из keyboardState(). Состояние монотонно (см. mark.js),
    // поэтому просто переставляем классы, ничего не запоминая здесь.
    const render = (state = new Map()) => {
        for (const [letter, button] of keys) {
            const status = letterState(state, letter);
            button.classList.toggle('words-key-correct', status === CORRECT);
            button.classList.toggle('words-key-present', status === PRESENT);
            button.classList.toggle('words-key-absent', status === ABSENT);
            button.dataset.state = status;
            // Состояние несёт подпись, а не только цвет: он не должен быть
            // единственным носителем информации.
            button.setAttribute(
                'aria-label',
                status === UNKNOWN ? letter : `${letter}, ${STATE_LABEL[status]}`,
            );
        }
    };

    render();

    return {
        root,
        keys,
        render,
        destroy() {
            root.removeEventListener('mousedown', onMouseDown);
            root.removeEventListener('click', onClick);
            root.remove();
        },
    };
}
