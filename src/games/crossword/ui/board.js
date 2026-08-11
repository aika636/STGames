// Сетка кроссворда и банк слов в DOM. Модуль знает про DOM, но ничего не знает ни про
// SillyTavern, ни про правила: состояние приходит из core/game.js, наружу отдаются
// корневые элементы и render().
//
// Сетка и банк строятся ОДИН раз на партию (у каждой головоломки своя сетка и свой
// банк), а render() только переставляет классы и текст — приём судоку, реверси и
// нонограммы: пересоздавать сто двадцать одну клетку на каждый ход незачем.
//
// Слушателей два, оба делегированные: один на сетке, один на банке. 121 клетка и
// 28 слов по отдельному обработчику — полторы сотни слушателей на партию.

import { lettersOf } from '../core/game.js';
import { BLOCK } from '../core/puzzles.js';

export function createBoard({ puzzle, onCell, onWord }) {
    const root = document.createElement('div');
    root.className = 'crossword-layout';

    const board = document.createElement('div');
    board.className = 'crossword-board';
    board.setAttribute('role', 'grid');
    board.setAttribute('aria-label', 'Сетка кроссворда');
    board.style.setProperty('--crossword-cols', String(puzzle.cols));
    board.style.setProperty('--crossword-rows', String(puzzle.rows));

    const cells = [];
    for (let index = 0; index < puzzle.grid.length; index++) {
        const cell = document.createElement('div');
        const block = puzzle.grid[index] === BLOCK;
        cell.className = block ? 'crossword-cell crossword-block' : 'crossword-cell';
        cell.id = `crossword-cell-${index}`;
        cell.dataset.idx = String(index);
        if (!block) {
            cell.setAttribute('role', 'gridcell');
            cell.tabIndex = -1;
        }
        board.appendChild(cell);
        cells.push(cell);
    }

    const bank = document.createElement('div');
    bank.className = 'crossword-bank';
    bank.setAttribute('role', 'group');
    bank.setAttribute('aria-label', 'Банк слов');

    // Банк разложен по длинам: строка на длину, подпись слева, внутри строки — алфавит,
    // в котором слова пришли из головоломки. Единой обёрткой слова слипались в кашу,
    // и подобрать слово под место в семь клеток можно было только пересчитывая буквы
    // в каждом. Длина — единственное, что игроку нужно от банка до того, как он начал
    // думать над самим словом.
    const wordEls = new Array(puzzle.bank.length);
    const groups = [];

    const byLength = new Map();
    for (let index = 0; index < puzzle.bank.length; index++) {
        const length = puzzle.bank[index].length;
        if (!byLength.has(length)) byLength.set(length, []);
        byLength.get(length).push(index);
    }

    for (const length of [...byLength.keys()].sort((a, b) => a - b)) {
        const group = document.createElement('div');
        group.className = 'crossword-bank-group';
        group.dataset.len = String(length);

        const label = document.createElement('span');
        label.className = 'crossword-bank-len';
        label.textContent = String(length);
        // Подпись — для глаза; экранному диктору длину говорит aria-label каждой кнопки.
        label.setAttribute('aria-hidden', 'true');

        const list = document.createElement('div');
        list.className = 'crossword-bank-words';
        list.setAttribute('aria-label', `Слова из ${length} букв`);

        for (const index of byLength.get(length)) {
            const word = document.createElement('button');
            word.type = 'button';
            word.className = 'crossword-word';
            word.dataset.word = String(index);
            word.textContent = puzzle.bank[index];
            list.appendChild(word);
            wordEls[index] = word;
        }

        group.append(label, list);
        bank.appendChild(group);
        groups.push({ length, element: group });
    }

    root.append(board, bank);

    // --- Ввод: тап по клетке и тап по слову

    function onBoardClick(event) {
        const cell = event.target.closest?.('.crossword-cell');
        if (!cell || !board.contains(cell) || cell.classList.contains('crossword-block')) return;
        onCell?.(Number(cell.dataset.idx));
    }

    function onBankClick(event) {
        const word = event.target.closest?.('.crossword-word');
        if (!word || !bank.contains(word)) return;
        onWord?.(Number(word.dataset.word));
    }

    board.addEventListener('click', onBoardClick);
    bank.addEventListener('click', onBankClick);

    return {
        root,
        board,
        bank,
        cells,
        wordEls,
        groups,
        render: (state, options) => render({ puzzle, cells, board, wordEls, groups }, state, options),
        destroy() {
            board.removeEventListener('click', onBoardClick);
            bank.removeEventListener('click', onBankClick);
        },
    };
}

