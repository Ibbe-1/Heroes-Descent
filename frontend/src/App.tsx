// App.tsx
// Root component — handles which screen is currently visible.
// Screens:
//   login    — email + password form (LoginPage)
//   register — create account form (RegisterPage)
//   home     — main dashboard after login (HomePage) ← added today
//   game     — placeholder until the game is implemented
//
// The JWT token in localStorage is checked on startup: if it exists, the player
// goes straight to 'home' instead of 'login'.

import { useState } from 'react';
import { getToken, getUsername, clearAuth } from './services/authService';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';

type Screen = 'login' | 'register' | 'home' | 'game';

function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    getToken() ? 'home' : 'login'
  );
  const [username, setUsername] = useState<string>(() => getUsername() ?? '');

  function handleLogin(name: string) {
    setUsername(name);
    setScreen('home');
  }

  function handleLogout() {
    clearAuth();
    setUsername('');
    setScreen('login');
  }

  if (screen === 'register') {
    return (
      <RegisterPage
        onRegistered={() => setScreen('login')}
        onNavigateLogin={() => setScreen('login')}
      />
    );
  }

  if (screen === 'login') {
    return (
      <LoginPage
        onLogin={(name, _token) => handleLogin(name)}
        onNavigateRegister={() => setScreen('register')}
      />
    );
  }

  if (screen === 'home') {
    return (
      <HomePage
        username={username}
        onLogout={handleLogout}
        onPlay={() => setScreen('game')}
      />
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#07070d',
      color: '#c9a84c',
      fontFamily: "'Courier New', Courier, monospace",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1.5rem',
    }}>
      <p style={{ letterSpacing: '0.1em' }}>[ Game not yet implemented ]</p>
      <button
        onClick={() => setScreen('home')}
        style={{
          background: 'transparent',
          border: '1px solid rgba(201,168,76,0.4)',
          color: '#c9a84c',
          fontFamily: 'inherit',
          fontSize: '0.8rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding: '0.5rem 1.2rem',
          cursor: 'pointer',
        }}
      >
        ← Return to Home
      </button>
    </div>
  );
}

export default App;
