// Хелперы доступа к хосту SillyTavern. Контекст никогда не кэшируется в переменной
// модуля — он запрашивается заново в каждой точке использования: ST может пересоздать
// контекст (так же поступают и другие расширения в этой инсталляции).

import { logWarn } from './log.js';

export function getCtx() {
    return SillyTavern.getContext();
}

// Часть расширений использует ctx.event_types (snake_case), часть — ctx.eventTypes
// (camelCase). Какой из них реально существует в конкретной версии ST — заранее не
// известно, поэтому пробуем оба и фолбэчимся на пустой объект.
export function getEventTypes(ctx) {
    return ctx?.event_types ?? ctx?.eventTypes ?? {};
}

// Безопасная обёртка над амбиентным toastr: если он недоступен (ранний вызов до полной
// загрузки ST), сообщение не теряется, а уходит в консоль.
export function toast(kind, message, title = 'Sudoku') {
    try {
        if (typeof toastr !== 'undefined' && typeof toastr[kind] === 'function') {
            toastr[kind](message, title);
            return;
        }
    } catch (err) {
        logWarn('toast: ошибка вызова toastr', err);
    }
    logWarn(`toast (${kind}) ${title}: ${message}`);
}
