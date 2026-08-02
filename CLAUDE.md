# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**STGames** — клиентское UI-расширение SillyTavern: платформа мини-игр с хабом, из которого
игры открываются в модальном окне поверх чата. Сейчас в каталоге судоку и змейка; как
добавить свою игру — `docs/games.md`. LLM в играх **не участвует**, `ctx.chat` не читается
и не пишется, сетевых вызовов нет. Точки соприкосновения с ST — кнопка в wand-меню, попап
и `extensionSettings` (настройки, партии, статистика).

План разработки и фазы: `docs/roadmap.md`. Текущее состояние, команды, чеклист ручной
проверки и известные грабли: `docs/development.md`.

## Runtime constraints

- **No build step.** Plain ES-модули + CSS, грузятся браузером напрямую. Без бандлеров,
  TypeScript и runtime-зависимостей от npm.
- **No backend.** Только UI-расширение, `server-plugin/` нет.
- **Access SillyTavern through `SillyTavern.getContext()`**, не через относительные импорты
  `../../../../script.js`. Контекст **не кэшировать** в переменной модуля.
- **`src/games/*/core/` не знает о DOM и о SillyTavern** — чистые функции над данными,
  тестируемые под `node`. Вся привязка к браузеру — в `src/games/*/ui/` и `src/shell/`.
- **Fail soft:** ошибка внутри расширения логируется с префиксом `[STGames]` и не роняет
  UI таверны.

## Layout

```
manifest.json    # ST extension descriptor (loading_order 100, requires: [])
index.js         # тонкая точка входа: регистрация игр, инициализация UI
src/ctx.js       # getContext()/event_types-хелпер, toast()
src/log.js       # логи [STGames], warnOnce()
src/settings.js  # extensionSettings.STGames, merge-on-load, миграция со старого Sudoku
src/registry.js  # реестр игр: register()/list()/get(), проверка контракта
src/shell/       # оболочка: modal (попап и сессия), hub (список игр), launcher,
                 # settings-ui (общая панель настроек)
src/games/       # по папке на игру: sudoku/, snake/ — внутри core/ (чистая логика)
                 # и ui/ (DOM); контракт игры — src/registry.js и docs/games.md
tests/           # node-тесты; ядро — без зависимостей, UI — под jsdom (_harness.mjs)
style.css        # стили, префиксы .stg-, .sudoku-, .snake-
settings.html    # каркас панели в Extensions drawer
docs/            # games (контракт игры) / roadmap (фазы, риски) / development
                 # (состояние, команды) / sillytavern-api (проверенные API ST 1.18.0)
deploy.sh        # rsync на тестовый ST (не в git)
```

Держать `index.js` тонким: он связывает модули, логика — в `src/`.

## Commands

```bash
node --check index.js     # синтаксис без браузера
npm install --no-save jsdom  # UI-тесты нуждаются в jsdom; runtime-зависимостей нет
node tests/run.mjs        # все тесты (свой раннер, подкаталоги tests/*)
node tests/run.mjs sudoku # фильтр: только судоку
node tests/run.mjs snake  # фильтр: только змейка
./deploy.sh               # залить на тестовый ST + хардрелоад вкладки
```

Тесты без зависимостей: свой раннер `tests/_harness.mjs`, npm-пакеты не нужны (кроме jsdom
для UI-тестов).

## Игры

Каждая игра — plain-объект по контракту реестра: `id`, `title`, `tagline`, `icon`,
`defaults`, опциональные `slash` и `renderSettings`/`renderStats`, и обязательная
`mount(root, api)`, возвращающая `{ destroy() }`. Хаб передаёт в `mount` `api` с живыми
настройками игры, `save()`, `toast()`, `exitToHub()` и `isSoloGame()`. Полный контракт,
жизненный цикл и рецепт «добавь свою игру» — `docs/games.md`.

## Conventions

- Namespace: `MODULE_NAME = 'STGames'`, CSS-классы с префиксами `stg-` (оболочка и хаб),
  `sudoku-`, `snake-` (игры), настройки в `ctx.extensionSettings.STGames`
  (camelCase `extensionSettings`, не `extension_settings`).
- Настройки: замороженные дефолты в `game.defaults` + мерж недостающих ключей при чтении;
  ключи верхнего уровня STGames (`version`/`lastGame`/`games`) правит только `src/settings.js`.
- `event_types` vs `eventTypes`: только через `getEventTypes(ctx)`, подписку пропускать, если
  имени события нет.
- Любое предположение о внутренностях ST проверять на живой инсталляции (ST 1.18.0)
  и записывать в `docs/sillytavern-api.md` с версией ST.
