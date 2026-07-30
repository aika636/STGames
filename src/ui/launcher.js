// Точки запуска игры: кнопка в wand-меню и слэш-команда /sudoku.

import { getCtx } from '../ctx.js';
import { logError, logInfo, warnOnce } from '../log.js';
import { DIFFICULTIES } from '../settings.js';
import { openSudoku } from './modal.js';

const BUTTON_ID = 'sudoku_wand_button';

// Кнопка в выпадающем меню «волшебной палочки». ST раз в секунду проверяет, есть ли у
// #extensionsMenu видимые дети, и сам показывает кнопку меню — достаточно добавить свой
// пункт в любой момент после загрузки.
export function initWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        warnOnce('no-extensions-menu', 'wand-меню не найдено — кнопка запуска не добавлена');
        return false;
    }
    if (document.getElementById(BUTTON_ID)) return true; // идемпотентность

    const button = document.createElement('div');
    button.id = BUTTON_ID;
    button.className = 'list-group-item flex-container flexGap5';
    button.title = 'Открыть судоку';

    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-table-cells extensionsMenuExtensionButton';

    const label = document.createElement('span');
    label.textContent = 'Судоку';

    button.append(icon, label);
    button.addEventListener('click', () => {
        openSudoku().catch((err) => logError('openSudoku упал', err));
    });

    menu.appendChild(button);
    return true;
}

// /sudoku [уровень] — открыть игру. Регистрируется через SlashCommandParser; если его в
// этой версии ST нет, пробуем устаревший registerSlashCommand, а если нет и его —
// молча живём с одной кнопкой.
export function initSlashCommand() {
    const ctx = getCtx();

    const callback = (_args, value) => {
        const requested = String(value || '').trim().toLowerCase();
        const difficulty = DIFFICULTIES.includes(requested) ? requested : undefined;
        openSudoku({ difficulty }).catch((err) => logError('openSudoku упал', err));
        return '';
    };

    const helpString = `Открывает судоку. Необязательный аргумент — уровень: ${DIFFICULTIES.join(', ')}.`;

    try {
        if (ctx.SlashCommandParser?.addCommandObject && ctx.SlashCommand?.fromProps) {
            ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                name: 'sudoku',
                callback,
                helpString,
                unnamedArgumentList: buildArgumentList(ctx),
            }));
            logInfo('слэш-команда /sudoku зарегистрирована');
            return true;
        }

        if (typeof ctx.registerSlashCommand === 'function') {
            ctx.registerSlashCommand('sudoku', callback, [], helpString, false, true);
            logInfo('слэш-команда /sudoku зарегистрирована (устаревший API)');
            return true;
        }

        warnOnce('no-slash-api', 'API слэш-команд не найдено — /sudoku недоступна');
        return false;
    } catch (err) {
        logError('не удалось зарегистрировать /sudoku', err);
        return false;
    }
}

// Описание аргумента для автодополнения. Если классов аргументов в контексте нет,
// команда всё равно регистрируется — просто без подсказок.
function buildArgumentList(ctx) {
    const { SlashCommandArgument, SlashCommandEnumValue, ARGUMENT_TYPE } = ctx;
    if (!SlashCommandArgument?.fromProps) return [];

    return [
        SlashCommandArgument.fromProps({
            description: 'уровень сложности',
            typeList: ARGUMENT_TYPE?.STRING ? [ARGUMENT_TYPE.STRING] : [],
            isRequired: false,
            enumList: SlashCommandEnumValue
                ? DIFFICULTIES.map((level) => new SlashCommandEnumValue(level))
                : [],
        }),
    ];
}
