const socket = new WebSocket('wss://tpwebsocket-production.up.railway.app');
const canvas = document.getElementById('canvas');
const cursorContainer = document.getElementById('cursor-container');
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
let grid = {};
const activeUsers = {};
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

async function loadCursor(userId, color) {
    try {
        const response = await fetch('/icons/UserCursor.svg');
        if (!response.ok) {
            throw new Error(`Failed to fetch cursor: ${response.status}`);
        }
        const svgText = await response.text();

        // Maak een nieuw cursor element aan voor deze gebruiker
        const cursor = document.createElement('div');
        cursor.className = 'cursor';
        cursor.innerHTML = svgText;

        // Pas de kleur aan (indien nodig)
        const path = cursor.querySelector('path');
        if (path) {
            path.setAttribute('fill', color);
        }

        cursorContainer.appendChild(cursor); // Voeg toe aan de container!
        return cursor;
    } catch (error) {
        console.error("Error loading cursor:", error);
        return null;
    }
}

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
function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  // Bereken zichtbare cellen
  const startX = Math.max(0, Math.floor(-offsetX / cellSize / scale));
  const endX = Math.min(gridSize, Math.ceil((canvas.width - offsetX) / cellSize / scale));
  const startY = Math.max(0, Math.floor(-offsetY / cellSize / scale));
  const endY = Math.min(gridSize, Math.ceil((canvas.height - offsetY) / cellSize / scale));

  // Teken achtergrond cellen
  for (let x = startX; x < endX; x++) {
    for (let y = startY; y < endY; y++) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  // Teken cellen van de grid data
  Object.entries(grid).forEach(([key, color]) => {
    const [x, y] = key.split(',').map(Number);
    if (x >= startX && x < endX && y >= startY && y < endY) {
      ctx.fillStyle = color;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  });

  // Teken cursors
  for (const userId in activeUsers) {
    const user = activeUsers[userId];
    if (user && user.x !== undefined && user.y !== undefined) {
      ctx.fillStyle = user.color;
      ctx.beginPath();
      ctx.arc(user.x * canvas.offsetWidth - offsetX + scale / 2, user.y * canvas.offsetHeight - offsetY + scale / 2, scale / 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  ctx.restore();
}

drawGrid();

// Stuur een init-bericht met userId bij verbinding
socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'init', userId }));
};

// WebSocket handlers
socket.onmessage = async (event) => {
    try {
        const data = JSON.parse(event.data);

        if (data.type === 'mouse_move') {
            if (!activeUsers[data.userId]) {
                activeUsers[data.userId] = { color: getRandomColor() };
                activeUsers[data.userId].element = await loadCursor(data.userId, activeUsers[data.userId].color);
            }

            const cursor = activeUsers[data.userId].element;
            if (cursor) {
                const absoluteX = data.x * canvas.offsetWidth;
                const absoluteY = data.y * canvas.offsetHeight;
                const xNaPan = absoluteX - offsetX;
                const yNaPan = absoluteY - offsetY;
                const xCorrected = xNaPan / scale;
                const yCorrected = yNaPan / scale;

                cursor.style.left = xCorrected + 'px';
                cursor.style.top = yCorrected + 'px';
            }
        }
        if (data.type === 'user_disconnected') {
           if (activeUsers[data.userId] && activeUsers[data.userId].element) {
                activeUsers[data.userId].element.remove();
            }
            delete activeUsers[data.userId];
        }
            drawGrid();
        } else if (data.type === 'error') {
            if (data.message === 'Te veel verzoeken. Probeer het later opnieuw.') {
                const errorIndicator = document.getElementById('error-indicator');
                errorIndicator.textContent = 'Je plaatst te snel pixels. Wacht even en probeer het dan opnieuw.';
                errorIndicator.style.display = 'block';
                setTimeout(() => {
                    errorIndicator.style.display = 'none';
                    errorIndicator.textContent = "Oeps, hier kun je niet tekenen.";
                }, 5000);
            } else if (data.message === 'Cooldown active') {
                const cooldownIndicator = document.getElementById('cooldown-indicator');
                cooldownIndicator.style.display = 'block';
                setTimeout(() => {
                    cooldownIndicator.style.display = 'none';
                }, 30000);
            } else {
                console.error('WebSocket error:', data.message);
                alert("Er is een fout opgetreden.");
            }
        } else if (data.type === 'init') {
            grid = data.grid;
            drawGrid();
        } else if (data.type === 'update_pixel') {
            const { x, y, color } = data;
            grid[`${x},${y}`] = color;
            drawGrid();
        }
    } catch (error) {
        console.error("Error parsing JSON:", error);
        // Optioneel: Stuur een foutmelding terug naar de server
    }
};

socket.onclose = () => {
    for (const userId in activeUsers) {
        if (activeUsers[userId] && activeUsers[userId].element) {
            activeUsers[userId].element.remove();
        }
        delete activeUsers[userId];
    }
};

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

const userId = Math.random().toString(36).substring(2, 15); // Genereer een unieke user ID

// Stuur muisbewegingen naar de server
canvas.addEventListener('mousemove', (event) => {
    const x = event.offsetX / canvas.offsetWidth; // Percentage van de canvasbreedte
    const y = event.offsetY / canvas.offsetHeight; // Percentage van de canvashoogte
    socket.send(JSON.stringify({ type: 'mouse_move', userId: userId, x: x, y: y }))
});

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
