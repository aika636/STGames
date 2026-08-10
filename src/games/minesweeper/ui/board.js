// Поле сапёра в DOM. Модуль знает про DOM, но ничего не знает ни про SillyTavern, ни
// про правила: на вход ему дают состояние из core/engine.js, наружу он отдаёт корневой
// элемент, render() и обработчики ввода.
//
// Сетка строится один раз, render() только переставляет классы и подписи — приём из
// sudoku/ui/board.js и reversi/ui/board.js.
//
// Главное здесь — ввод. У сапёра два разных действия на одной клетке, и на мыши они
// разведены кнопками (левая открывает, правая ставит флажок), а на тач-экране правой
// кнопки нет. Поэтому:
//   * мышь — click открывает, contextmenu ставит флажок, средняя кнопка делает аккорд;
//   * палец — короткий тап открывает, долгое нажатие (LONG_PRESS_MS) ставит флажок.
// Долгое нажатие обязано гасить последующий click: иначе один жест и пометит клетку,
// и откроет её.

const LONG_PRESS_MS = 400;
// Насколько палец может уехать, чтобы жест всё ещё считался нажатием, а не прокруткой.
const MOVE_TOLERANCE = 12;

export function createBoard({ cols, rows, onOpen, onFlag, onChord }) {
    const root = document.createElement('div');
    root.className = 'minesweeper-board';
    root.setAttribute('role', 'grid');
    root.setAttribute('aria-label', 'Поле сапёра');
    root.style.setProperty('--minesweeper-cols', String(cols));
    root.style.setProperty('--minesweeper-rows', String(rows));

    const cells = [];
    for (let index = 0; index < cols * rows; index++) {
        const cell = document.createElement('div');
        cell.className = 'minesweeper-cell';
        cell.setAttribute('role', 'gridcell');
        cell.id = `minesweeper-cell-${index}`;
        cell.tabIndex = -1;
        cell.dataset.idx = String(index);
        root.appendChild(cell);
        cells.push(cell);
    }

    // --- Ввод
    //
    // Все слушатели — на корне доски, делегированно: клеток до 256, и вешать на каждую
    // по четыре обработчика значило бы тысячу слушателей на партию.

    let pressIndex = null;
    let pressPoint = null;
    let longPressId = null;
    // Долгое нажатие уже отработало: гасим и click, и contextmenu, который браузер
    // шлёт следом за тем же жестом.
    let swallowNext = false;

    function cellIndexFrom(event) {
        const cell = event.target.closest?.('.minesweeper-cell');
        if (!cell || !root.contains(cell)) return null;
        return Number(cell.dataset.idx);
    }

    function cancelLongPress() {
        if (longPressId !== null) {
            clearTimeout(longPressId);
            longPressId = null;
        }
        pressIndex = null;
        pressPoint = null;
    }

    function onPointerDown(event) {
        const index = cellIndexFrom(event);
        if (index === null) return;
        swallowNext = false;
        // Долгое нажатие — только для пальца и пера. У мыши для флажка есть правая
        // кнопка, и «зависшая» левая не должна внезапно помечать клетку.
        if (event.pointerType === 'mouse') return;

        pressIndex = index;
        pressPoint = { x: event.clientX, y: event.clientY };
        longPressId = setTimeout(() => {
            longPressId = null;
            if (pressIndex === null) return;
            swallowNext = true;
            onFlag?.(pressIndex);
            pressIndex = null;
        }, LONG_PRESS_MS);
    }

    function onPointerMove(event) {
        if (pressPoint === null) return;
        const dx = Math.abs(event.clientX - pressPoint.x);
        const dy = Math.abs(event.clientY - pressPoint.y);
        if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) cancelLongPress();
    }

    function onClick(event) {
        if (swallowNext) {
            swallowNext = false;
            return;
        }
        const index = cellIndexFrom(event);
        if (index === null) return;
        onOpen?.(index);
    }

    // Правая кнопка мыши. preventDefault стоит всегда: контекстное меню браузера поверх
    // поля бесполезно, а на длинном тапе оно ещё и перебивает собственный жест.
    function onContextMenu(event) {
        event.preventDefault();
        const index = cellIndexFrom(event);
        if (index === null) return;
        if (swallowNext) {
            swallowNext = false;
            return;
        }
        onFlag?.(index);
    }

    // Средняя кнопка — аккорд. Отдельно от click: click средней кнопкой браузер не шлёт.
    function onAux(event) {
        if (event.button !== 1) return;
        const index = cellIndexFrom(event);
        if (index === null) return;
        event.preventDefault();
        onChord?.(index);
    }

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', cancelLongPress);
    root.addEventListener('pointercancel', cancelLongPress);
    root.addEventListener('pointerleave', cancelLongPress);
    root.addEventListener('click', onClick);
    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('auxclick', onAux);

    return {
        root,
        cells,
        render: (state, options) => render(root, cells, state, options),
        destroy() {
            cancelLongPress();
            root.removeEventListener('pointerdown', onPointerDown);
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerup', cancelLongPress);
            root.removeEventListener('pointercancel', cancelLongPress);
            root.removeEventListener('pointerleave', cancelLongPress);
            root.removeEventListener('click', onClick);
            root.removeEventListener('contextmenu', onContextMenu);
            root.removeEventListener('auxclick', onAux);
        },
    };
}

