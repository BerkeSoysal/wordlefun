const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');


const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'client/build')));


const server = http.createServer(app);
const io = new Server(server);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

io.on('connection', (socket) => {
  console.log('A user connected');
  // Add game logic here
});


const games = new Map();
let words = [];
fs.readFile('WORDS.txt', 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading word list:', err);
    return;
  }
  words = data.trim().split('\n');
});
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Join or create a game
  if (games.size === 0 || Array.from(games.values()).every(game => game.players.length === 2)) {
    console.log("create game")
    games.set(socket.id, { players: [socket.id], turn: socket.id });
  } else {
    const [gameId, game] = Array.from(games.entries()).find(([_, g]) => g.players.length === 1);
    game.players.push(socket.id);
    const solution = words[Math.floor(Math.random() * words.length)];
    console.log("solution" + solution)
    io.to(game.players).emit('gameStart', { solution: solution, turn: game.turn });
  }

  socket.on('makeGuess', (guess) => {
    const game = Array.from(games.values()).find(g => g.players.includes(socket.id));
    if (!game || game.turn !== socket.id) return;

    const otherPlayer = game.players.find(id => id !== socket.id);
    io.to(otherPlayer).emit('opponentGuess', guess);

    game.turn = otherPlayer;
    io.to(game.players).emit('turnChange', game.turn);
  });

  socket.on('gameOver', () => {
    const game = Array.from(games.values()).find(g => g.players.includes(socket.id));

    io.to(game.players).emit('gameOver');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    games.forEach((game, gameId) => {
      if (game.players.includes(socket.id)) {
        games.delete(gameId);
        const otherPlayer = game.players.find(id => id !== socket.id);
        if (otherPlayer) {
          io.to(otherPlayer).emit('gameOver', 'Opponent disconnected');
        }
      }
    });
  });
});