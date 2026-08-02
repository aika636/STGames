// Тесты настроек хаба (Фаза 3): миграция со старого ключа Sudoku и мердж ключей
// при битых значениях в settings.json. Чистый node, браузер не нужен.
// Запуск: node tests/shell/settings.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    MODULE_NAME,
    SETTINGS_VERSION,
    getGameSettings,
    getSettings,
    migrateLegacy,
} from '../../src/settings.js';

// Заглушка контекста: getCtx() из src/ctx.js зовёт глобальный SillyTavern в каждой
// точке использования, поэтому достаточно подменить его перед вызовом.
function stubContext(extensionSettings, save = () => {}) {
    const context = { extensionSettings, saveSettingsDebounced: save };
    globalThis.SillyTavern = { getContext: () => context };
    return context;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
}

// Старый ключ Sudoku, как его могла оставить предыдущая версия расширения.
const LEGACY = {
    difficulty: 'hard',
    highlightConflicts: false,
    highlightMistakes: true,
    autoCleanNotes: false,
    showTimer: false,
    savedGame: { version: 1, puzzle: [1, 2, 3] },
    stats: { easy: { played: 2, solved: 1, bestTimeMs: 123456 } },
};

const DEFAULTS = { difficulty: 'medium', showTimer: true, stats: {} };

console.log('settings (shell)');

test('миграция создаёт STGames.games.sudoku со статистикой и партией', () => {
    const extensionSettings = { Sudoku: structuredClone(LEGACY) };
    assert(migrateLegacy(extensionSettings), 'миграция произошла');

    const migrated = extensionSettings.STGames.games.sudoku;
    assert(deepEqual(migrated.stats, LEGACY.stats), 'stats скопирован');
    assert(deepEqual(migrated.savedGame, LEGACY.savedGame), 'savedGame скопирован');
    assertEqual(migrated.difficulty, 'hard', 'difficulty перенесён');
    assertEqual(migrated.highlightConflicts, false, 'highlightConflicts перенесён');
    assertEqual(extensionSettings.STGames.version, SETTINGS_VERSION, 'version на месте');
    assertEqual(extensionSettings.STGames.lastGame, 'sudoku', 'lastGame — sudoku');
});

test('старый ключ Sudoku остаётся нетронутым', () => {
    const extensionSettings = { Sudoku: structuredClone(LEGACY) };
    const before = JSON.stringify(extensionSettings.Sudoku);

    migrateLegacy(extensionSettings);

    assert(Object.hasOwn(extensionSettings, 'Sudoku'), 'ключ Sudoku на месте');
    assertEqual(JSON.stringify(extensionSettings.Sudoku), before, 'ключ Sudoku не изменился');
});

test('повторная миграция ничего не делает', () => {
    const extensionSettings = { Sudoku: structuredClone(LEGACY) };
    assert(migrateLegacy(extensionSettings), 'первая миграция');
    assert(!migrateLegacy(extensionSettings), 'вторая миграция не сработала');
    assertEqual(extensionSettings.STGames.games.sudoku.stats.easy.played, 2, 'данные не задвоились');
});

test('при существующем STGames миграция не трогает его', () => {
    const extensionSettings = {
        Sudoku: structuredClone(LEGACY),
        STGames: { version: 1, lastGame: 'snake', games: { snake: { bestScore: 42 } } },
    };
    assert(!migrateLegacy(extensionSettings), 'миграции нет');
    assertEqual(extensionSettings.STGames.games.snake.bestScore, 42, 'STGames не тронут');
    assertEqual(extensionSettings.STGames.lastGame, 'snake', 'lastGame не тронут');
});

test('миграция через getSettings сохраняет настройки ровно один раз', () => {
    let saves = 0;
    stubContext({ Sudoku: structuredClone(LEGACY) }, () => { saves++; });

    const settings = getSettings();
    assertEqual(settings.games.sudoku.stats.easy.played, 2, 'статистика перенесена');
    assertEqual(settings.lastGame, 'sudoku', 'lastGame — sudoku');
    assertEqual(saves, 1, 'saveSettingsDebounced позван один раз');
});

test('без миграции getSettings не сохраняет настройки', () => {
    let saves = 0;
    stubContext({ STGames: { version: 1, lastGame: null, games: {} } }, () => { saves++; });

    getSettings();
    getGameSettings('sudoku', DEFAULTS);
    assertEqual(saves, 0, 'saveSettingsDebounced не позван');
});

test('getSettings домерживает недостающие верхнеуровневые ключи', () => {
    stubContext({ STGames: { games: {} } });
    const settings = getSettings();
    assertEqual(settings.version, SETTINGS_VERSION, 'version добавлен');
    assertEqual(settings.lastGame, null, 'lastGame добавлен');
});

test('getSettings чинит битые контейнеры', () => {
    // .games — массив вместо объекта.
    stubContext({ STGames: { games: [] } });
    const settings = getSettings();
    assertEqual(settings.version, SETTINGS_VERSION, 'version на месте');
    assertEqual(settings.lastGame, null, 'lastGame на месте');
    assert(!Array.isArray(settings.games), 'games заменён свежим объектом');
});

test('getSettings заменяет скалярный STGames свежим объектом', () => {
    stubContext({ STGames: 'битое значение' });
    const settings = getSettings();
    assertEqual(settings.version, SETTINGS_VERSION, 'version на месте');
    assertEqual(settings.lastGame, null, 'lastGame на месте');
    assert(!Array.isArray(settings.games), 'games — объект');
});

test('getGameSettings домерживает недостающие ключи, не перетирая существующие', () => {
    stubContext({
        STGames: { version: 1, lastGame: null, games: { sudoku: { difficulty: 'expert' } } },
    });

    const settings = getGameSettings('sudoku', DEFAULTS);
    assertEqual(settings.difficulty, 'expert', 'существующее значение сохранено');
    assertEqual(settings.showTimer, true, 'недостающий ключ добавлен');
});

test('getGameSettings чинит битую запись игры свежим клоном дефолтов', () => {
    stubContext({ STGames: { version: 1, lastGame: null, games: { sudoku: null } } });

    const settings = getGameSettings('sudoku', DEFAULTS);
    assertEqual(settings.difficulty, 'medium', 'запись создана из дефолтов');
    assertEqual(settings.showTimer, true, 'дефолты на месте');
    assert(deepEqual(settings.stats, DEFAULTS.stats), 'вложенные дефолты скопированы');
});

report('settings');