// reveal — партия окончена, мины показываются. wrong — флажки, поставленные не на мину:
// без них игрок после взрыва не понимает, где ошибся.
function render(root, cells, state, { cursor = null, reveal = false, wrong = EMPTY_SET } = {}) {
    for (let index = 0; index < cells.length; index++) {
        const cell = cells[index];
        const open = state.open[index] === 1;
        const flag = state.flag[index] === 1;
        const mine = state.mine[index] === 1;
        // Мина показывается только после конца партии — и не та, на которой взорвались:
        // у неё своя метка.
        const showMine = reveal && mine && !wrong.has(index);
        const number = open && !mine ? state.count[index] : 0;

        cell.className = 'minesweeper-cell';
        if (open) cell.classList.add('minesweeper-open');
        if (flag && !open) cell.classList.add('minesweeper-flag');
        if (showMine) cell.classList.add('minesweeper-mine');
        if (wrong.has(index)) cell.classList.add('minesweeper-wrong');
        if (state.exploded === index) cell.classList.add('minesweeper-boom');
        if (number > 0) cell.classList.add(`minesweeper-n${number}`);

        const isCursor = index === cursor;
        if (isCursor) cell.classList.add('minesweeper-cursor');
        cell.setAttribute('aria-selected', isCursor ? 'true' : 'false');
        // Roving tabindex: фокусируема одна клетка, а не 256 — иначе Tab внутри попапа
        // превращается в 256 нажатий.
        cell.tabIndex = isCursor ? 0 : -1;

        cell.textContent = number > 0 ? String(number) : '';
        cell.setAttribute('aria-label', describeCell(state.cols, index, { open, flag, showMine, number }));
    }

    if (cursor !== null) {
        root.setAttribute('aria-activedescendant', `minesweeper-cell-${cursor}`);
    } else {
        root.removeAttribute('aria-activedescendant');
    }
}

const EMPTY_SET = new Set();

// Подпись для скринридера: цифры и флажки видны глазами, но не пальцу и не голосу.
function describeCell(cols, index, { open, flag, showMine, number }) {
    const position = `строка ${Math.floor(index / cols) + 1}, столбец ${(index % cols) + 1}`;
    if (showMine) return `${position}, мина`;
    if (flag) return `${position}, флажок`;
    if (!open) return `${position}, закрыто`;
    return number > 0 ? `${position}, ${number}` : `${position}, пусто`;
}
