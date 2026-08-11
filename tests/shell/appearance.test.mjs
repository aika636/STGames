// Тесты палитры окна игр: разбор цвета, выбор светлой/тёмной по яркости темы ST и
// запись режима в настройки. Чистый node — DOM нужен только последнему тесту, и там
// хватает объекта с dataset.
// Запуск: node tests/shell/appearance.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    APPEARANCE_OPTIONS,
    DEFAULT_APPEARANCE,
    applyAppearance,
    isAppearance,
    luminance,
    parseColor,
    pickAuto,
    resolveAppearance,
} from '../../src/shell/appearance.js';
import { getAppearance, setAppearance } from '../../src/settings.js';

function stubContext(extensionSettings = {}) {
    const context = { extensionSettings, saveSettingsDebounced: () => {} };
    globalThis.SillyTavern = { getContext: () => context };
    return context;
}

console.log('appearance (shell)');

test('parseColor понимает hex и rgb во всех записях, которыми пишут темы ST', () => {
    assertEqual(parseColor('#fff').r, 255, '#fff — белый');
    assertEqual(parseColor('#000000').g, 0, '#000000 — чёрный');
    assertEqual(parseColor('#1c1d21').b, 0x21, '#rrggbb разобран');
    assertEqual(parseColor('rgb(10, 20, 30)').g, 20, 'rgb() с запятыми');
    assertEqual(parseColor('rgba(10, 20, 30, 0.5)').b, 30, 'rgba() с альфой');
    assertEqual(parseColor('rgb(10 20 30 / 50%)').r, 10, 'rgb() через пробелы и слэш');
    assertEqual(parseColor('  #ABCDEF  ').r, 0xab, 'пробелы и верхний регистр');
});

test('parseColor не выдумывает цвет для того, чего не понимает', () => {
    for (const value of ['', 'tomato', 'hsl(10, 20%, 30%)', 'color-mix(in srgb, red, blue)', null, 42]) {
        assertEqual(parseColor(value), null, `${String(value)} — null`);
    }
});

test('luminance: белый ярче серого, серый ярче чёрного', () => {
    const white = luminance(parseColor('#ffffff'));
    const grey = luminance(parseColor('#808080'));
    const black = luminance(parseColor('#000000'));
    assertEqual(white, 1, 'белый — единица');
    assertEqual(black, 0, 'чёрный — ноль');
    assert(white > grey && grey > black, 'порядок яркостей');
});

test('pickAuto выбирает палитру по цвету ТЕКСТА темы, а не по фону', () => {
    // Светлый текст бывает только на тёмной теме — и наоборот.
    assertEqual(pickAuto('#e8e8e8'), 'dark', 'светлый текст — тёмная палитра');
    assertEqual(pickAuto('rgb(232, 232, 232)'), 'dark', 'тот же цвет в rgb()');
    assertEqual(pickAuto('#3b2f21'), 'light', 'тёмно-коричневый текст — светлая палитра');
    assertEqual(pickAuto('#000'), 'light', 'чёрный текст — светлая палитра');
});

test('pickAuto без разобранного цвета уходит в тёмную: тема ST по умолчанию тёмная', () => {
    assertEqual(pickAuto('tomato'), 'dark', 'непонятный цвет');
    assertEqual(pickAuto(''), 'dark', 'пустая строка');
});

test('явно выбранный режим пробник не зовёт вовсе', () => {
    let probed = 0;
    const probe = () => {
        probed++;
        return '#ffffff';
    };
    for (const mode of ['light', 'dark', 'theme']) {
        assertEqual(resolveAppearance(mode, probe), mode, `${mode} проходит как есть`);
    }
    assertEqual(probed, 0, 'пробник не звался');
    assertEqual(resolveAppearance('auto', probe), 'dark', 'auto разрешился пробником');
    assertEqual(probed, 1, 'пробник позвался один раз');
});

test('applyAppearance пишет режим в data-stg-theme', () => {
    const root = { dataset: {} };
    assertEqual(applyAppearance(root, 'light'), 'light', 'вернулся выбранный режим');
    assertEqual(root.dataset.stgTheme, 'light', 'атрибут выставлен');

    applyAppearance(root, 'auto', () => '#111111');
    assertEqual(root.dataset.stgTheme, 'light', 'auto на тёмном тексте — светлая палитра');
});

test('в настройках лежит валидный режим, мусор до окна не доезжает', () => {
    stubContext({});
    assertEqual(getAppearance(), DEFAULT_APPEARANCE, 'по умолчанию — auto');

    assert(setAppearance('dark'), 'известный режим принят');
    assertEqual(getAppearance(), 'dark', 'режим сохранён');

    assert(!setAppearance('neon'), 'неизвестный режим отвергнут');
    assertEqual(getAppearance(), 'dark', 'старое значение не затёрто');

    // Значение могли править руками в settings.json — на такое отвечаем дефолтом.
    stubContext({ STGames: { version: 1, lastGame: null, appearance: 'neon', games: {} } });
    assertEqual(getAppearance(), DEFAULT_APPEARANCE, 'битое значение подменено дефолтом');
});

test('все режимы селекта — те же, что понимает isAppearance', () => {
    for (const [value, label] of APPEARANCE_OPTIONS) {
        assert(isAppearance(value), `${value} известен`);
        assert(typeof label === 'string' && label.length > 0, `${value} подписан`);
    }
    assert(isAppearance(DEFAULT_APPEARANCE), 'дефолт — валидный режим');
});

report('appearance (shell)');
