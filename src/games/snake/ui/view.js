// Canvas-экран змейки. draw() рисует состояние движка (engine.js) на буфере,
// размер которого задаётся в device-пикселях, а не в CSS-пикселях, — иначе на
// телефоне картинка мыльная.
//
// Цвета берутся из общего слоя палитры (--stg-snake-*, см. style.css) через
// getComputedStyle. Именно поэтому те переменные заданы литералами и var(), без
// color-mix: до канваса значение доезжает строкой, а color-mix() в ней fillStyle
// не понимает — вместо цвета вышел бы прозрачный чёрный.

export function createView({ cols, rows }) {
    const root = document.createElement('div');
    root.className = 'snake-view';
    const canvas = document.createElement('canvas');
    canvas.className = 'snake-canvas';
    root.appendChild(canvas);

    let ctx2d = null;
    let lastSize = 0;

    function draw(state) {
        // Рамка поля — единственный намёк на режим стен: сплошная убивает, пунктирная
        // пропускает насквозь. Класс ставится до выхода по отсутствию контекста, иначе
        // в jsdom-тестах признак режима пропал бы вместе с отрисовкой.
        canvas.classList.toggle('snake-canvas-wrap', !!state.wrap);

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
        // Фолбэки — на случай, если style.css почему-то не загрузился: без них canvas
        // получил бы пустую строку и не нарисовал вообще ничего.
        const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
        const headColor = pick('--stg-snake-head', '#6ca0dc');
        const bodyColor = pick('--stg-snake-body', '#6ca0dc');
        const gridColor = pick('--stg-snake-grid', 'rgba(128, 128, 128, 0.3)');
        const foodColor = pick('--stg-snake-food', '#e0533d');

        if (state.showGrid) {
            ctx2d.strokeStyle = gridColor;
            ctx2d.lineWidth = 1;
            for (let i = 0; i <= cols; i++) {
                ctx2d.beginPath(); ctx2d.moveTo(i * cell, 0); ctx2d.lineTo(i * cell, w); ctx2d.stroke();
                ctx2d.beginPath(); ctx2d.moveTo(0, i * cell); ctx2d.lineTo(w, i * cell); ctx2d.stroke();
            }
        }

        // Голова своим цветом, а не цветом сетки: раньше она красилась тем же, чем
        // разлиновка поля, и на светлых темах ST терялась вместе с ней.
        state.snake.forEach((seg, i) => {
            ctx2d.fillStyle = i === 0 ? headColor : bodyColor;
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
