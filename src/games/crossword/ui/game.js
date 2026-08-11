// Экран кроссворда-скелета. Оболочка (src/shell/modal.js) создаёт контейнер root и зовёт
// createCrosswordScreen(root, api); про попап и SillyTavern этот модуль ничего не знает.
//
// Асинхронный старт, как у «Слов»: пул готовых головоломок весит 82 КБ и грузится
// динамическим import() при первом открытии, а не приезжает с каждой загрузкой таверны.
// mount() при этом остаётся СИНХРОННЫМ (контракт реестра): окно сразу показывает
// «Загружаю…», а отложенный колбэк первой строкой проверяет, жив ли ещё экран, —
// правило 7 и правило 9 из docs/games.md.
//
// --- ВВОД ---------------------------------------------------------------------------
//
// Ход — это «слово из банка в слот», поэтому ввод устроен в два тапа и без
// перетаскивания (перетаскивание в модалке поверх чата на телефоне — источник промахов):
//
//   1. тап по клетке выбирает СЛОВО, а не клетку: слот, накрывающий клетку, подсвечивается
//      целиком. Клетка на пересечении принадлежит двум слотам, и повторный тап по той же
//      клетке переключает across ⇄ down — так же, как в бумажных и во всех экранных
//      кроссвордах;
//   2. тап по слову в банке ставит его в выбранный слот. Слово, стоявшее там раньше,
//      возвращается в банк само (`placeWord`);
//   3. тап по УЖЕ разложенному слову в банке снимает его со своего слота обратно
//      (`clearSlot`). То же делает кнопка «Убрать» и Enter/Backspace на сетке.
//
// Клавиатура — на элементе сетки, а не на document: игра событийная и полностью
// локальная (как реверси и сапёр). Стрелки ходят по клеткам, но сначала переключают
// направление: стрелка «вправо» на клетке, где выбрано вертикальное слово, сначала
// выберет горизонтальное и только следующим нажатием сдвинет курсор — иначе выбрать
// второе слово пересечения с клавиатуры было бы нечем. Tab не перехватывается: слова
// банка — настоящие кнопки, и обход табом работает сам. Esc не трогаем — его получает
// попап.
//
// Время считается по часам (elapsed + сейчас − отметка старта), а не тиком таймера:
// фоновая вкладка получает свой интервал раз в минуту, и партия, свёрнутая на десять
// минут, насчитала бы десять секунд.

import { logError } from '../../../log.js';
import {
    EMPTY,
    canPlace,
    checkWin,
    clearSlot,
    createGame,
    deserialize,
    lettersOf,
    pendingCells,
    placeWord,
    remaining,
    serialize,
    slotOfWord,
    wrongCells,
    wrongSlots,
} from '../core/game.js';
import { ACROSS, BLOCK, DOWN, pickPuzzle, slotAt } from '../core/puzzles.js';
import { recordPlayed, recordSolved } from '../core/stats.js';
import { formatTime, levelLabel, LEVELS, normalizeLevel } from '../settings.js';
import { createBoard } from './board.js';

const TICK_MS = 1000;

const KEY_DELTA = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
};

// Почему слово не встало — словами игроку. 'over' и 'slot'/'word' в UI недостижимы,
// но пусть у каждой причины будет подпись: молчаливый отказ выглядит поломкой.
const REASONS = {
    over: 'Кроссворд уже собран',
    slot: 'Сначала выберите место в сетке',
    word: 'Такого слова в банке нет',
    length: 'Слово не той длины',
    used: 'Это слово уже разложено',
    conflict: 'Буквы не сходятся на пересечении',
};

// Пул грузится один раз на сессию: import() кэширует модуль сам, но своя обёртка нужна,
// чтобы не пересобирать промис на каждое открытие окна.
let poolPromise = null;

function loadPool() {
    if (!poolPromise) {
        poolPromise = import('../data/puzzles.js')
            .then((module) => module.default)
            .catch((err) => {
                // Неудачную загрузку не кэшируем: следующее открытие окна должно
                // пробовать снова, иначе одна осечка ломает игру до перезагрузки страницы.
                poolPromise = null;
                throw err;
            });
    }
    return poolPromise;
}

