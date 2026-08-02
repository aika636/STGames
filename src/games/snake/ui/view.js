// Canvas-экран змейки. draw() рисует состояние движка (engine.js) на буфере,
// размер которого задаётся в device-пикселях, а не в CSS-пикселях, — иначе на
// телефоне картинка мыльная. Цвета берутся из темы ST через getComputedStyle
// (bodyColor/gridColor), еда — фирменный красный судоку, чтобы не плодить палитры.

export function createView({ cols, rows }) {
    const root = document.createElement('div');
    root.className = 'snake-view';
    const canvas = document.createElement('canvas');
    canvas.className = 'snake-canvas';
    root.appendChild(canvas);

    let ctx2d = null;
    let lastSize = 0;

    function draw(state) {
        // jsdom без пакета canvas возвращает null — тогда отрисовка становится no-op,
        // а экран продолжает жить: это осознанное ограничение покрытия UI-тестов.
        if (!ctx2d) {
            ctx2d = canvas.getContext('2d');
            if (!ctx2d) return;
        }

        const cssSize = Math.min(canvas.clientWidth || 320, canvas.clientHeight || 320);
        if (cssSize !== lastSize) {
            lastSize = cssSize;
            canvas.width = cssSize * (window.devicePixelRatio || 1);
            canvas.height = canvas.width; // поле квадратное
        }

        const w = canvas.width;
        const cell = w / cols;

        ctx2d.clearRect(0, 0, w, w);

        const style = getComputedStyle(canvas);
        const bodyColor = style.getPropertyValue('--SmartThemeQuoteColor') || 'currentColor';
        const gridColor = style.getPropertyValue('--SmartThemeBorderColor') || 'currentColor';
        const foodColor = '#e0533d';

        if (state.showGrid) {
            ctx2d.strokeStyle = gridColor;
            ctx2d.lineWidth = 1;
            for (let i = 0; i <= cols; i++) {
                ctx2d.beginPath(); ctx2d.moveTo(i * cell, 0); ctx2d.lineTo(i * cell, w); ctx2d.stroke();
                ctx2d.beginPath(); ctx2d.moveTo(0, i * cell); ctx2d.lineTo(w, i * cell); ctx2d.stroke();
            }
        }

        state.snake.forEach((seg, i) => {
            ctx2d.fillStyle = i === 0 ? bodyColor : gridColor;
            ctx2d.fillRect(seg.x * cell + 1, seg.y * cell + 1, cell - 2, cell - 2);
        });

        if (state.food) {
            ctx2d.fillStyle = foodColor;
            ctx2d.beginPath();
            ctx2d.arc((state.food.x + 0.5) * cell, (state.food.y + 0.5) * cell, cell * 0.35, 0, Math.PI * 2);
            ctx2d.fill();
        }
    }

    return {
        root,
        canvas,
        draw,
        destroy() {
            root.remove();
        },
    };
}
