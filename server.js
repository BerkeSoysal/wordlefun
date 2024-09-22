const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const fs = require('fs');
const AI_ID = 'AI_PLAYER';

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'client/build')));

const server = http.createServer(app);
/*
const io = new Server(server, {
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

// Add this function to select a random word
function selectRandomWord() {
  return words[Math.floor(Math.random() * words.length)].toUpperCase();
}

function selectRandomWordOnFiltered(filteredWords) {
  return filteredWords[Math.floor(Math.random() * filteredWords.length)].toUpperCase();
}


function filterWordsExcludingChars(absentLetters) {
  const filteredWords = words.filter(word => {
    return !absentLetters.some(letter => word.includes(letter));
  });
  if (filteredWords.length === 0) {
    throw "word not found"; // Return null if no words satisfy the condition
  }
  return filteredWords;
}

function filterWordsOnGreen(words, greenLetters) {

  return words.filter(word => {
    for (const { letter, index } of greenLetters) {
      if (word[index] !== letter) {
        return false;
      }
    }
    return true;
  });
}

function filterWordsOnYellow(words, yellowLetters) {

  return words.filter(word => {
    for (const { letter, index } of yellowLetters) {
      if (!word.includes(letter) || word[index] === letter) {
        return false;
      }
    }
    return true;
  });
}

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

  socket.on('createSinglePlayerRoom', ()=> {
    const roomCode = generateRoomCode();
    const isAIWordSelector = false;
    const players = isAIWordSelector ? [AI_ID, socket.id] : [socket.id, AI_ID];
    rooms.set(roomCode, {
      players,
      isPrivate: true,
      wordSelector: players[0],
      isSinglePlayer: true,
      feedbacks: [],
      guesses: [],
    });
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, isPrivate: true, isSinglePlayer: true });
    if (isAIWordSelector) {
      const word = selectRandomWord();
      rooms.get(roomCode).solution = word;
      io.to(roomCode).emit('wordSelected', word);
      io.to(roomCode).emit('turnChange', socket.id);
    } else {
      io.to(roomCode).emit('gameStart', { 
        roomCode,
        players,
        wordSelector: socket.id
      });
    }
  });

  socket.on('createRoom', ({ isPrivate }) => {
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
    io.to(roomCode).emit('wordSelected', word);
    if (room.isSinglePlayer) {
      io.to(roomCode).emit('turnChange', AI_ID);
      //makeGuess(selectRandomWord());
    } else {
      const otherPlayer = players.find(id => id !== socket.id);
      io.to(roomCode).emit('turnChange', otherPlayer);
    }
  });

  socket.on('makeGuess', (guess) => makeGuess(guess));

  function makeGuess(guess, wordCount) {
      const roomCode = Array.from(socket.rooms).find(room => room !== socket.id);
      const room = rooms.get(roomCode);
      //rooms.set(roomCode, { players: [socket.id], isPrivate, wordSelector: socket.id });
      
      if (!room || room.wordSelector === socket.id && !room.isSinglePlayer) {
        return;
      }
        if (!words.includes(guess.toLowerCase())) {
        io.to(roomCode).emit('invalidGuess', 'The guessed word is not in the word list');
        return;
      }

        // If it's a single player game, add the guess to the room's guesses array
        if (room.isSinglePlayer) {
          room.guesses = room.guesses || [];
          room.guesses.push(guess.toLowerCase());
        }
    

        // Initialize guessCount if it doesn't exist
      room.guessCount = room.guessCount || 0;
      // Increment guess count
      room.guessCount++;


      io.to(roomCode).emit('opponentGuess', guess, wordCount);
      
      if (guess.toLowerCase() === rooms.get(roomCode).solution.toLowerCase()) {
        io.to(roomCode).emit('gameOver', { winner: socket.id, word: room.solution });
      } else if (room.guessCount >= 6) {
        io.in(roomCode).emit('gameOver', { winner: room.wordSelector, word: room.solution });
      }
  
      io.to(roomCode).emit('guessUpdate', { 
        guessCount: room.guessCount, 
        remainingGuesses: 6 - room.guessCount 
      });
    }
  

  socket.on('makeAIGuess', (feedback) => {
      if(feedback == null) {
        makeGuess(selectRandomWord());
        return;
      }
      const roomCode = Array.from(socket.rooms).find(room => room !== socket.id);
      const room = rooms.get(roomCode);
      if (!room) return;
      room.feedbacks = [...room.feedbacks, feedback];
      // Get the feedback array from the room
      const feedbacks = room.feedbacks || [];
      const guesses = room.guesses || [];
      console.log(feedbacks);
      console.log(guesses);
      
      // Pair up each guess with its corresponding feedback
      const guessFeedbackPairs = guesses.map((guess, index) => ({
        guess,
        feedback: feedbacks[index] || []
      }));

      // Initialize the absentLetters array if it doesn't exist
      let absentLetters = [];
      let foundLetters = [];
      let greenLetters = [];
      let yellowLetters = [];

      // Fill absentLetters array from inside the loop
      guessFeedbackPairs.forEach(({ guess, feedback }) => {
        for (let i = 0; i < guess.length; i++) {
          if (feedback[i] === 'green' || feedback[i] == 'yellow') {
            const letter = guess[i];
            if (!foundLetters.includes(letter)) {
              foundLetters.push(letter);
            }
          }
        }
      });

      guessFeedbackPairs.forEach(({ guess, feedback }) => {
        for (let i = 0; i < guess.length; i++) {
          if (feedback[i] === 'green') {
            const letter = guess[i];
            if (!greenLetters.includes({letter: letter, index: i})) {
              greenLetters.push({letter: letter, index: i});
            }
          }
        }
      });

      guessFeedbackPairs.forEach(({ guess, feedback }) => {
        for (let i = 0; i < guess.length; i++) {
          if (feedback[i] === 'yellow') {
            const letter = guess[i];
            if (!yellowLetters.includes({letter:letter, index: i})) {
              yellowLetters.push({letter: letter, index: i});
            }
          }
        }
      });
 
      guessFeedbackPairs.forEach(({ guess, feedback }) => {
        for (let i = 0; i < guess.length; i++) {
          if (feedback[i] === '') {
            const letter = guess[i];
            if (!absentLetters.includes(letter) && !foundLetters.includes(letter)) {
              absentLetters.push(letter);
              
            }
          }
        }
      });

      // TODO: Use the updated knowledge to make a more informed guess
      
      let filteredWords = filterWordsExcludingChars(absentLetters);
      let greenWords = filterWordsOnGreen(filteredWords, greenLetters)
      let yellowWords = filterWordsOnYellow(greenWords, yellowLetters);
      // Use the feedback to make a more informed guess
      // For now, we'll just make a random guess as before
      makeGuess(selectRandomWordOnFiltered(yellowWords), yellowWords.length);

      // Store the feedback for future use
    }
  );

  socket.on('playAgain', (isSinglePlayer) => {
    const roomCode = Array.from(socket.rooms).find(room => room !== socket.id);
    const room = rooms.get(roomCode);
    if (!room) return;

    room.playAgainVotes = room.playAgainVotes || new Set();
    room.playAgainVotes.add(socket.id);

    if(isSinglePlayer) {
      room.solution = null;
      room.guessCount = 0;
      room.playAgainVotes.clear();
      room.feedbacks = [];
      room.guesses = [];
      io.to(roomCode).emit('gameStart', {
        roomCode,
        players: room.players,
        wordSelector: room.wordSelector,
  
      });
    }

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