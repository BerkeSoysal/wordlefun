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
/*const io = new Server(server, {
  cors: {
    origin: "*", // For development, you can use "*". For production, specify your client's URL
    methods: ["GET", "POST"]
  }
});*/
const io = new Server(server);

const rooms = new Map();
let words = [];
let activePlayers = 0;
let waitingRooms = 0;

fs.readFile('wordlist.txt', 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading word list:', err);
    return;
  }
  words = data.trim().split('\n');
});

function generateRoomCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

io.on('connection', (socket) => {
  activePlayers++;
  io.emit('statsUpdate', { activePlayers, waitingRooms });

  console.log('A user connected:', socket.id);

  socket.on('createRoom', ({ isPrivate }) => {
    console.log("room creation");
    const roomCode = generateRoomCode();
    rooms.set(roomCode, { players: [socket.id], isPrivate, wordSelector: socket.id });
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, isPrivate });
    waitingRooms++;
    io.emit('statsUpdate', { activePlayers, waitingRooms });
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
        waitingRooms--;
        io.emit('statsUpdate', { activePlayers, waitingRooms });
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
        waitingRooms--;
        io.emit('statsUpdate', { activePlayers, waitingRooms });
      } else {
        socket.emit('joinError', 'No available public rooms');
      }
    }
  });

  socket.on('selectWord', (word) => {
    const roomCode = Array.from(socket.rooms).find(room => room !== socket.id);
    const room = rooms.get(roomCode);
    if (!room || room.wordSelector !== socket.id) return;
    if (!words.includes(word.toLowerCase())) {
      io.to(roomCode).emit('invalidWord', 'The selected word is not in the word list');
      return;
    }
    room.solution = word.toLowerCase();
    const players = Array.from(room.players);
    const otherPlayer = players.find(id => id !== socket.id);
    io.to(roomCode).emit('wordSelected', word);
    io.to(roomCode).emit('turnChange', otherPlayer);
  });

  socket.on('makeGuess', (guess) => {
    const roomCode = Array.from(socket.rooms).find(room => room !== socket.id);
    const room = io.sockets.adapter.rooms.get(roomCode);
    
    if (!room || room.wordSelector === socket.id) return;
    if (!words.includes(guess.toLowerCase())) {
      io.to(roomCode).emit('invalidGuess', 'The guessed word is not in the word list');
      return;
    }
  
      // Initialize guessCount if it doesn't exist
      room.guessCount = room.guessCount || 0;
      // Increment guess count
      room.guessCount++;

    const players = Array.from(room.values());
    const otherPlayer = players.find(id => id !== socket.id);
    
    io.to(roomCode).emit('opponentGuess', guess);
    
    if (guess.toLowerCase() === rooms.get(roomCode).solution.toLowerCase()) {
      io.to(roomCode).emit('gameOver', { winner: socket.id, word: room.solution });
    } else if (room.guessCount >= 6) {
      io.in(roomCode).emit('gameOver', { winner: room.wordSelector, word: room.solution });
    }

    io.to(roomCode).emit('guessUpdate', { 
      guessCount: room.guessCount, 
      remainingGuesses: 6 - room.guessCount 
    });

  });

  socket.on('playAgain', () => {
    const roomCode = Array.from(socket.rooms).find(room => room !== socket.id);
    const room = rooms.get(roomCode);
    if (!room) return;

    room.playAgainVotes = room.playAgainVotes || new Set();
    room.playAgainVotes.add(socket.id);

    if (room.playAgainVotes.size === room.players.length) {
      // Reset the game
      room.wordSelector = room.players.find(id => id !== room.wordSelector);
      room.solution = null;
      room.guessCount = 0;
      room.playAgainVotes.clear();

      io.to(roomCode).emit('gameStart', {
        roomCode,
        players: room.players,
        wordSelector: room.wordSelector
      });
    } else {
      // Notify the other player that this player wants to play again
      const otherPlayer = room.players.find(id => id !== socket.id);
      io.to(otherPlayer).emit('opponentWantsPlayAgain');
    }
  });

  socket.on('disconnect', () => {
    activePlayers--;
    console.log('User disconnected:', socket.id);
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        const remainingPlayers = Array.from(io.sockets.adapter.rooms.get(room) || []);
        if (remainingPlayers.length === 1) {
          io.to(remainingPlayers[0]).emit('gameOver', 'Opponent disconnected');
        }
      }
    });
    // Check if the disconnecting player was in a waiting room
    // This logic might need to be adjusted based on your room management
    socket.rooms.forEach(room => {
      if (rooms.has(room) && rooms.get(room).players.length === 1) {
        waitingRooms--;
      }
    });
    io.emit('statsUpdate', { activePlayers, waitingRooms });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});