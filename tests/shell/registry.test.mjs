// Тесты реестра игр: регистрация, порядок списка, замена дубликатов, валидация
// контракта. Запуск: node tests/shell/registry.test.mjs

import { assert, assertEqual, report, test } from '../_harness.mjs';
import { clear, get, has, list, register } from '../../src/registry.js';

// Реестр — общее состояние модуля, поэтому каждый тест начинает с clear() и строит
// свою последовательность регистраций.
const makeGame = (id) => ({
    id,
    title: `Игра ${id}`,
    mount: () => ({ destroy() {} }),
    defaults: { volume: 0.5 },
});

// Возвращает пойманный Error или null, если функция не бросила.
function throwsError(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    return null;
}

test('register добавляет игру, list сохраняет порядок регистрации', () => {
    clear();
    register(makeGame('a'));
    register(makeGame('b'));
    register(makeGame('c'));
    assertEqual(list().length, 3, 'размер списка');
    assertEqual(list().map((g) => g.id).join(','), 'a,b,c', 'порядок списка');
});

test('list возвращает новый массив — его правка не трогает реестр', () => {
    clear();
    register(makeGame('a'));
    const snapshot = list();
    snapshot.length = 0;
    assertEqual(list().length, 1, 'реестр не пострадал от правки списка');
});

test('get отдаёт игру по id и undefined для неизвестного id', () => {
    clear();
    register(makeGame('a'));
    assertEqual(get('a').title, 'Игра a', 'известный id');
    assertEqual(get('nope'), undefined, 'неизвестный id');
});

test('has отвечает о наличии игры', () => {
    clear();
    register(makeGame('a'));
    assert(has('a'), 'зарегистрированная игра');
    assert(!has('b'), 'незарегистрированная игра');
});

test('повторная регистрация того же id заменяет запись, а не дублирует', () => {
    clear();
    register(makeGame('a'));
    register({ ...makeGame('a'), title: 'Обновлённая' });
    assertEqual(list().length, 1, 'одна запись, не две');
    assertEqual(get('a').title, 'Обновлённая', 'get отдаёт новую версию');
    assertEqual(list()[0].title, 'Обновлённая', 'порядок первой записи сохранён');
});

test('register бросает Error при нарушении контракта', () => {
    clear();
    assert(throwsError(() => register({})), 'пустой объект');
    assert(throwsError(() => register(undefined)), 'undefined');
    assert(throwsError(() => register({ id: 'x', title: 'X', defaults: {} })), 'без mount');
    assert(throwsError(() => register({ id: 'x', title: 'X', mount: () => ({ destroy() {} }) })), 'без defaults');
    assert(throwsError(() => register({ title: 'X', mount: () => ({ destroy() {} }), defaults: {} })), 'без id');
    assert(throwsError(() => register({ id: 'x', title: 'X', mount: () => ({ destroy() {} }), defaults: [] })), 'массив вместо defaults');
});

test('текст ошибки называет нарушенное поле', () => {
    clear();
    const noDefaults = throwsError(() => register({ id: 'x', title: 'X', mount: () => ({ destroy() {} }) }));
    assert(noDefaults.message.includes('defaults'), `про defaults: "${noDefaults.message}"`);
    const noMount = throwsError(() => register({ id: 'x', title: 'X', defaults: {} }));
    assert(noMount.message.includes('mount'), `про mount: "${noMount.message}"`);
});

test('defaults замораживается при регистрации', () => {
    clear();
    const defaults = { volume: 0.5 };
    register({ id: 'frozen', title: 'Заморозка', mount: () => ({ destroy() {} }), defaults });
    assert(Object.isFrozen(defaults), 'исходный объект заморожен');
    assert(Object.isFrozen(get('frozen').defaults), 'defaults в реестре заморожен');
});

test('clear опустошает реестр', () => {
    register(makeGame('a'));
    register(makeGame('b'));
    clear();
    assertEqual(list().length, 0, 'список пуст');
    assertEqual(get('a'), undefined, 'get не находит игру');
    assert(!has('b'), 'has не находит игру');
});

report('registry');