const EMPTY_SET = new Set();

function render(
    { puzzle, cells, board, wordEls, groups },
    state,
    {
        cursor = null,
        slot = null,
        pending = EMPTY_SET,
        wrongCells = EMPTY_SET,
        wrongSlots = EMPTY_SET,
    } = {},
) {
    const letters = lettersOf(state);
    // Клетки выбранного слова подсвечиваются целиком: без этого на пересечении
    // непонятно, какое из двух слов сейчас выбрано.
    const active = slot === null ? EMPTY_SET : new Set(puzzle.slots[slot].cells);

    for (let index = 0; index < cells.length; index++) {
        const cell = cells[index];
        if (puzzle.grid[index] === BLOCK) continue;

        const letter = letters[index] === ' ' ? '' : letters[index];
        if (cell.textContent !== letter) cell.textContent = letter;

        cell.classList.toggle('crossword-filled', letter !== '');
        // Буква от пересечения рисуется бледной: место под ней ещё свободно, и сетка
        // не должна выглядеть собранной раньше времени.
        const loose = pending.has(index);
        cell.classList.toggle('crossword-pending', loose);
        cell.classList.toggle('crossword-active', active.has(index));
        cell.classList.toggle('crossword-wrong', wrongCells.has(index));

        const isCursor = index === cursor;
        cell.classList.toggle('crossword-cursor', isCursor);
        cell.setAttribute('aria-selected', isCursor ? 'true' : 'false');
        // Roving tabindex: фокусируема одна клетка, а не сто двадцать одна.
        cell.tabIndex = isCursor ? 0 : -1;
        cell.setAttribute('aria-label', describeCell(puzzle.cols, index, letter, loose));
    }

    const slotLength = slot === null ? null : puzzle.slots[slot].length;
    // Строка банка с нужной длиной поднимается, остальные притухают. Не прячем: банк,
    // меняющий высоту на каждый выбор слота, дёргал бы всё окно.
    for (const group of groups ?? []) {
        const fits = slotLength !== null && group.length === slotLength;
        group.element.classList.toggle('crossword-bank-group-fit', fits);
        group.element.classList.toggle('crossword-bank-group-off', slotLength !== null && !fits);
    }

    for (let index = 0; index < wordEls.length; index++) {
        const element = wordEls[index];
        const holder = slotOf(state, index);
        const used = holder !== -1;

        // Разложенные слова не исчезают из банка, а гаснут: строка, теряющая слова,
        // дёргалась бы по ширине на каждом ходу (грабли ряда цифр в судоку).
        element.classList.toggle('crossword-word-used', used);
        // Слово подходящей длины подсвечивается под выбранный слот — подсказка не
        // про решение, а про геометрию, её игрок и так видит, считая клетки.
        element.classList.toggle(
            'crossword-word-fit',
            !used && slotLength !== null && puzzle.bank[index].length === slotLength,
        );
        element.classList.toggle('crossword-word-wrong', used && wrongSlots.has(holder));
        element.setAttribute('aria-pressed', used ? 'true' : 'false');
        element.setAttribute(
            'aria-label',
            used ? `${puzzle.bank[index]}, разложено — снять` : `${puzzle.bank[index]}, ${puzzle.bank[index].length} букв`,
        );
    }

    if (cursor !== null) {
        board.setAttribute('aria-activedescendant', `crossword-cell-${cursor}`);
    } else {
        board.removeAttribute('aria-activedescendant');
    }
}

function slotOf(state, wordIndex) {
    for (let slot = 0; slot < state.placed.length; slot++) {
        if (state.placed[slot] === wordIndex) return slot;
    }
    return -1;
}

function describeCell(cols, index, letter, pending = false) {
    const position = `строка ${Math.floor(index / cols) + 1}, столбец ${(index % cols) + 1}`;
    if (!letter) return `${position}, пусто`;
    return pending ? `${position}, ${letter}, слово не разложено` : `${position}, ${letter}`;
}
