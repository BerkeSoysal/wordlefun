const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'client/build')));

const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
let words = [];

fs.readFile('WORDS.txt', 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading word list:', err);
    return;
  }
  words = data.trim().split('\n');
});

function generateRoomCode() {
  return words[Math.floor(Math.random() * words.length)].toUpperCase();
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('createRoom', ({ isPrivate }) => {
    const roomCode = generateRoomCode();
    rooms.set(roomCode, { players: [socket.id], isPrivate, wordSelector: socket.id });
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, isPrivate });
  });

  socket.on('joinRoom', ({ roomCode }) => {
    if (roomCode) {
      // Join specific room
      if (rooms.has(roomCode) && rooms.get(roomCode).players.length < 2) {
        const room = rooms.get(roomCode);
        room.players.push(socket.id);
        socket.join(roomCode);
        io.to(roomCode).emit('gameStart', { 
          roomCode,
          players: room.players,
          wordSelector: room.wordSelector
        });
      } else {
        socket.emit('joinError', 'Room not found or full');
      }
    } else {
      // Join random public room
      const availableRoom = Array.from(rooms.entries()).find(([_, room]) => !room.isPrivate && room.players.length === 1);
      if (availableRoom) {
        const [roomCode, room] = availableRoom;
        room.players.push(socket.id);
        socket.join(roomCode);
        io.to(roomCode).emit('gameStart', { 
          roomCode,
          players: room.players,
          wordSelector: room.wordSelector
        });
      } else {
        socket.emit('joinError', 'No available public rooms');
      }
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