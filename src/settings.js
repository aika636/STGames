// Настройки хаба: extensionSettings.STGames (camelCase-поле контекста ST),
// с мержем недостающих ключей при апгрейде и миграцией со старого ключа Sudoku.
//
// Модуль игро-агностичен: что именно настраивается у каждой игры, знают модули
// src/games/*/settings.js, а здесь живут только общий контейнер и правила мерджа.

import { getCtx } from './ctx.js';
import { logInfo } from './log.js';

export const MODULE_NAME = 'STGames';
export const LEGACY_MODULE_NAME = 'Sudoku';
export const SETTINGS_VERSION = 1;

// Ключи верхнего уровня STGames: version — номер схемы (для будущих миграций),
// lastGame — последняя открытая игра, games — настройки каждой игры по id.
const TOP_LEVEL_DEFAULTS = Object.freeze({
    version: SETTINGS_VERSION,
    lastGame: null,
    games: {},
});

// Ключи, переносимые из старого ключа Sudoku. Список явный: лишний мусор из старых
// версий в новый формат не тянем.
const LEGACY_KEYS = Object.freeze([
    'difficulty',
    'highlightConflicts',
    'highlightMistakes',
    'autoCleanNotes',
    'showTimer',
    'savedGame',
    'stats',
]);

function isPlainObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

// Переносит настройки судоку из старого ключа в STGames.games.sudoku. Чистая
// функция: принимает объект extensionSettings и сама не трогает getCtx(), чтобы
// тестироваться под node без заглушки SillyTavern.
//
// Старый ключ намеренно не удаляется и не меняется — это возможность отката на
// старую версию расширения без потери партии и статистики.
export function migrateLegacy(extensionSettings) {
    if (!isPlainObject(extensionSettings)) return false;
    if (isPlainObject(extensionSettings[MODULE_NAME])) return false;
    if (!isPlainObject(extensionSettings[LEGACY_MODULE_NAME])) return false;

    const legacy = extensionSettings[LEGACY_MODULE_NAME];
    const sudoku = {};
    for (const key of LEGACY_KEYS) {
        if (Object.hasOwn(legacy, key)) {
            sudoku[key] = structuredClone(legacy[key]);
        }
    }

    extensionSettings[MODULE_NAME] = {
        version: SETTINGS_VERSION,
        lastGame: 'sudoku',
        games: { sudoku },
    };
    return true;
}

// Возвращает живой (не клонированный) объект настроек хаба, создавая его при первом
// обращении и добавляя недостающие ключи после апгрейдов, чтобы никогда не остаться
// с undefined-полями.
export function getSettings() {
    const ctx = getCtx();
    const root = ctx.extensionSettings;

    // Миграция при первом обращении: если STGames ещё нет, а старый ключ Sudoku на
    // месте — переносим его содержимое и сохраняем результат на диск.
    if (migrateLegacy(root)) {
        logInfo(`настройки перенесены из ${LEGACY_MODULE_NAME} в ${MODULE_NAME}`);
        saveSettings();
    }

    // settings.json игрок может править руками, поэтому любой битый контейнер
    // (null, массив, скаляр) заменяется свежим — иначе мердж полей упал бы.
    if (!isPlainObject(root[MODULE_NAME])) {
        root[MODULE_NAME] = structuredClone(TOP_LEVEL_DEFAULTS);
    }
    const settings = root[MODULE_NAME];
    if (!isPlainObject(settings.games)) {
        settings.games = {};
    }
    for (const key of Object.keys(TOP_LEVEL_DEFAULTS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = structuredClone(TOP_LEVEL_DEFAULTS[key]);
        }
    }
    return settings;
}

// Живой объект настроек игры id внутри STGames.games, с тем же приёмом
// merge-on-load. Дефолты приходят из game.defaults реестра, поэтому реестр обязан
// быть заполнен до первого чтения настроек игры — иначе вместо реальных дефолтов
// уедет пустой объект.
export function getGameSettings(id, defaults) {
    const settings = getSettings();
    if (!isPlainObject(settings.games[id])) {
        settings.games[id] = structuredClone(defaults);
    }
    const gameSettings = settings.games[id];
    for (const key of Object.keys(defaults)) {
        if (!Object.hasOwn(gameSettings, key)) {
            gameSettings[key] = structuredClone(defaults[key]);
        }
    }
    return gameSettings;
}

export function saveSettings() {
    getCtx().saveSettingsDebounced();
}
