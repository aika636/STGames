// Реестр игр хаба: единственный источник правды о том, какие игры установлены.
// Чистый модуль без DOM и без SillyTavern — лежит в src/, а не в src/ui/, чтобы
// его можно было тестировать под node и чтобы хаб мог собирать список игр,
// не касаясь браузера.
//
// Контракт игры (объект, который отдаёт register()):
//   id               — строка, уникальный ключ игры (обязательно);
//   title            — строка, имя в списке игр и в шапке окна (обязательно);
//   tagline          — строка, подпись под названием в списке игр;
//   icon             — класс иконки Font Awesome, например 'fa-solid fa-puzzle-piece';
//   defaults         — plain-объект с настройками игры (обязательно). Замораживается
//                      при регистрации, чтобы ни хаб, ни игра не меняли дефолты
//                      на лету и не делили состояние между партиями;
//   slash            — необязательно: имя слэш-команды без ведущего '/';
//   mount(root, api) — обязательная функция: строит UI игры внутри root и возвращает
//                      { destroy() }, который хаб вызывает при выходе из игры;
//   renderSettings(container, api) — необязательно: рисует панель настроек игры;
//   renderStats(container, api)    — необязательно: рисует статистику игры.
//
// Контракт api, который хаб передаёт в mount()/renderSettings()/renderStats():
//   settings      — объект настроек игры (defaults, слитый с сохранёнными значениями);
//   save()        — сохранить настройки (и партию) на диск;
//   toast(kind, message) — короткое уведомление, kind: 'info' | 'success' | 'error';
//   exitToHub()   — закрыть игру и вернуться в список;
//   isSoloGame()  — true, когда в реестре ровно одна игра: оболочка тогда не рисует
//                   кнопку возврата в хаб (список из одного пункта бесполезен).
//
// register() бросает Error при нарушении контракта, а не глушит ошибку fail-soft'ом:
// сломанный модуль игры — ошибка программиста, её надо увидеть сразу при старте.

const games = [];

function isPlainObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function register(game) {
    if (!game || typeof game !== 'object') {
        throw new Error('register: ожидается объект игры');
    }
    if (typeof game.id !== 'string' || game.id === '') {
        throw new Error(`register: у игры нет id (получено ${game.id})`);
    }
    if (typeof game.title !== 'string' || game.title === '') {
        throw new Error(`register: у игры "${game.id}" нет title`);
    }
    if (typeof game.mount !== 'function') {
        throw new Error(`register: у игры "${game.id}" mount должна быть функцией`);
    }
    if (!isPlainObject(game.defaults)) {
        throw new Error(`register: у игры "${game.id}" defaults должен быть plain-объектом`);
    }
    Object.freeze(game.defaults);

    const index = games.findIndex((g) => g.id === game.id);
    if (index === -1) {
        games.push(game);
    } else {
        // Повторная регистрация того же id (например, после хот-релоада модуля игры)
        // заменяет старую запись на её месте — порядок списка не сдвигается.
        games[index] = game;
    }
    return game;
}

export function list() {
    return games.slice();
}

export function get(id) {
    return games.find((g) => g.id === id);
}

export function has(id) {
    return games.some((g) => g.id === id);
}

export function clear() {
    games.length = 0;
}
