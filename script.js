const socket = new WebSocket('wss://tpwebsocket-production.up.railway.app');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startOverlay = document.getElementById('start-overlay');
const startButton = document.getElementById('start-button');
const overlayShownKey = 'startOverlayShown';
const cooldownIndicator = document.getElementById('cooldown-indicator');
const gridSize = 1000; // Afmeting van het tekengebied (aantal cellen)
const cellSize = 10;
const canvasBorder = 2;

const colors = ['#000000', '#c4c4c4', '#2351a5', '#ff4500', '#FFFF00', '#008C45'];
let selectedColor = colors[0];
const userId = Math.random().toString(36).substr(2, 9);
let grid = {};
let activeUsers = {};
let scale = 1, offsetX = 0, offsetY = 0;
let isPanning = false, startX, startY;
let cooldownActive = false;

// Pinch-to-zoom en touch-movement variabelen
let isDragging = false;
let isPinching = false;
let lastTouchX = 0;
let lastTouchY = 0;
let initialDistance = 0;

// Bereken canvas-grootte en centreren
const calculateCanvasDimensions = () => {
    canvas.width = Math.min(gridSize * cellSize + 2 * canvasBorder, window.innerWidth);
    canvas.height = Math.min(gridSize * cellSize + 2 * canvasBorder, window.innerHeight);
    offsetX = (canvas.width - gridSize * cellSize * scale) / 2;
    offsetY = (canvas.height - gridSize * cellSize * scale) / 2;
    offsetX = Math.max(0, offsetX);
    offsetY = Math.max(0, offsetY);
};
calculateCanvasDimensions();

// Overlay functionaliteit
startButton.addEventListener('click', () => {
    startOverlay.style.display = 'none';
    localStorage.setItem(overlayShownKey, 'true');
});

if (localStorage.getItem(overlayShownKey) === 'true') {
    startOverlay.style.display = 'none';
}

// Cooldown
const startCooldown = (seconds) => {
    cooldownActive = true;
    const startTime = Date.now();
    const endTime = startTime + seconds * 1000;

    const updateCooldown = () => {
        const now = Date.now();
        const remaining = Math.ceil((endTime - now) / 1000);
        cooldownIndicator.textContent = `Cooldown: ${remaining}s`;

        if (remaining > 0) {
            requestAnimationFrame(updateCooldown);
        } else {
            cooldownIndicator.style.display = 'none';
            cooldownActive = false;
        }
    };

    cooldownIndicator.style.display = 'block';
    requestAnimationFrame(updateCooldown);
};

const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d');

// Pre-render het grid
offscreenCanvas.width = gridSize * cellSize;
offscreenCanvas.height = gridSize * cellSize;

const preRenderGrid = () => {
    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            offscreenCtx.fillStyle = '#FFFFFF';
            offscreenCtx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }
};
preRenderGrid();

// Grid tekenen
const drawGrid = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    // Bereken zichtbare cellen
    const startX = Math.max(0, Math.floor(-offsetX / cellSize / scale));
    const endX = Math.min(gridSize, Math.ceil((canvas.width - offsetX) / cellSize / scale));
    const startY = Math.max(0, Math.floor(-offsetY / cellSize / scale));
    const endY = Math.min(gridSize, Math.ceil((canvas.height - offsetY) / cellSize / scale));

    for (let x = startX; x < endX; x++) {
        for (let y = startY; y < endY; y++) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }

    Object.entries(grid).forEach(([key, color]) => {
        const [x, y] = key.split(',').map(Number);
        if (x >= startX && x < endX && y >= startY && y < endY) {
            ctx.fillStyle = color;
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    });

    ctx.restore();
};

drawGrid();

// Stuur een init-bericht met userId bij verbinding
socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'init', userId }));
};

// WebSocket handlers
socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'error') {
        alert(data.message);
    }
    if (data.type === 'init') {
        grid = data.grid;
        drawGrid();
    } else if (data.type === 'update_pixel') {
        const { x, y, color } = data;
        grid[`${x},${y}`] = color;
        drawGrid();
    } else if (data.type === 'mouse_move') {
        activeUsers[data.userId] = {
            x: data.x / scale - offsetX / scale,
            y: data.y / scale - offsetY / scale,
        };
        drawGrid();
    }
};

const errorIndicator = document.getElementById('error-indicator');

function placePixel(clientX, clientY) {
    if (cooldownActive) return;

    // Bereken de cell-coördinaten
    const x = Math.floor((clientX - offsetX) / (cellSize * scale));
    const y = Math.floor((clientY - offsetY) / (cellSize * scale));

    // Controleer of de coördinaten binnen het grid vallen
    if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) {
        errorIndicator.style.display = 'block';
        setTimeout(() => {
            errorIndicator.style.display = 'none';
        }, 3000); // Verberg na 3 seconden
        return;
    }

    // Verstuur de pixel-update naar de server
    socket.send(JSON.stringify({ type: 'place_pixel', userId, x, y, color: selectedColor }));
    grid[`${x},${y}`] = selectedColor;
    drawGrid();
    startCooldown(30);
}

canvas.addEventListener('click', (e) => {
    placePixel(e.clientX, e.clientY);
});

// Touch handlers
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        isDragging = true;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        isPinching = true;
        initialDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
    }
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (isDragging && !isPinching) {
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        offsetX += (currentX - lastTouchX) / scale;
        offsetY += (currentY - lastTouchY) / scale;
        lastTouchX = currentX;
        lastTouchY = currentY;
        drawGrid();
    } else if (isPinching && e.touches.length === 2) {
        const currentDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        const zoomFactor = currentDistance / initialDistance;
        scale = Math.min(Math.max(0.5, scale * zoomFactor), 4);
        initialDistance = currentDistance;
        drawGrid();
    }
});

canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
        isDragging = false;
        isPinching = false;
    }
});

// Zoom en Pan
canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const prevScale = scale;
    scale += event.deltaY * -0.001;
    scale = Math.min(Math.max(0.5, scale), 4);
    const zoomFactor = scale / prevScale;
    offsetX = (offsetX - event.clientX) * zoomFactor + event.clientX;
    offsetY = (offsetY - event.clientY) * zoomFactor + event.clientY;
    drawGrid();
});

canvas.addEventListener('mousedown', (event) => {
    isPanning = true;
    startX = event.clientX - offsetX;
    startY = event.clientY - offsetY;
});

canvas.addEventListener('mousemove', (event) => {
    if (isPanning) {
        offsetX = event.clientX - startX;
        offsetY = event.clientY - startY;
        drawGrid();
    } else {
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left - offsetX) / scale;
        const y = (event.clientY - rect.top - offsetY) / scale;
        socket.send(JSON.stringify({ type: 'move_mouse', userId, x, y }));
    }
});

canvas.addEventListener('mouseup', () => {
    isPanning = false;
});

// Kleuren selecteren
const colorPicker = document.getElementById('color-picker');
colors.forEach((color) => {
    const div = document.createElement('div');
    div.className = 'color';
    div.style.backgroundColor = color;
    if (color === selectedColor) div.classList.add('selected');
    div.addEventListener('click', () => {
        document.querySelectorAll('.color').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        selectedColor = color;
    });
    colorPicker.appendChild(div);
});
