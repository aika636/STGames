# API SillyTavern, на которые опирается STGames

Всё проверено на живой инсталляции **SillyTavern 1.18.0** (docker `ghcr.io/sillytavern/sillytavern:latest`),
чтением исходников внутри контейнера
(`/home/node/app/public/`). Дата проверки: 2026-07-31.

Расширение не читает и не пишет чат, поэтому список коротких зависимостей ниже — это
вообще всё, что оно берёт у таверны.

## 1. Контекст

`SillyTavern.getContext()` (`public/scripts/st-context.js`). Контекст не кэшируется в
переменной модуля — запрашивается заново в каждой функции (`src/ctx.js`).

| Поле | Зачем | Статус |
|---|---|---|
| `extensionSettings` | настройки, партии и статистика игр под ключом `STGames` | ✔ есть, camelCase |
| `saveSettingsDebounced()` | сохранение настроек | ✔ есть |
| `callGenericPopup(content, type, value, options)` | окно игры | ✔ есть |
| `POPUP_TYPE` | тип окна | ✔ есть |
| `SlashCommandParser`, `SlashCommand` | регистрация `/stgames`, `/sudoku`, `/snake` | ✔ есть |
| `SlashCommandArgument`, `SlashCommandEnumValue`, `ARGUMENT_TYPE` | подсказки к аргументу команды | ✔ есть |
| `registerSlashCommand` | устаревший фолбэк регистрации | ✔ есть, помечен `@deprecated` |
| `eventSource`, `eventTypes` / `event_types` | подписка на `APP_READY` | ✔ есть **оба** алиаса |
| `isMobile` | пока не используется | ✔ есть |

**`event_types` vs `eventTypes`.** В 1.18.0 контекст экспортирует оба: `eventTypes: event_types`
и, отдельной строкой с пометкой «Legacy snake-case naming, compatibility with old extensions»,
`event_types: event_types`. Хелпер `getEventTypes(ctx)` в `src/ctx.js` всё равно проверяет оба —
это дешевле, чем однажды поймать падение на другой версии.

**Синхронного `saveSettings` в контексте нет** — только `saveSettingsDebounced()`
(`st-context.js:35,131`, проверено на 1.18.0, 2026-08-08). Для расширения это неважно:
оно всегда пишет через дебаунс. Важно для e2e — «сохранил» там означает «дождался ответа
на `POST /api/settings/save`»; иначе `reload()` успевает случиться раньше записи
(`flushSettings()` в `tests/e2e/_st.mjs`).

## 1a. Запуск ST для тестов

Флаги `server.js` (`src/command-line.js`, 1.18.0) — на них держится изолированный
инстанс для e2e:

| Флаг | Зачем |
|---|---|
| `--dataRoot <путь>` | свой каталог данных: тесты не трогают личную таверну |
| `--port <n>` | свой порт, не мешая уже запущенному ST |
| `--listen false` | только 127.0.0.1 |
| `--browserLaunchEnabled false` | не открывать окно браузера на каждый прогон |
| `--configPath <файл>` | свой config.yaml, если понадобится |

Расширения ищутся per-user: `<dataRoot>/default-user/extensions/<Имя>`. Каталог может быть
симлинком на рабочее дерево — ST ходит по нему нормально. Выключенные расширения ST хранит
в `extension_settings.disabledExtensions` (`public/scripts/extensions.js:146`), по умолчанию
список пуст, так что свежепоставленное расширение включено.

## 2. Попап

`callGenericPopup` (`public/scripts/popup.js:909`) — тонкая обёртка над `new Popup(...).show()`,
возвращает промис, который резолвится, когда пользователь закрыл окно. На этом построен
жизненный цикл оболочки: `openShell()` из `src/shell/modal.js` ждёт этот промис и в
`finally` размонтирует экран игры (`destroy()`) и освобождает сессию.

Значения `POPUP_TYPE` (`popup.js:9`):

```
TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4, CROP: 5
```