export function createCrosswordScreen(root, api) {
    const settings = api.settings;

    // Уровень из слэш-команды (`/crossword hard`) пишется в настройки, а не живёт
    // отдельным локальным значением: селектор в шапке и панель настроек читают одно
    // и то же место. Явный уровень означает новую головоломку, вход без аргумента
    // продолжает сохранённую партию.
    const requestedLevel = api.args?.level;
    const resume = !requestedLevel;
    if (requestedLevel) {
        settings.level = normalizeLevel(requestedLevel);
        try {
            api.save();
        } catch (err) {
            logError('не удалось сохранить настройки кроссворда', err);
        }
    }

    root.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'crossword-root';
    screen.tabIndex = -1;
    root.appendChild(screen);

    const loading = document.createElement('div');
    loading.className = 'crossword-loading';
    loading.textContent = 'Загружаю головоломки…';
    screen.appendChild(loading);

    let destroyed = false;
    let live = null;

    loadPool().then((pool) => {
        // Оболочка размонтирует игру синхронно и загрузку не ждёт: за это время окно
        // могло закрыться или уйти в хаб.
        if (destroyed) return;
        loading.remove();
        try {
            live = buildScreen(screen, api, pool, resume);
        } catch (err) {
            logError('не удалось построить экран кроссворда', err);
            screen.textContent = 'Игра не открылась';
        }
    }).catch((err) => {
        if (destroyed) return;
        logError('не удалось загрузить пул головоломок кроссворда', err);
        loading.textContent = 'Не удалось загрузить головоломки';
    });

    return {
        destroy() {
            // Идемпотентен: оболочка зовёт destroy() и при выходе в хаб, и в finally
            // закрытия попапа.
            if (destroyed) return;
            destroyed = true;
            // Сохранение — до вырывания экрана из DOM: закрытие окна не должно стоить
            // игроку партии (правило 8).
            live?.destroy();
            live = null;
            root.innerHTML = '';
        },
        refresh() {
            if (destroyed) return;
            live?.refresh();
        },
    };
}

