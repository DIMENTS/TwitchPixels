const { WebSocketServer } = require('ws');
const sqlite3 = require('sqlite3').verbose();

// Database setup
const db = new sqlite3.Database('./grid.db', (err) => {
  if (err) {
    console.error('Fout bij het aanmaken/openen van database:', err);
  } else {
    console.log('Database connected');
  }
});

// Grid ophalen van de database
const getGrid = (callback) => {
  db.all('SELECT * FROM grid', (err, rows) => {
    if (err) {
      console.error('Fout bij het ophalen van grid:', err);
      return callback({});
    }
    const grid = {};
    rows.forEach((row) => {
      grid[`${row.x},${row.y}`] = row.color;
    });
    callback(grid);
  });
};

// Grid opslaan in de database
const saveGrid = (grid, callback) => {
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM grid'); // Verwijder oude data
    const stmt = db.prepare('INSERT INTO grid (x, y, color) VALUES (?, ?, ?)');
    Object.keys(grid).forEach((key) => {
      const [x, y] = key.split(',').map(Number);
      stmt.run(x, y, grid[key]);
    });
    stmt.finalize();
    db.run('COMMIT');
    callback();
  });
};

// HTTP-server en WebSocket-server instellen
const http = require('http');

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('WebSocket server running');
});

const wss = new WebSocketServer({ server });
const grid = {}; // Object voor pixeldata
const cooldowns = new Map(); // Cooldown-timers voor gebruikers

wss.on('connection', (socket) => {
  console.log('Nieuwe gebruiker verbonden');

  // Stuur de huidige grid naar nieuwe gebruikers
  getGrid((initialGrid) => {
    socket.send(JSON.stringify({ type: 'init', grid: initialGrid }));
  });

  socket.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'place_pixel') {
        const { x, y, color, userId } = data;

        if (cooldowns.get(userId) > Date.now()) {
          socket.send(JSON.stringify({ type: 'error', message: 'Cooldown actief!' }));
          return;
        }

        grid[`${x},${y}`] = color; // Sla de pixel op in de grid
        saveGrid(grid, () => {
          // Stuur de update naar alle gebruikers
          wss.clients.forEach((client) => {
            if (client.readyState === socket.OPEN) {
              client.send(JSON.stringify({ type: 'update_pixel', x, y, color }));
            }
          });
        });

        cooldowns.set(userId, Date.now() + 30000); // 30 seconden cooldown
      } else if (data.type === 'move_mouse') {
        const { userId, x, y } = data;

        // Stuur muiscoördinaten door naar alle andere gebruikers
        wss.clients.forEach((client) => {
          if (client !== socket && client.readyState === socket.OPEN) {
            client.send(JSON.stringify({ type: 'mouse_move', userId, x, y }));
          }
        });
      }
    } catch (err) {
      console.error('Fout in inkomend bericht:', err);
    }
  });
});

// Gebruik de juiste poort op Vercel
server.listen(8080, () => {
  console.log('Server running on port 8080');
});

module.exports = server;
