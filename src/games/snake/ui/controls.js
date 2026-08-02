// Управление змейкой: клавиатура (capture-фаза на document, пока смонтирован экран),
// экранный d-pad и свайпы. Гасятся только обработанные клавиши — стрелки и пробел
// иначе уедут в чат или прокрутят историю, а Esc намеренно не трогаем: его получает
// попап и закрывает окно целиком.

const KEY_MAP = {
    ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    W: { x: 0, y: -1 }, S: { x: 0, y: 1 }, A: { x: -1, y: 0 }, D: { x: 1, y: 0 },
    // ЙЦУКЕН-эквиваленты WASD: раскладку посреди партии не переключают.
    ц: { x: 0, y: -1 }, Ц: { x: 0, y: -1 },
    ы: { x: 0, y: 1 }, Ы: { x: 0, y: 1 },
    ф: { x: -1, y: 0 }, Ф: { x: -1, y: 0 },
    в: { x: 1, y: 0 }, В: { x: 1, y: 0 },
};

function isInteractiveTarget(e) {
    const target = e.target;
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName?.toLowerCase();
    return tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea';
}

export function attachKeyboard({ onDirection, onPause, onRestart }) {
    function onKey(e) {
        // Интерактивные элементы (кнопки d-pad, select уровня судоку, поле чата) должны
        // сами решать, как реагировать на Enter/Space; иначе Space на кнопке «вниз»
        // включал бы паузу, а Enter — вызывал рестарт.
        if (isInteractiveTarget(e)) return;
        const dir = KEY_MAP[e.key];
        if (dir) {
            e.preventDefault();
            e.stopPropagation();
            onDirection(dir);
        } else if (e.key === ' ' || e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
            e.preventDefault();
            e.stopPropagation();
            onPause();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            onRestart();
        }
    }

    document.addEventListener('keydown', onKey, true);

    return {
        destroy() {
            document.removeEventListener('keydown', onKey, true);
        },
    };
}

export function createDPad({ onDirection, onPause }) {
    const root = document.createElement('div');
    root.className = 'snake-dpad';

    const arrows = {
        'snake-dpad-up': { x: 0, y: -1, label: '▲', aria: 'Вверх' },
        'snake-dpad-down': { x: 0, y: 1, label: '▼', aria: 'Вниз' },
        'snake-dpad-left': { x: -1, y: 0, label: '◀', aria: 'Влево' },
        'snake-dpad-right': { x: 1, y: 0, label: '▶', aria: 'Вправо' },
    };

    const grid = document.createElement('div');
    grid.className = 'snake-dpad-grid';
    for (const [cls, spec] of Object.entries(arrows)) {
        const btn = document.createElement('button');
        btn.className = `snake-dpad-btn ${cls}`;
        btn.type = 'button';
        btn.textContent = spec.label;
        btn.setAttribute('aria-label', spec.aria);
        btn.tabIndex = 0;
        // mousedown, а не click: click уводит фокус с корня окна на кнопку.
        // Клавиатура (Enter/Space) тоже должна работать, поэтому вешаем и keydown.
        function activate(e) {
            e.preventDefault();
            onDirection({ x: spec.x, y: spec.y });
        }
        btn.addEventListener('mousedown', activate);
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                activate(e);
            }
        });
        grid.appendChild(btn);
    }

    const pause = document.createElement('button');
    pause.className = 'snake-dpad-btn snake-dpad-pause';
    pause.type = 'button';
    pause.textContent = '⏸';
    pause.setAttribute('aria-label', 'Пауза');
    pause.tabIndex = 0;
    function pauseActivate(e) {
        e.preventDefault();
        onPause();
    }
    pause.addEventListener('mousedown', pauseActivate);
    pause.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            pauseActivate(e);
        }
    });

    root.appendChild(grid);
    root.appendChild(pause);

    return {
        root,
        destroy() {
            root.remove();
        },
    };
}

export function attachSwipe(element, onDirection) {
    let start = null;

    function touchstart(e) {
        start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }

    function touchmove(e) {
        if (start) e.preventDefault();
    }

    function touchend(e) {
        if (!start) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        if (Math.abs(dx) > Math.abs(dy)) onDirection({ x: Math.sign(dx), y: 0 });
        else onDirection({ x: 0, y: Math.sign(dy) });
        start = null;
    }

    // touchmove без passive: страницу над канвасом не прокручиваем (основная защита —
    // touch-action: none в CSS, обработчик страхует).
    element.addEventListener('touchstart', touchstart, { passive: true });
    element.addEventListener('touchmove', touchmove, { passive: false });
    element.addEventListener('touchend', touchend, { passive: true });

    return {
        destroy() {
            element.removeEventListener('touchstart', touchstart, { passive: true });
            element.removeEventListener('touchmove', touchmove, { passive: false });
            element.removeEventListener('touchend', touchend, { passive: true });
        },
    };
}
