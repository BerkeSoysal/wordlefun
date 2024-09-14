import { useEffect, useState, useCallback } from 'react';
import './Wordle.css';
import io from 'socket.io-client';

const socket = io();


let cachedWordList = null;

const fetchWordList = async () => {
  if (cachedWordList) {
    return cachedWordList;
  }

  try {
    const response = await fetch('/WORDS.txt');
    const text = await response.text();
    cachedWordList = text.trim().split('\n');
    return cachedWordList;
  } catch (error) {
    console.error('Error fetching word list:', error);
    return [];
  }
};

function getWordleFeedback(guess, solution) {
    // Initialize the result array with 'G' (incorrect letter)
    let result = new Array(5).fill('R');
    
    // Create a copy of the solution and guess to manage letter position tracking
    let solutionCopy = solution.toLowerCase().split('');
    let guessCopy = guess.toLowerCase().split('');
    
    // First pass: Mark 'R' for correct letters in the correct position
    for (let i = 0; i < 5; i++) {
        if (guessCopy[i] === solutionCopy[i]) {
            result[i] = 'G';
            // Remove this letter from the solution copy to avoid re-matching
            solutionCopy[i] = null;
            guessCopy[i] = null;
        }
    }
    
    // Second pass: Mark 'Y' for correct letters in the wrong position
    for (let i = 0; i < 5; i++) {
        if (result[i] !== 'G') { // Only check positions not marked 'G'
            let guessLetter = guessCopy[i];
            if (guessLetter !== null && solutionCopy.includes(guessLetter)) {
                result[i] = 'Y';
                // Remove this letter from the solution copy to avoid re-matching
                let index = solutionCopy.indexOf(guessLetter);
                solutionCopy[index] = null;
            }
        }
    }
    console.log(result);
    return result;
}

const Wordle = () => {
  const [solution, setSolution] = useState('');
  const [guesses, setGuesses] = useState(Array(6).fill(""));
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState('');
  const [playerId, setPlayerId] = useState(null);
  const [currentTurn, setCurrentTurn] = useState(null);

  const keyboardLayout = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Enter', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace']
  ];

  useEffect(() => {
    socket.on('connect', () => {
      setPlayerId(socket.id);
      console.log("set")
    });

    socket.on('gameStart', ({ solution, turn }) => {
      setSolution(solution);
      setCurrentTurn(turn);
    });

    socket.on('gameOver', () => {
      setGameOver(true);
    });

    socket.on('turnChange', (nextTurn) => {
      setCurrentTurn(nextTurn);
    });

    socket.on('opponentGuess', (guess) => {
      setGuesses(prevGuesses => {
        const newGuesses = [...prevGuesses];
        const emptyIndex = newGuesses.findIndex(val => val === '');
        newGuesses[emptyIndex] = guess;
        return newGuesses;
      });
    });

    return () => {
      socket.off('connect');
      socket.off('gameStart');
      socket.off('turnChange');
      socket.off('opponentGuess');
    };
  }, []);

  useEffect(() => {
    // In a real app, you'd fetch this from an API
    const fetchSolution = async () => {
      await fetchWordList();
    };
    fetchSolution();
  }, []);

  const handleKeyup = useCallback((e) => {
    if (gameOver || currentTurn !== playerId) return;


    if (e.key === 'Enter') {
      socket.setMessage("");
      if (currentGuess.length !== 5) {
        return;
      }
      // Check if the guess has already been made
      if (guesses.includes(currentGuess)) {
        setMessage('You already guessed this word');
        return;
      }

      // Check if the guess is in the cached word list
      if (cachedWordList.includes(currentGuess.toLowerCase())) {
        const newGuesses = [...guesses];
        const emptyIndex = newGuesses.findIndex(val => val === '');
        newGuesses[emptyIndex] = currentGuess;
        setGuesses(newGuesses);
        setCurrentGuess('');

        if (currentGuess.toLowerCase() === solution.toLowerCase()) {
          socket.emit('gameOver')
          setMessage('Congratulations! You won!');
        } else if (emptyIndex === 5) {
          socket.emit('gameOver')
          setMessage(`Game over! The word was ${solution}`);
        }
        socket.emit('makeGuess', currentGuess);
      } else {
        setMessage('Not a valid word');
      }
    }

    if (e.key === 'Backspace') {
      setCurrentGuess(currentGuess.slice(0, -1));
      return;
    }

    if (currentGuess.length < 5 && e.key.match(/^[A-Za-z]$/)) {
      setCurrentGuess(oldGuess => oldGuess + e.key);
    }
  }, [currentGuess, guesses, solution, cachedWordList, gameOver, currentTurn, playerId]);

  useEffect(() => {
    window.addEventListener('keyup', handleKeyup);

    return () => window.removeEventListener('keyup', handleKeyup);
  }, [handleKeyup]);

  const handleKeyClick = (key) => {
    if (gameOver) return;
    if (key === 'Enter') {
      handleKeyup({ key: 'Enter' });
    } else if (key === 'Backspace') {
      handleKeyup({ key: 'Backspace' });
    } else {
      handleKeyup({ key });
    }
  };

  const getColorClass = (feedbackLetter) => {
    switch(feedbackLetter) {
      case 'R': return 'gray';
      case 'Y': return 'yellow';
      case 'G': return 'green';
      default: return '';
    }
  };
  
  return (
    <div className="wordle">
      <div className="board">
        {guesses.map((guess, i) => {
          const feedback = guess ? getWordleFeedback(guess, solution) : null;
          return (
            <div key={i} className="row">
              {Array.from({ length: 5 }, (_, j) => (
                <div key={j} 
                className={`cell ${feedback ? getColorClass(feedback[j]) : ''}`}>
                  {guess ? guess[j] : ''} 
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
      <div className="keyboard">
        {keyboardLayout.map((row, rowIndex) => (
          <div key={rowIndex} className="keyboard-row">
            {row.map((key) => (
              <button
                key={key}
                className={`key ${key === 'Enter' || key === 'Backspace' ? 'wide-key' : ''}`}
                onClick={() => handleKeyClick(key)}
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

export default Wordle;



