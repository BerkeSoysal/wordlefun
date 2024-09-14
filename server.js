const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'client/build')));

const server = http.createServer(app);
const io = new Server(server);

function generateRoomCode() {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('createRoom', ({ isPrivate }) => {
    let roomCode;
    do {
      roomCode = generateRoomCode();
    } while (io.sockets.adapter.rooms.has(roomCode));

    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, isPrivate });

    // Store room metadata
    io.sockets.adapter.rooms.get(roomCode).isPrivate = isPrivate;
    io.sockets.adapter.rooms.get(roomCode).wordSelector = socket.id;
  });

  socket.on('joinRoom', ({ roomCode }) => {
    const normalizedRoomCode = roomCode.toLowerCase();
    const room = io.sockets.adapter.rooms.get(normalizedRoomCode);

    if (normalizedRoomCode && room && room.size < 2 && (!room.isPrivate || roomCode)) {
      socket.join(normalizedRoomCode);
      const players = Array.from(room.values());
      io.to(normalizedRoomCode).emit('gameStart', {
        roomCode: normalizedRoomCode,
        players,
        wordSelector: room.wordSelector
      });
    } else if (!normalizedRoomCode) {
      // Join random public room
      const publicRooms = Array.from(io.sockets.adapter.rooms.entries())
        .filter(([_, room]) => !room.isPrivate && room.size === 1);
      
      if (publicRooms.length > 0) {
        const [randomRoomCode] = publicRooms[Math.floor(Math.random() * publicRooms.length)];
        socket.join(randomRoomCode);
        const room = io.sockets.adapter.rooms.get(randomRoomCode);
        const players = Array.from(room.values());
        io.to(randomRoomCode).emit('gameStart', {
          roomCode: randomRoomCode,
          players,
          wordSelector: room.wordSelector
        });
      } else {
        socket.emit('joinError', 'No available public rooms');
      }
    } else {
      socket.emit('joinError', 'Room not found or full');
    }
  });

  socket.on('selectWord', (word) => {
    const roomCode = Array.from(socket.rooms).find(room => room !== socket.id);
    const room = io.sockets.adapter.rooms.get(roomCode);
    if (!room || room.wordSelector !== socket.id) return;

    room.solution = word.toLowerCase();
    const players = Array.from(room.values());
    const otherPlayer = players.find(id => id !== socket.id);
    io.to(otherPlayer).emit('wordSelected', word);
    io.to(roomCode).emit('turnChange', otherPlayer);
  });

  socket.on('makeGuess', (guess) => {
    const roomCode = Array.from(socket.rooms).find(room => room !== socket.id);
    const room = io.sockets.adapter.rooms.get(roomCode);
    if (!room || room.wordSelector === socket.id) return;

    const players = Array.from(room.values());
    const otherPlayer = players.find(id => id !== socket.id);
    io.to(otherPlayer).emit('opponentGuess', guess);

    if (guess.toLowerCase() === room.solution) {
      io.to(roomCode).emit('gameOver', { winner: socket.id, word: room.solution });
    } else {
      io.to(roomCode).emit('turnChange', otherPlayer);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        const remainingPlayers = Array.from(io.sockets.adapter.rooms.get(room) || []);
        if (remainingPlayers.length === 1) {
          io.to(remainingPlayers[0]).emit('gameOver', 'Opponent disconnected');
        }
      }
    });
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});