function buildScreen(screen, api, pool, resume) {
    const settings = api.settings;

    // --- Разметка

    const header = document.createElement('div');
    header.className = 'crossword-header';

    const levelSelect = document.createElement('select');
    levelSelect.className = 'crossword-select text_pole';
    for (const level of LEVELS) {
        const option = document.createElement('option');
        option.value = level;
        option.textContent = levelLabel(level);
        levelSelect.appendChild(option);
    }
    levelSelect.value = normalizeLevel(settings.level);

    const leftEl = document.createElement('span');
    leftEl.className = 'crossword-left';
    const timerEl = document.createElement('span');
    timerEl.className = 'crossword-timer';

    const info = document.createElement('div');
    info.className = 'crossword-info';
    info.append(leftEl, timerEl);

    const newGameBtn = document.createElement('button');
    newGameBtn.type = 'button';
    newGameBtn.className = 'crossword-btn menu_button';
    newGameBtn.textContent = 'Новая';

    header.append(levelSelect, info, newGameBtn);

    const boardBox = document.createElement('div');
    boardBox.className = 'crossword-board-box';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'crossword-clear menu_button';
    clearBtn.textContent = 'Убрать';
    clearBtn.title = 'Снять слово с выбранного места';

    // Переход к следующему свободному месту. На сетке, добранной пересечениями, глазами
    // такое место не найти — оно выглядит заполненным (бледные буквы это и показывают,
    // но тыкать в них на телефоне всё равно неудобно).
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'crossword-next menu_button';
    nextBtn.textContent = 'Дальше';
    nextBtn.title = 'Перейти к следующему свободному месту';

    const status = document.createElement('div');
    status.className = 'crossword-status';

    const tools = document.createElement('div');
    tools.className = 'crossword-tools';
    tools.append(clearBtn, nextBtn, status);

    screen.append(header, boardBox, tools);

    // --- Состояние экрана

    let destroyed = false;
    let board = null;
    let tickId = null;
    // Уровень, под которым партия учтена в статистике. Замораживается на старте:
    // «сыграно» пишется в начале, результат в конце, и уехать в разные строки таблицы
    // они не должны.
    let statsLevel = normalizeLevel(settings.level);
    let recorded = false;
    let counted = false;
    // Отметка запуска часов. null — часы стоят (партия не начата или окончена).
    let clockSince = null;
    let cursor = 0;
    let selected = null;
    let dir = ACROSS;

    const restored = resume ? restoreGame() : null;
    let state = restored?.state ?? newPuzzle(statsLevel);
    if (restored) {
        statsLevel = restored.level;
        levelSelect.value = statsLevel;
        // Восстановленная партия уже посчитана там, где началась. Пустая сетка — ещё нет:
        // партия начинается с первого разложенного слова.
        counted = hasPlaced(state);
    }

    mountBoard();
    selectFirstEmpty();
    if (counted && !state.over) startClock();
    render();
    tickId = setInterval(() => {
        if (destroyed || clockSince === null) return;
        timerEl.textContent = formatTime(elapsed());
    }, TICK_MS);

    function newPuzzle(level) {
        const puzzle = pickPuzzle(pool, level);
        if (!puzzle) throw new Error(`в пуле нет головоломок уровня ${level}`);
        return createGame(puzzle, level);
    }

    function hasPlaced(current) {
        for (const word of current.placed) {
            if (word !== EMPTY) return true;
        }
        return false;
    }

    // --- Сетка
    //
    // Пересобирается при новой головоломке: сетка и банк принадлежат конкретной
    // головоломке, а не экрану.

    function mountBoard() {
        board?.board.removeEventListener('keydown', onKey);
        board?.destroy();
        boardBox.textContent = '';
        board = createBoard({
            puzzle: state.puzzle,
            onCell: handleCell,
            onWord: handleWord,
        });
        board.board.addEventListener('keydown', onKey);
        boardBox.appendChild(board.root);
    }

    // --- Выбор слота
    //
    // Тап по клетке выбирает слово. На пересечении клетка принадлежит двум словам,
    // и повторный тап по той же клетке переключает направление.

    function selectCell(cell, { toggle = false, prefer = null } = {}) {
        if (state.puzzle.grid[cell] === BLOCK) return false;
        const across = slotAt(state.puzzle, cell, ACROSS);
        const down = slotAt(state.puzzle, cell, DOWN);

        let want = prefer ?? dir;
        if (toggle && cell === cursor && across && down) {
            want = dir === ACROSS ? DOWN : ACROSS;
        }

        const chosen = (want === ACROSS ? across : down) ?? across ?? down;
        if (!chosen) return false;

        cursor = cell;
        dir = chosen.dir;
        selected = chosen.index;
        return true;
    }

    function selectSlot(index) {
        const slot = state.puzzle.slots[index];
        if (!slot) return;
        selected = index;
        dir = slot.dir;
        cursor = slot.cells[0];
    }

    function selectFirstEmpty() {
        for (let slot = 0; slot < state.placed.length; slot++) {
            if (state.placed[slot] === EMPTY) {
                selectSlot(slot);
                return;
            }
        }
        selectSlot(0);
    }

    // После постановки выбор переезжает на следующее пустое место: игрок раскладывает
    // банк подряд, и тыкать в сетку между каждыми двумя словами утомительно.
    function selectNextEmpty() {
        const total = state.placed.length;
        for (let step = 1; step <= total; step++) {
            const slot = (selected + step) % total;
            if (state.placed[slot] === EMPTY) {
                selectSlot(slot);
                return;
            }
        }
    }

    // --- Отрисовка

    function render() {
        const left = remaining(state);
        leftEl.textContent = state.over ? 'Готово' : `Осталось слов: ${left}`;
        timerEl.textContent = formatTime(elapsed());
        timerEl.style.display = settings.showTimer === false ? 'none' : '';

        clearBtn.disabled = state.over || selected === null || state.placed[selected] === EMPTY;
        nextBtn.disabled = state.over || left === 0;

        const highlight = Boolean(settings.highlightMistakes);
        board.render(state, {
            cursor,
            slot: selected,
            pending: new Set(pendingCells(state)),
            wrongCells: highlight ? new Set(wrongCells(state)) : undefined,
            wrongSlots: highlight ? new Set(wrongSlots(state)) : undefined,
        });

        status.textContent = state.over
            ? `Кроссворд собран за ${formatTime(elapsed())}`
            : hint(left);
    }

    // Подсказка для состояния, в котором сетка выглядит собранной, а слова остались:
    // все буквы пришли с пересечений, и часть мест по-прежнему пуста. Бледные буквы
    // это показывают, но словами надёжнее — иначе игра выглядит зависшей.
    function hint(left) {
        if (left === 0) return '';
        if (lettersOf(state).includes(' ')) return '';
        return `Буквы сошлись на пересечениях: разложите оставшиеся слова (${left})`;
    }

    // --- Часы

    function elapsed() {
        if (clockSince === null) return state.elapsed;
        return state.elapsed + (Date.now() - clockSince) / 1000;
    }

    function startClock() {
        if (clockSince === null) clockSince = Date.now();
    }

    // Сворачивает набежавшее время в состояние. Зовётся перед каждым сохранением: иначе
    // в settings.json уехала бы партия с «бегущей» отметкой, и пауза между сессиями
    // засчиталась бы игроку (те же грабли, что в судоку).
    function stopClock() {
        if (clockSince === null) return;
        state.elapsed += (Date.now() - clockSince) / 1000;
        clockSince = null;
    }

    // --- Ход

    function handleCell(cell) {
        if (destroyed) return;
        if (selectCell(cell, { toggle: true })) render();
    }

    function handleWord(wordIndex) {
        if (destroyed || state.over) return;

        // Тап по уже разложенному слову возвращает его в банк — где бы оно ни лежало.
        const holder = slotOfWord(state, wordIndex);
        if (holder !== EMPTY) {
            if (clearSlot(state, holder)) {
                selectSlot(holder);
                afterMove();
            }
            return;
        }

        if (selected === null) {
            notify(REASONS.slot);
            return;
        }

        const verdict = canPlace(state, selected, wordIndex);
        if (!verdict.ok) {
            notify(REASONS[verdict.reason] ?? 'Так это слово не встаёт');
            render();
            return;
        }

        if (!placeWord(state, selected, wordIndex)) return;
        selectNextEmpty();
        afterMove();
    }

    function clearSelected() {
        if (state.over || selected === null) return;
        if (clearSlot(state, selected)) afterMove();
    }

    function gotoNextEmpty() {
        if (state.over || remaining(state) === 0) return;
        if (selected === null) selectFirstEmpty();
        else selectNextEmpty();
        render();
        focusCursor();
    }

    function afterMove() {
        // Партия начинается с первого разложенного слова, а не с открытия окна: игрок,
        // заглянувший на сетку и ушедший, партии не начинал.
        countPlayed();
        startClock();

        if (checkWin(state)) {
            stopClock();
            render();
            finish();
            return;
        }

        render();
        persist();
    }

    function finish() {
        persist();
        notify(`Кроссворд собран за ${formatTime(elapsed())}`, 'success');
        recordOutcome();
    }

    function startNewGame() {
        statsLevel = normalizeLevel(levelSelect.value);
        settings.level = statsLevel;

        let next;
        try {
            next = newPuzzle(statsLevel);
        } catch (err) {
            logError('не удалось выбрать головоломку', err);
            notify('Не удалось взять новую головоломку', 'error');
            return;
        }

        state = next;
        clockSince = null;
        recorded = false;
        counted = false;
        cursor = 0;
        selected = null;
        dir = ACROSS;
        // Сетка пересобирается всегда: у новой головоломки другая раскладка блоков
        // и другой банк, даже на том же уровне.
        mountBoard();
        selectFirstEmpty();
        persist();
        render();
    }

    // --- Сохранение партии

    function persist() {
        try {
            const running = clockSince !== null;
            stopClock();
            settings.savedGame = { ...serialize(state), level: statsLevel };
            save();
            if (running && !state.over) startClock();
        } catch (err) {
            logError('не удалось сохранить партию кроссворда', err);
        }
    }

    // Возвращает { state, level } или null. Собранный кроссворд не восстанавливаем:
    // открывать окно с готовой сеткой бессмысленно, игрок ждёт новую.
    function restoreGame() {
        try {
            const saved = settings.savedGame;
            const restoredState = deserialize(saved);
            if (!restoredState || restoredState.over) return null;
            return { state: restoredState, level: normalizeLevel(saved.level) };
        } catch (err) {
            logError('не удалось восстановить партию кроссворда', err);
            return null;
        }
    }

    // --- Статистика
    //
    // Побочная запись, а не ход: если она упадёт, партия должна продолжаться как ни в чём
    // не бывало, поэтому всё обёрнуто в try/catch.

    function countPlayed() {
        if (counted) return;
        counted = true;
        try {
            recordPlayed(settings.stats, statsLevel);
            save();
            api.renderAllStats?.();
        } catch (err) {
            logError('не удалось обновить статистику кроссворда', err);
        }
    }

    function recordOutcome() {
        if (recorded) return;
        recorded = true;
        try {
            const { bestTime } = recordSolved(settings.stats, statsLevel, Math.round(elapsed()));
            save();
            api.renderAllStats?.();
            if (bestTime) notify(`Новый рекорд уровня: ${formatTime(elapsed())}`, 'success');
        } catch (err) {
            logError('не удалось записать результат партии кроссворда', err);
        }
    }

    function save() {
        try {
            api.save();
        } catch (err) {
            logError('не удалось сохранить настройки кроссворда', err);
        }
    }

    function notify(message, kind = 'info') {
        try {
            api.toast(kind, message);
        } catch (err) {
            logError('не удалось показать уведомление', err);
        }
    }

    // --- Клавиатура
    //
    // Слушатель на сетке, а не на document: игра событийная и полностью локальная.
    // Глушим только обработанные клавиши, Esc и Tab не трогаем.

    function onKey(event) {
        if (destroyed) return;

        const delta = KEY_DELTA[event.key];
        if (delta) {
            event.preventDefault();
            event.stopPropagation();
            moveCursor(delta);
            render();
            focusCursor();
            return;
        }

        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            event.stopPropagation();
            clearSelected();
            focusCursor();
        }
    }

    // Стрелка сначала переключает направление, потом двигает курсор: иначе выбрать
    // второе слово пересечения с клавиатуры было бы нечем.
    function moveCursor(delta) {
        const want = delta.x !== 0 ? ACROSS : DOWN;
        if (dir !== want && slotAt(state.puzzle, cursor, want)) {
            selectCell(cursor, { prefer: want });
            return;
        }

        const cols = state.puzzle.cols;
        const rows = state.puzzle.rows;
        let x = cursor % cols;
        let y = Math.floor(cursor / cols);
        // Блоки перешагиваются: остановиться на блоке нельзя, а прыгать через него
        // по пустой сетке — обычное поведение кроссворда.
        for (;;) {
            x += delta.x;
            y += delta.y;
            if (x < 0 || y < 0 || x >= cols || y >= rows) return;
            const cell = y * cols + x;
            if (state.puzzle.grid[cell] !== BLOCK) {
                selectCell(cell, { prefer: want });
                return;
            }
        }
    }

    function focusCursor() {
        board.cells[cursor]?.focus?.({ preventScroll: true });
    }

    levelSelect.addEventListener('change', () => {
        settings.level = normalizeLevel(levelSelect.value);
        save();
        startNewGame();
    });

    newGameBtn.addEventListener('click', () => {
        newGameBtn.blur();
        startNewGame();
    });

    clearBtn.addEventListener('click', () => {
        clearBtn.blur();
        clearSelected();
    });

    nextBtn.addEventListener('click', () => {
        nextBtn.blur();
        gotoNextEmpty();
    });

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            clearInterval(tickId);
            tickId = null;
            board?.board.removeEventListener('keydown', onKey);
            board?.destroy();
            // Сохранение — до вырывания экрана из DOM (правило 8): корень чистит
            // внешний destroy(), уже после этого вызова.
            stopClock();
            persist();
        },
        refresh() {
            if (destroyed) return;
            const level = normalizeLevel(settings.level);
            // Уровень мог смениться в панели настроек: селектор в шапке — тот же
            // источник правды, но другой элемент. Начатую партию не трогаем.
            if (levelSelect.value !== level && !counted) {
                levelSelect.value = level;
                startNewGame();
                return;
            }
            render();
        },
    };
}
