// Хаб — список установленных игр. Никакой логики запуска: клик по плитке просто зовёт
// onPick(gameId), попап и монтирование экранов — дело src/shell/modal.js.
//
// Клавиатуру хаб намеренно не перехватывает: по плиткам ходит нативный Tab, а Esc
// должен достаться попапу, который закрывает окно целиком.

export function createHub({ games, onPick, lastGameId }) {
    const root = document.createElement('div');
    root.className = 'stg-hub';

    for (const game of games) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'stg-tile';
        tile.dataset.gameId = game.id;
        if (game.id === lastGameId) tile.classList.add('stg-tile-last');

        const icon = document.createElement('i');
        icon.className = `fa-solid ${game.icon}`;

        const title = document.createElement('span');
        title.className = 'stg-tile-title';
        title.textContent = game.title;

        const tagline = document.createElement('span');
        tagline.className = 'stg-tile-tagline';
        tagline.textContent = game.tagline ?? '';

        tile.append(icon, title, tagline);
        root.appendChild(tile);
    }

    const onClick = (event) => {
        const tile = event.target.closest?.('.stg-tile');
        if (!tile || !root.contains(tile)) return;
        onPick?.(tile.dataset.gameId);
    };
    root.addEventListener('click', onClick);

    return {
        root,
        destroy() {
            root.removeEventListener('click', onClick);
        },
    };
}
