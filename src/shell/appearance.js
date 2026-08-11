// Оформление окна игр: какой палитрой рисуются игры.
//
// Зачем это вообще есть. Раньше все цвета брались напрямую из переменных темы ST
// (--SmartThemeQuoteColor, --SmartThemeBorderColor, --black30a) и заливки считались от
// currentColor. На тёмных темах это работало, а на светлых — нет: акцент бывает светлее
// фона (оранжевая змейка на бежевом окне), а «дымки» вида currentColor 5% на светлом
// фоне отличаются от него на пару процентов яркости и сетка исчезает. Плюс поле игры
// просвечивало фон попапа ST — а он полупрозрачный поверх произвольного аватара, так что
// контраст не был гарантирован в принципе.
//
// Решение: свой слой переменных --stg-* в style.css и четыре режима, между которыми
// переключает атрибут data-stg-theme на .stg-root:
//   theme — как раньше, цвета темы таверны (для тех, кому важно единство оформления);
//   light/dark — самодостаточные палитры с непрозрачной подложкой окна;
//   auto — light или dark по яркости темы ST, режим по умолчанию.
//
// Модуль почти весь — чистые функции над строками цвета: DOM трогает только
// applyAppearance(), остальное тестируется под node.

export const DEFAULT_APPEARANCE = 'auto';

// Значение → подпись в панели настроек. Порядок — порядок в селекте.
export const APPEARANCE_OPTIONS = Object.freeze([
    ['auto', 'Авто (по яркости темы)'],
    ['light', 'Светлая'],
    ['dark', 'Тёмная'],
    ['theme', 'Цвета таверны'],
]);

const MODES = new Set(APPEARANCE_OPTIONS.map(([value]) => value));

export function isAppearance(value) {
    return MODES.has(value);
}

// Разбирает цвет в {r, g, b} 0…255. Понимает ровно те формы, в которых темы ST держат
// свои переменные: #rgb, #rrggbb, rgb()/rgba() (в том числе через пробелы и с /alpha).
// Всё остальное (named colors, hsl, color-mix) — null: угадывать не пытаемся, вызов
// сам решит, что делать без ответа.
export function parseColor(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim().toLowerCase();
    if (text === '') return null;

    if (text.startsWith('#')) {
        const hex = text.slice(1);
        if (/^[0-9a-f]{3,4}$/.test(hex)) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16),
            };
        }
        if (/^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
            };
        }
        return null;
    }

    const match = text.match(/^rgba?\(([^)]+)\)$/);
    if (!match) return null;
    // Запятые и слэш альфы — в пробелы: и старый rgb(1, 2, 3), и новый rgb(1 2 3 / .5)
    // после этого разбираются одним split.
    const parts = match[1].replace(/[,/]/g, ' ').trim().split(/\s+/);
    if (parts.length < 3) return null;

    const channel = (raw) => {
        const number = parseFloat(raw);
        if (!Number.isFinite(number)) return null;
        // Проценты — тоже допустимая запись канала.
        const scaled = raw.trim().endsWith('%') ? (number / 100) * 255 : number;
        return Math.min(255, Math.max(0, scaled));
    };

    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    if (r === null || g === null || b === null) return null;
    return { r, g, b };
}

// Относительная яркость по WCAG (0 — чёрный, 1 — белый).
export function luminance({ r, g, b }) {
    const linear = (channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// Светлая тема или тёмная — по цвету ТЕКСТА, а не фона: фон попапа ST полупрозрачный и
// лежит поверх произвольной картинки, а цвет текста тема задаёт всегда и он заведомо
// контрастен своему фону. Светлый текст → тёмная тема, и наоборот.
//
// Неразобранный цвет — 'dark': тёмная тема у ST по умолчанию, и ошибиться в её сторону
// безопаснее (светлая палитра на тёмном фоне заметнее бьёт по глазам, чем наоборот).
export function pickAuto(textColor) {
    const rgb = parseColor(textColor);
    if (!rgb) return 'dark';
    return luminance(rgb) > 0.5 ? 'dark' : 'light';
}

// Режим настройки → режим палитры. Пробник — функция, возвращающая цвет текста темы;
// зовётся только для 'auto', чтобы не платить getComputedStyle зря.
export function resolveAppearance(mode, probeTextColor) {
    if (mode === 'light' || mode === 'dark' || mode === 'theme') return mode;
    return pickAuto(typeof probeTextColor === 'function' ? probeTextColor() : probeTextColor);
}

// Цвет текста темы ST из живого документа: сперва переменная темы, затем — фактический
// цвет body (тема могла задать его напрямую, без переменной).
export function readThemeTextColor(doc = globalThis.document) {
    try {
        const body = doc?.body;
        if (!body) return '';
        const style = doc.defaultView?.getComputedStyle?.(body);
        if (!style) return '';
        const variable = style.getPropertyValue('--SmartThemeBodyColor');
        if (variable && variable.trim()) return variable.trim();
        return style.color || '';
    } catch {
        return '';
    }
}

// Ставит режим палитры на корень окна. Возвращает выбранный режим — им же удобно
// проверяться в тестах.
export function applyAppearance(root, mode, probeTextColor = readThemeTextColor) {
    const resolved = resolveAppearance(mode, probeTextColor);
    if (root?.dataset) root.dataset.stgTheme = resolved;
    return resolved;
}
