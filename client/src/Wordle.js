import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import './Wordle.css';

const socket = io();
//const socket = io("http://localhost:3001")
const Wordle = () => {


  const keyboard = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Enter', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace']
  ];



  const [gameState, setGameState] = useState('menu'); // 'menu', 'waiting', 'playing'
  const [roomCode, setRoomCode] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState('');
  const [playerId, setPlayerId] = useState(null);
  const [isWordSelector, setIsWordSelector] = useState(false);
  const [canSelectWord, setCanSelectWord] = useState(false);
  const [selectedWord, setSelectedWord] = useState('');
  const [solution, setSolution] = useState('');
  const [guesses, setGuesses] = useState(Array(6).fill(""));
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState('');
  const [currentTurn, setCurrentTurn] = useState(null);
  const [showPlayAgain, setShowPlayAgain] = useState(false);
  const [opponentWantsPlayAgain, setOpponentWantsPlayAgain] = useState(false);
  const [letterFeedbacks, setLetterFeedbacks] = useState(
    Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => [letter, '']))
  );

  const keyupListenerRef = useRef(null);

  useEffect(() => {
    socket.on('connect', () => {
      setPlayerId(socket.id);
      console.log("Connected");
    });

    socket.on('roomCreated', ({ roomCode, isPrivate }) => {
      setRoomCode(roomCode);
      setGameState('waiting');
    });

    socket.on('gameStart', ({ roomCode, players, wordSelector }) => {
      setRoomCode(roomCode);
      setGameState('playing');
      setIsWordSelector(socket.id === wordSelector);
      setGameOver(false);
      setShowPlayAgain(false);
      setGuesses(Array(6).fill(""));
      setCurrentGuess('');
      setSelectedWord('');
      setSolution('');
      setCurrentTurn(wordSelector);
      if (socket.id === wordSelector) {
        setCanSelectWord(true);
        setMessage("Select a word for your opponent to guess");
      } else {
        setCanSelectWord(false);
        setMessage("Waiting for opponent to select a word");
      }
    });

    socket.on('wordSelected', (word) => {
      setSolution(word);
      if (!isWordSelector) {
        setMessage("Word selected. Start guessing!");
        setCurrentTurn(socket.id);
      } else {
        setMessage("Your opponent is now guessing your word.");
      }
    });

    socket.on('turnChange', (turn) => {
      setCurrentTurn(turn);
      if (turn === playerId && !isWordSelector) {
        setMessage("It's your turn to guess!");
      } else if (turn !== playerId && !isWordSelector) {
        setMessage("Waiting for opponent's guess...");
      }
    });

    socket.on('opponentGuess', (guess) => {
      setGuesses(prevGuesses => {
        const newGuesses = [...prevGuesses];
        const emptyIndex = newGuesses.findIndex(val => val === "");
        setCurrentGuess('');
        newGuesses[emptyIndex] = guess;
        return newGuesses;
      });
    });

    useEffect(() => {
      if (solution && currentGuess) {
        let feedback = getWordleFeedback(currentGuess, solution);
        let letterFeedbacksCopy = { ...letterFeedbacks };
        feedback.forEach((color) => {
          if(color==='green') {
            letterFeedbacksCopy[guess] = 'correct';
          } else if(color==='yellow' && letterFeedbacksCopy[guess] !== 'correct') {
            letterFeedbacksCopy[guess] = 'present';
          } else if(color==='gray' && !['correct', 'present'].includes(letterFeedbacksCopy[guess])) {
            letterFeedbacksCopy[guess] = 'absent';
          }
        });
        setLetterFeedbacks(letterFeedbacksCopy);
      }
    }, [solution, currentGuess]);

    socket.on('guessUpdate', ({ guessCount, remainingGuesses }) => {
      setMessage(`Guess ${guessCount}/6. You have ${remainingGuesses} guesses remaining.`);
    });

    socket.on('gameOver', ({ winner, word }) => {
      setGameOver(true);
      setShowPlayAgain(true);
      if (winner === playerId) {
        setMessage(`Congratulations! You won! The word was ${word}`);
      } else {
        setMessage(`Game over! Your opponent guessed the word ${word}`);
      }
    });

    socket.on('opponentWantsPlayAgain', () => {
      setOpponentWantsPlayAgain(true);
    });

    socket.on('joinError', (message) => {
      setError(message);
    });

    

    return () => {
      socket.off('connect');
      socket.off('roomCreated');
      socket.off('gameStart');
      socket.off('wordSelected');
      socket.off('turnChange');
      socket.off('opponentGuess');
      socket.off('gameOver');
      socket.off('opponentWantsPlayAgain');
      socket.off('guessUpdate');
      socket.off('joinError');
    };
  }, [playerId, isWordSelector]);

  const handleCreateRoom = () => {
    socket.emit('createRoom', { isPrivate });
  };

  const handleJoinRoom = () => {
    socket.emit('joinRoom', { roomCode });
  };

  const handleKeyboardClick = (key) => {
    if (gameOver || isWordSelector || currentTurn !== playerId) return;

    if (key === 'Enter') {
      handleGuessSubmission();

    } else if (key === 'Backspace') {
      setCurrentGuess(prev => prev.slice(0, -1));
    } else if (currentGuess.length < 5) {
      setCurrentGuess(prev => prev + key);
    }
  };

  const handleWordSelection = useCallback(() => {
    if (!canSelectWord) return;
    if (selectedWord.length === 5) {
      socket.emit('selectWord', selectedWord);
      setMessage("Word selected. Waiting for opponent to guess.");
      setCanSelectWord(false);
    } else {
      setMessage("Please select a valid 5-letter word.");
    }
  }, [selectedWord, canSelectWord]);

  const handleKeyup = useCallback((e) => {
    if (gameOver || isWordSelector || currentTurn !== playerId) return;

    if (e.key === 'Enter') {
      handleGuessSubmission();
    }

    if (e.key === 'Backspace') {
      setCurrentGuess(prev => prev.slice(0, -1));
      return;
    }

    if (currentGuess.length < 5 && e.key.match(/^[A-Za-z]$/)) {
      setCurrentGuess(prev => prev + e.key.toUpperCase());
    }
  }, [currentGuess, guesses, solution, gameOver, currentTurn, playerId, isWordSelector]);

  useEffect(() => {
    keyupListenerRef.current = handleKeyup;
  }, [handleKeyup]);

  useEffect(() => {
    const listener = (e) => keyupListenerRef.current(e);
    window.addEventListener('keyup', listener);
    return () => window.removeEventListener('keyup', listener);
  }, []);

  const handlePlayAgain = () => {
    socket.emit('playAgain');
    setShowPlayAgain(false);
    setOpponentWantsPlayAgain(false);
  };

  const handleGuessSubmission = useCallback(() => {
    if (gameOver || isWordSelector || currentTurn !== playerId) return;
  
    if (currentGuess.length !== 5) {
      setMessage('Word must be 5 letters');
      return;
    }
    if (guesses.includes(currentGuess)) {
      setMessage('You already guessed this word');
      return;
    }

    socket.emit('makeGuess', currentGuess);
    setCurrentGuess('');
  }, [currentGuess, guesses, gameOver, isWordSelector, currentTurn, playerId, solution, socket]);
  

  if (gameState === 'menu') {
    return (
      <div className="menu">
        <h1>Wordle Multiplayer</h1>
        <div>
          <h2>Create a Room</h2>
          <label>
            <input 
              type="checkbox" 
              checked={isPrivate} 
              onChange={(e) => setIsPrivate(e.target.checked)} 
            />
            Private Room
          </label>
          <button onClick={handleCreateRoom}>Create Room</button>
        </div>
        <div>
          <h2>Join a Room</h2>
          <input 
            type="text" 
            value={roomCode} 
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())} 
            placeholder="Enter room code (optional)"
          />
          <button onClick={handleJoinRoom}>Join Room</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (gameState === 'waiting') {
    return (
      <div className="waiting">
        <h2>Waiting for opponent</h2>
        <p>Room Code: {roomCode}</p>
      </div>
    );
  }

  return (
    <div className="wordle">
      {isWordSelector && (
        <div className="word-selector">
          <input 
            type="text" 
            value={selectedWord} 
            onChange={(e) => setSelectedWord(e.target.value.toUpperCase())} 
            maxLength={5}
            disabled={!canSelectWord}
            placeholder="Enter 5-letter word"
          />
          <button onClick={handleWordSelection} disabled={!canSelectWord}>
            Select Word
          </button>
        </div>
      )}
      <div className="board">
      {Array.from({ length: 6 }).map((_, i) => {
        const guess = guesses[i] || '';
        const feedback = getWordleFeedback(guess, solution)
        return (
          <div key={i} className="row">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className={`cell ${feedback[j]}`}>
                {guess[j] || ''}
              </div>
            ))}
          </div>
        );
        })}
        <div className="row">
          {currentGuess.split('').map((letter, i) => (
            <div key={i} className="cell">{letter}</div>
          ))}
          {Array.from({ length: 5 - currentGuess.length }, (_, i) => (
            <div key={i + currentGuess.length} className="cell"></div>
          ))}
        </div>
      </div>
      {message && <div className="message">{message}</div>}
      {showPlayAgain && (
        <div className="play-again-prompt">
          <p>Do you want to play again?</p>
          <button onClick={handlePlayAgain}>Play Again</button>
          {opponentWantsPlayAgain && <p>Your opponent wants to play again!</p>}
        </div>
      )}
      <div className="keyboard">
        {keyboard.map((row, i) => (
          <div key={i} className="keyboard-row">
            {row.map((key) => (
              <button
                key={key}
                onClick={() => handleKeyboardClick(key)}
                className={`key ${getKeyClass(key, letterFeedbacks)}`}
              >
                {key}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
    
  );
};


function getKeyClass(key, letterFeedbacks) {
  //console.log(letterFeedbacks);
  return letterFeedbacks[key] || '';
}
function getWordleFeedback(guess, solution) {
    // Initialize the result array with 'G' (incorrect letter)
    let result = new Array(5).fill('');
    
    // Create a copy of the solution and guess to manage letter position tracking
    let solutionCopy = solution.toLowerCase().split('');
    let guessCopy = guess.toLowerCase().split('');
    
    if(guessCopy == '') { 
      return result;
    }

    // First pass: Mark 'R' for correct letters in the correct position
    for (let i = 0; i < 5; i++) {
        if (guessCopy[i] === solutionCopy[i]) {
            result[i] = 'green';
            // Remove this letter from the solution copy to avoid re-matching
            solutionCopy[i] = null;
            guessCopy[i] = null;
        }
    }
    
    // Second pass: Mark 'Y' for correct letters in the wrong position
    for (let i = 0; i < 5; i++) {
        if (result[i] !== 'green') { // Only check positions not marked 'G'
            let guessLetter = guessCopy[i];
            if (guessLetter !== null && solutionCopy.includes(guessLetter)) {
                result[i] = 'yellow';
                // Remove this letter from the solution copy to avoid re-matching
                let index = solutionCopy.indexOf(guessLetter);
                solutionCopy[index] = null;
            }
        }
    }
    console.log(result);
    return result;
}


export default Wordle;



