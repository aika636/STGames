// Отказ во вводе: текст причины, глушилка повторов и тряска строки.
//
// Ядро возвращает КОДЫ причин ({ ok: false, reason, letter, position, count }), а
// формулировку собирает UI — так тесты движка не ломаются от правки текста, а само
// ядро не знает языка интерфейса. Здесь эта сборка и живёт.

import {
    GAME_OVER,
    HARD_FIXED,
    HARD_MISSING,
    NOT_IN_DICTIONARY,
    TOO_SHORT,
} from '../core/engine.js';

/** Сколько миллисекунд трясётся строка. Столько же держится класс отказа. */
export const SHAKE_MS = 350;

/** Окно глушения одинаковых сообщений: долбёжка Enter иначе заспамит экран тостами. */
export const TOAST_QUIET_MS = 1000;

/**
 * Текст отказа по коду причины.
 *
 * @param {{ reason: string, letter?: string, position?: number, count?: number }} result
 * @returns {string}
 */
export function describeRejection(result) {
    switch (result?.reason) {
        case TOO_SHORT:
            return 'Мало букв';
        case NOT_IN_DICTIONARY:
            return 'Нет в словаре';
        case HARD_FIXED:
            return `${result.position + 1}-я буква должна быть ${result.letter}`;
        case HARD_MISSING:
            return result.count > 1
                ? `Буква ${result.letter} должна встретиться ${result.count} ${plural(result.count)}`
                : `Слово должно содержать ${result.letter}`;
        case GAME_OVER:
            return 'Партия окончена';
        default:
            return 'Не получилось';
    }
}

// Слово длиной 5 букв, поэтому count ∈ [2..5] — хватает двух форм.
function plural(count) {
    return count >= 2 && count <= 4 ? 'раза' : 'раз';
}

/**
 * Тост с глушением повторов: одно и то же сообщение чаще раза в секунду не показывается.
 *
 * @param {Function} toast     показать сообщение
 * @param {Function} [now]     источник времени (для тестов)
 */
export function createToaster(toast, now = () => Date.now()) {
    let lastMessage = null;
    let lastAt = -Infinity;

    return (message) => {
        const at = now();
        if (message === lastMessage && at - lastAt < TOAST_QUIET_MS) return false;
        lastMessage = message;
        lastAt = at;
        toast?.(message);
        return true;
    };
}

function prefersReducedMotion() {
    try {
        return Boolean(globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    } catch {
        // matchMedia есть не везде (jsdom без стабов) — отсутствие ответа не повод падать.
        return false;
    }
}

/**
 * Отметить строку отказом: тряска, а при prefers-reduced-motion — только красная рамка.
 * Возвращает функцию отмены: её обязан звать destroy(), иначе таймер допишет класс
 * в уже снятый со страницы DOM.
 */
export function markInvalid(element, { reducedMotion = prefersReducedMotion() } = {}) {
    if (!element) return () => {};

    element.classList.add('words-invalid');
    if (!reducedMotion) {
        // Перезапуск анимации на подряд идущих отказах: без снятия класса и
        // принудительного reflow вторая тряска не начнётся.
        element.classList.remove('words-shake');
        void element.offsetWidth;
        element.classList.add('words-shake');
    }

    const timer = setTimeout(() => {
        element.classList.remove('words-invalid', 'words-shake');
    }, SHAKE_MS);

    return () => {
        clearTimeout(timer);
        element.classList.remove('words-invalid', 'words-shake');
    };
}
