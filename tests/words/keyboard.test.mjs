// Тесты ввода «Слов» (Фаза 9.4) под jsdom: разрешение раскладки, capture-слушатель,
// экранная клавиатура и обратная связь на отказ.
//
// Главное, ради чего фаза рискованная: буква обязана быть съедена до того, как дойдёт
// до поля ввода чата SillyTavern, а Escape и хоткеи таверны — наоборот, не тронуты.
//
// Требуется jsdom: npm install --no-save jsdom
// Запуск: node tests/words/keyboard.test.mjs

import { JSDOM } from 'jsdom';
import { assert, assertEqual, report, test } from '../_harness.mjs';

const dom = new JSDOM(
    '<!doctype html><html><body><textarea id="send_textarea"></textarea></body></html>',
    { pretendToBeVisual: true },
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

const {
    BACKSPACE, ENTER, LETTER, attachKeyboard, createKeyboard, resolveKey,
} = await import('../../src/games/words/ui/keyboard.js');
const {
    SHAKE_MS, TOAST_QUIET_MS, createToaster, describeRejection, markInvalid,
} = await import('../../src/games/words/ui/feedback.js');
const { CORRECT, PRESENT, ABSENT } = await import('../../src/games/words/core/mark.js');
const {
    HARD_FIXED, HARD_MISSING, NOT_IN_DICTIONARY, TOO_SHORT,
} = await import('../../src/games/words/core/engine.js');

function keyEvent(init) {
    return new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

// --- Раскладка -----------------------------------------------------------------

test('русская раскладка: буква берётся прямо из key', () => {
    const hit = resolveKey(keyEvent({ key: 'а', code: 'KeyF' }));
    assertEqual(hit.action, LETTER);
    assertEqual(hit.letter, 'А');
});

test('английская раскладка: буква берётся из code по позиции ЙЦУКЕН', () => {
    const hit = resolveKey(keyEvent({ key: 'f', code: 'KeyF' }));
    assertEqual(hit.letter, 'А', 'KeyF должна давать А');
    assertEqual(resolveKey(keyEvent({ key: 'q', code: 'KeyQ' })).letter, 'Й');
    assertEqual(resolveKey(keyEvent({ key: ',', code: 'Comma' })).letter, 'Б');
});

test('«ё» нормализуется в «е» и с раскладки, и с позиции', () => {
    assertEqual(resolveKey(keyEvent({ key: 'ё', code: 'Backquote' })).letter, 'Е');
    assertEqual(resolveKey(keyEvent({ key: '`', code: 'Backquote' })).letter, 'Е');
});

test('Enter и Backspace — отдельные действия', () => {
    assertEqual(resolveKey(keyEvent({ key: 'Enter', code: 'Enter' })).action, ENTER);
    assertEqual(resolveKey(keyEvent({ key: 'Backspace', code: 'Backspace' })).action, BACKSPACE);
});

test('чужие клавиши и комбинации — не наши', () => {
    assertEqual(resolveKey(keyEvent({ key: 'Escape', code: 'Escape' })), null, 'Escape');
    assertEqual(resolveKey(keyEvent({ key: '1', code: 'Digit1' })), null, 'цифра');
    assertEqual(resolveKey(keyEvent({ key: 'ArrowLeft', code: 'ArrowLeft' })), null, 'стрелка');
    assertEqual(resolveKey(keyEvent({ key: 'a', code: 'KeyA', ctrlKey: true })), null, 'Ctrl+A');
    assertEqual(resolveKey(keyEvent({ key: 'Enter', code: 'Enter', ctrlKey: true })), null, 'Ctrl+Enter');
});

// --- Физическая клавиатура -----------------------------------------------------

function collector() {
    const seen = [];
    return {
        seen,
        handlers: {
            onLetter: (letter) => seen.push(letter),
            onEnter: () => seen.push('ENTER'),
            onBackspace: () => seen.push('BACKSPACE'),
        },
    };
}

test('буква гасится на document, чужая клавиша — нет', () => {
    const { seen, handlers } = collector();
    const keyboard = attachKeyboard(handlers);

    const letter = keyEvent({ key: 'f', code: 'KeyF' });
    document.body.dispatchEvent(letter);
    assertEqual(letter.defaultPrevented, true, 'буква должна быть съедена');
    assertEqual(seen.join(''), 'А');

    const escape = keyEvent({ key: 'Escape', code: 'Escape' });
    document.body.dispatchEvent(escape);
    assertEqual(escape.defaultPrevented, false, 'Escape отдаём попапу');

    keyboard.destroy();
});

test('в поле ввода чата не перехватываем ничего', () => {
    const { seen, handlers } = collector();
    const keyboard = attachKeyboard(handlers);

    const textarea = document.getElementById('send_textarea');
    const event = keyEvent({ key: 'ф', code: 'KeyA' });
    textarea.dispatchEvent(event);

    assertEqual(event.defaultPrevented, false, 'в textarea игрок печатает');
    assertEqual(seen.length, 0);

    keyboard.destroy();
});

test('destroy() снимает слушатель', () => {
    const { seen, handlers } = collector();
    attachKeyboard(handlers).destroy();
    document.body.dispatchEvent(keyEvent({ key: 'ф', code: 'KeyA' }));
    assertEqual(seen.length, 0);
});

// --- Экранная клавиатура -------------------------------------------------------

test('раскладка — 32 буквы плюс ввод и стирание', () => {
    const keyboard = createKeyboard({});
    assertEqual(keyboard.keys.size, 32, 'букв на клавиатуре');
    assertEqual(keyboard.root.querySelectorAll('.words-key').length, 34, 'всего клавиш');
    assert(!keyboard.root.querySelector('[data-key="Ё"]'), '«ё» на клавиатуре быть не должно');
    for (const button of keyboard.root.querySelectorAll('.words-key')) {
        assertEqual(button.tabIndex, -1, `${button.dataset.key} не должна попадать в Tab-порядок`);
    }
    keyboard.destroy();
});

test('тап по клавише даёт тот же эффект, что физическая клавиша', () => {
    const { seen, handlers } = collector();
    const keyboard = createKeyboard(handlers);
    document.body.appendChild(keyboard.root);

    keyboard.keys.get('А').click();
    keyboard.root.querySelector('[data-key="enter"]').click();
    keyboard.root.querySelector('[data-key="backspace"]').click();

    assertEqual(seen.join(','), 'А,ENTER,BACKSPACE');
    keyboard.destroy();
});

test('mousedown по клавише гасится — фокус не уезжает с корня окна', () => {
    const keyboard = createKeyboard({});
    document.body.appendChild(keyboard.root);

    const event = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    keyboard.keys.get('А').dispatchEvent(event);
    assertEqual(event.defaultPrevented, true);

    keyboard.destroy();
});

test('render() красит клавиши по состоянию букв и пишет его в подпись', () => {
    const keyboard = createKeyboard({});
    keyboard.render(new Map([['А', CORRECT], ['Б', PRESENT], ['В', ABSENT]]));

    assert(keyboard.keys.get('А').classList.contains('words-key-correct'), 'А зелёная');
    assert(keyboard.keys.get('Б').classList.contains('words-key-present'), 'Б жёлтая');
    assert(keyboard.keys.get('В').classList.contains('words-key-absent'), 'В серая');
    assertEqual(keyboard.keys.get('Г').dataset.state, 'unknown');
    assertEqual(keyboard.keys.get('А').getAttribute('aria-label'), 'А, на месте');
    assertEqual(keyboard.keys.get('Г').getAttribute('aria-label'), 'Г');

    // Состояние монотонно (mark.js), но сам render() не запоминает ничего: новая
    // разметка должна полностью вытеснить старую.
    keyboard.render(new Map([['А', CORRECT]]));
    assert(!keyboard.keys.get('Б').classList.contains('words-key-present'), 'Б сброшена');

    keyboard.destroy();
});

// --- Отказ ---------------------------------------------------------------------

test('причины отказа превращаются в человеческий текст', () => {
    assertEqual(describeRejection({ reason: TOO_SHORT }), 'Мало букв');
    assertEqual(describeRejection({ reason: NOT_IN_DICTIONARY }), 'Нет в словаре');
    assertEqual(
        describeRejection({ reason: HARD_FIXED, letter: 'К', position: 1 }),
        '2-я буква должна быть К',
    );
    assertEqual(
        describeRejection({ reason: HARD_MISSING, letter: 'А', count: 1 }),
        'Слово должно содержать А',
    );
    assertEqual(
        describeRejection({ reason: HARD_MISSING, letter: 'А', count: 2 }),
        'Буква А должна встретиться 2 раза',
    );
});

test('повтор одного тоста глушится на секунду, другой текст проходит', () => {
    const shown = [];
    let now = 1000;
    const toast = createToaster((msg) => shown.push(msg), () => now);

    assertEqual(toast('Нет в словаре'), true);
    assertEqual(toast('Нет в словаре'), false, 'долбёжка Enter не должна спамить');
    assertEqual(toast('Мало букв'), true, 'другое сообщение проходит сразу');

    now += TOAST_QUIET_MS;
    assertEqual(toast('Мало букв'), true, 'через секунду можно снова');
    assertEqual(shown.join('|'), 'Нет в словаре|Мало букв|Мало букв');
});

test('markInvalid: тряска, а при reduced-motion только рамка; отмена всё снимает', () => {
    const row = document.createElement('div');
    document.body.appendChild(row);

    const cancel = markInvalid(row, { reducedMotion: false });
    assert(row.classList.contains('words-invalid'), 'рамка отказа');
    assert(row.classList.contains('words-shake'), 'тряска');
    cancel();
    assertEqual(row.className, '', 'отмена снимает всё');

    const cancelReduced = markInvalid(row, { reducedMotion: true });
    assert(row.classList.contains('words-invalid'), 'рамка есть всегда');
    assert(!row.classList.contains('words-shake'), 'при reduced-motion не трясём');
    cancelReduced();

    assert(SHAKE_MS > 0 && SHAKE_MS < 1000, 'тряска короткая');
    row.remove();
});

report('words/keyboard');
