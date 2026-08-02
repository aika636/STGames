// Логирование хаба. Все сообщения идут с префиксом [STGames], чтобы их было легко
// отличить в консоли от логов самого SillyTavern и остальных расширений.

const PREFIX = '[STGames]';

export function logInfo(...args) {
    console.log(PREFIX, ...args);
}

export function logWarn(...args) {
    console.warn(PREFIX, ...args);
}

export function logError(...args) {
    console.error(PREFIX, ...args);
}

// Ключи, для которых предупреждение уже было показано в текущей сессии страницы.
// Нужно для однократных предупреждений, которые иначе сыпались бы на каждый рендер.
const warnedKeys = new Set();

export function warnOnce(key, ...args) {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
    logWarn(...args);
}
