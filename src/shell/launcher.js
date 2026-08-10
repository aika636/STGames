// Точки запуска хаба: кнопка в wand-меню и слэш-команды /stgames и /sudoku.

import { getCtx } from '../ctx.js';
import { logError, logInfo, warnOnce } from '../log.js';
import { list } from '../registry.js';
import { openShell } from './modal.js';

const WAND_BUTTON_ID = 'stgames_wand_button';

// Кнопка в выпадающем меню «волшебной палочки». ST раз в секунду проверяет, есть ли у
// #extensionsMenu видимые дети, и сам показывает кнопку меню — достаточно добавить свой
// пункт в любой момент после загрузки.
export function initWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        warnOnce('no-extensions-menu', 'wand-меню не найдено — кнопка запуска не добавлена');
        return false;
    }
    if (document.getElementById(WAND_BUTTON_ID)) return true; // идемпотентность

    const button = document.createElement('div');
    button.id = WAND_BUTTON_ID;
    button.className = 'list-group-item flex-container flexGap5';
    button.title = 'Открыть STGames — мини-игры';

    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-dice extensionsMenuExtensionButton';

    const label = document.createElement('span');
    label.textContent = 'STGames';

    button.append(icon, label);
    button.addEventListener('click', () => {
        openShell().catch((err) => logError('openShell упал', err));
    });

    menu.appendChild(button);
    return true;
}

// Слэш-команды: /stgames открывает хаб, каждая игра с game.slash получает свою команду.
// Регистрируются через SlashCommandParser; если его в этой версии ST нет, пробуем
// устаревший registerSlashCommand, а если нет и его — молча живём с одной кнопкой.
export function initSlashCommands() {
    const ctx = getCtx();

    const open = (options) => openShell(options).catch((err) => logError('openShell упал', err));

    try {
        if (ctx.SlashCommandParser?.addCommandObject && ctx.SlashCommand?.fromProps) {
            ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                name: 'stgames',
                callback: () => {
                    open({});
                    return '';
                },
                helpString: 'Открывает список мини-игр.',
                unnamedArgumentList: [],
            }));

            for (const game of list()) {
                if (!game.slash) continue;
                const { name, help, enumValues, parse } = game.slash;
                ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                    name,
                    callback: (_args, value) => {
                        open({ gameId: game.id, args: parse?.(value) ?? {} });
                        return '';
                    },
                    helpString: help,
                    unnamedArgumentList: buildArgumentList(ctx, enumValues),
                }));
            }

            logInfo('слэш-команды зарегистрированы');
            return true;
        }

        if (typeof ctx.registerSlashCommand === 'function') {
            ctx.registerSlashCommand('stgames', () => {
                open({});
                return '';
            }, [], 'Открывает список мини-игр.', false, true);

            for (const game of list()) {
                if (!game.slash) continue;
                ctx.registerSlashCommand(game.slash.name, (_args, value) => {
                    open({ gameId: game.id, args: game.slash.parse?.(value) ?? {} });
                    return '';
                }, [], game.slash.help, false, true);
            }

            logInfo('слэш-команды зарегистрированы (устаревший API)');
            return true;
        }

        warnOnce('no-slash-api', 'API слэш-команд не найдено — /stgames и /sudoku недоступны');
        return false;
    } catch (err) {
        logError('не удалось зарегистрировать слэш-команды', err);
        return false;
    }
}

// Описание аргумента для автодополнения. Если классов аргументов в контексте нет,
// команда всё равно регистрируется — просто без подсказок.
function buildArgumentList(ctx, enumValues) {
    const { SlashCommandArgument, SlashCommandEnumValue, ARGUMENT_TYPE } = ctx;
    if (!SlashCommandArgument?.fromProps) return [];
    // Игра без enumValues (змейка) не предъявляет аргумент; пустой список — без
    // автодополнения и без сбивающего подпись «уровень сложности».
    if (!Array.isArray(enumValues) || enumValues.length === 0) return [];

    return [
        SlashCommandArgument.fromProps({
            description: 'уровень сложности',
            typeList: ARGUMENT_TYPE?.STRING ? [ARGUMENT_TYPE.STRING] : [],
            isRequired: false,
            enumList: SlashCommandEnumValue
                ? enumValues.map((value) => new SlashCommandEnumValue(value))
                : [],
        }),
    ];
}