Игра использует **`DISPLAY` (4)** — «Popup without any button controls. Used to simply display
content, with a small X in the corner». Ровно то, что нужно доске: ни OK, ни Cancel, закрытие
крестиком и по Esc. Числовой фолбэк `?? 4` оставлен на случай, если `POPUP_TYPE` не окажется
в контексте.

Использованные опции (полный список — `popup.js:39–62`, JSDoc `PopupOptions`):

* `wider: true` — окно шире обычного без растягивания по высоте;
* `allowVerticalScrolling: true` — доска не обрежется на низких экранах;
* `animation: 'fast'`.

Есть и `allowEscapeClose` (по умолчанию `true`) — специально не трогаем: закрытие по Esc нужно.

**Фолбэк.** Если `callGenericPopup` в контексте нет, `src/shell/modal.js` показывает собственный
оверлей `.stg-overlay` с крестиком, закрытием по Esc и по клику мимо окна. Путь покрыт
тестом (`tests/shell/shell.test.mjs`).

## 3. Кнопка в wand-меню

Контейнер — `#extensionsMenu`, он живёт в шаблоне `public/scripts/templates/wandMenu.html` и
добавляется в `document.body` при инициализации расширений (`extensions.js:690`).

Формат пункта меню (как у штатных расширений, `stable-diffusion/button.html`):

```html
<div class="list-group-item flex-container flexGap5">
    <div class="fa-solid fa-dice extensionsMenuExtensionButton"></div>
    <span>Мини-игры</span>
</div>
```

**Кнопку меню показывать самим не надо.** `showHideExtensionsMenu()` (`extensions.js:228`)
крутится по `setInterval` раз в секунду, считает видимых детей `#extensionsMenu` и сам
переключает `#extensionsMenuButton`. То есть достаточно добавить свой пункт в любой момент
после загрузки — палочка появится сама.

Клик по любому месту вне списка `['#sd_gen', '#extensionsMenuButton', '#roll_dice']`
(`extensions.js:717`) закрывает выпадающее меню. Наш пункт в исключения не входит — меню
закроется при клике по нему, и это то поведение, которое нужно: открылось окно игры.

## 4. Слэш-команда

Актуальный API (как в штатном `token-counter/index.js:112`):

```js
ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
    name: 'stgames',
    callback,
    helpString,
    unnamedArgumentList: [...],
}));
```

Команды игр (`/sudoku`, `/snake`) регистрируются той же функцией, аргументы — из
`game.slash` (см. `docs/games.md`). `registerSlashCommand` в контексте ещё есть, но помечен
`@deprecated` — используется только как фолбэк. Если нет ни того, ни другого, расширение
логирует одно предупреждение и живёт с одной кнопкой в меню (`src/shell/launcher.js`).

## 5. Панель настроек

`settings.html` подгружается через `$.get(new URL('../../settings.html', import.meta.url).href)`
из `src/shell/settings-ui.js` и добавляется в `#extensions_settings`. Делать это можно только
после `APP_READY`; страховка — отложенный вызов через 3 с на случай, если событие уже прошло
до загрузки модуля.

Классы, которые расширение переиспользует у таверны: `inline-drawer` / `inline-drawer-toggle` /
`inline-drawer-content` (сворачиваемый блок), `checkbox_label`, `text_pole`, `menu_button`,
`list-group-item flex-container flexGap5`.

## 6. CSS-переменные темы

Доска и змейка красятся переменными темы, чтобы не выбиваться из оформления:
`--SmartThemeBodyColor`, `--SmartThemeBorderColor`, `--SmartThemeQuoteColor`,
`--SmartThemeBlurTintColor`, а также `--black30a`, `--black70a`, `--white30a`.

## 7. Что ещё не проверено на живой инсталляции

* Перехват клавиатуры: ST вешает глобальные хоткеи, и клавиши игр при открытом окне не должны
  улетать в поле ввода чата (обработчики только при открытом окне + `stopPropagation` на
  обработанных клавишах; см. `docs/development.md` и `docs/games.md`).
* Как доска и змейка выглядят в светлой теме и на мобильной ширине.
* Поведение попапа при открытии поверх другого попапа ST.
* Змейка на живом телефоне: свайпы и d-pad (проверено в jsdom, глазами — нет).
