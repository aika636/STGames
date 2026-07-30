# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Sudoku** — клиентское UI-расширение SillyTavern: игра в судоку в модальном окне поверх чата.
LLM в игре **не участвует**, `ctx.chat` не читается и не пишется, сетевых вызовов нет. Точки
соприкосновения с ST — только кнопка запуска, попап и `extensionSettings` (сохранение партии).

Головоломки генерируются **локально в JS** (полное решение backtracking'ом + выкалывание клеток
с проверкой единственности решения). Готовых наборов пазлов нет.

План разработки и фазы: `docs/roadmap.md`. Текущее состояние, команды, чеклист ручной
проверки и известные грабли: `docs/development.md`.

## Runtime constraints

- **No build step.** Plain ES-модули + CSS, грузятся браузером напрямую. Без бандлеров,
  TypeScript и runtime-зависимостей от npm.
- **No backend.** Только UI-расширение, `server-plugin/` нет.
- **Access SillyTavern through `SillyTavern.getContext()`**, не через относительные импорты
  `../../../../script.js`. Контекст **не кэшировать** в переменной модуля.
- **`src/core/` не знает о DOM и о SillyTavern** — чистые функции над данными, тестируемые
  под `node`. Вся привязка к браузеру — в `src/ui/`.
- **Fail soft:** ошибка внутри игры логируется с префиксом `[Sudoku]` и не роняет UI таверны.

## Layout

```
manifest.json    # ST extension descriptor (loading_order 100, requires: [])
index.js         # точка входа: панель настроек, запуск игры
src/ctx.js       # getContext()/event_types-хелпер, toast()
src/log.js       # логи [Sudoku], warnOnce()
src/settings.js  # DEFAULT_SETTINGS, merge-on-load, биндинг settings.html
src/core/        # rng / grid / solver / rate / generator / game — чистая логика, DOM-free
src/ui/          # board / modal / launcher / input — DOM и связь с ST
tests/           # node-тесты; ядро — без зависимостей, UI — под jsdom (_harness.mjs)
style.css        # стили, префикс .sudoku-
settings.html    # панель в Extensions drawer
docs/            # roadmap (фазы, риски) / development (состояние, команды) /
                 # sillytavern-api (проверенные API ST 1.18.0)
deploy.sh        # rsync на тестовом стенде
```

Держать `index.js` тонким: он связывает модули, логика — в `src/`.

## Commands

```bash
node --check index.js          # синтаксис без браузера
node tests/solver.test.mjs     # решатель + операции над сеткой
node tests/generator.test.mjs  # генератор и оценка сложности (100 головоломок на уровень)
node tests/generator.test.mjs 10   # быстрый прогон: 10 на уровень
node tests/game.test.mjs       # модель партии: ходы, пометки, undo/redo, таймер
npm install --no-save jsdom && node tests/ui.test.mjs      # доска, окно, точки запуска
node tests/input.test.mjs      # ввод: клавиатура, заметки, undo, победа (jsdom)
./deploy.sh                    # залить на тестовый ST (тестовом стенде) + хардрелоад вкладки
```

Тесты без зависимостей: свой раннер `tests/_harness.mjs`, npm-пакеты не нужны.

## Ядро (`src/core/`)

Сетка — плоский массив из 81 числа (0 = пусто), он же уходит в `extensionSettings` без
конвертации. Солвер держит занятые цифры в 9-битных масках строк/столбцов/боксов и выбирает
клетку с минимумом кандидатов (MRV); `countSolutions(grid, 2)` с ранним выходом на втором
решении — основа проверки единственности при генерации.

Уровень сложности (`rate.js`) = максимум из «уровня по технике» (одиночки → locked
candidates → пары) и «уровня по числу подсказок» (≥38 easy, ≥32 medium, ниже hard).
**Expert выдаётся только за нехватку техники**, не за число подсказок — почему именно так,
написано в шапке `rate.js`.

Партия (`game.js`) — три массива по 81 элементу (`puzzle` / `values` / `notes`-маски).
Каждый ход пишется в историю как «клетки до → клетки после», поэтому undo/redo не зависят
от типа операции и откатывают в том числе авточистку пометок у соседей.

## UI (`src/ui/`)

`input.js` не хранит состояние партии — он превращает события браузера в вызовы
обработчиков; ход, выделение, режим заметок и проверка победы живут в `modal.js`.
Слушатель клавиатуры висит на `document` в capture-фазе только при открытом окне и гасит
**только обработанные** клавиши, иначе цифры уедут в чат. Экранного ряда цифр нет: ввод
с клавиатуры, под доской — счётчик оставшихся и четыре кнопки действий. Раскладка клавиш
и подводные камни — `docs/development.md`, раздел «Как устроен ввод».

Цвета: акцент и линии из переменных ST, заливки — `color-mix` от `currentColor` (окно
подхватывает любую тему, включая светлые), у каждого такого правила есть фолбэк-строка.

## Связь с SillyTavern

Всё, что расширение берёт у таверны, — в `docs/sillytavern-api.md` (проверено на 1.18.0).
Кратко: `extensionSettings`, `saveSettingsDebounced`, `callGenericPopup` +
`POPUP_TYPE.DISPLAY`, `SlashCommandParser`, `#extensionsMenu`, `APP_READY`. Никаких
относительных импортов из `public/` и никакой работы с чатом.

## Conventions

- Namespace: `MODULE_NAME = 'Sudoku'`, CSS-классы `sudoku-*`, настройки в
  `ctx.extensionSettings.Sudoku` (camelCase `extensionSettings`, не `extension_settings`).
- Настройки: замороженный `DEFAULT_SETTINGS` + мерж недостающих ключей при загрузке.
- `event_types` vs `eventTypes`: только через `getEventTypes(ctx)`, подписку пропускать, если
  имени события нет.
- Любое предположение о внутренностях ST проверять на живой инсталляции (ST 1.18.0,
  `http://<тестовый ST>`) и записывать в `docs/sillytavern-api.md` с версией ST.
