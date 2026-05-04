import { useState } from 'react';
import { getToken, getUsername, clearAuth } from './services/authService';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import GamePage from './pages/GamePage';

type Screen = 'login' | 'register' | 'home' | 'game';

function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    getToken() ? 'home' : 'login'
  );
  const [username, setUsername] = useState<string>(() => getUsername() ?? '');
  // userId is the sub claim from the JWT; decode it client-side for the SignalR userId match.
  const [userId, setUserId] = useState<string>(() => decodeUserId(getToken()));

  function handleLogin(name: string, token: string) {
    setUsername(name);
    setUserId(decodeUserId(token));
    setScreen('home');
  }

  function handleLogout() {
    clearAuth();
    setUsername('');
    setUserId('');
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
        onLogin={(name, token) => handleLogin(name, token)}
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
    <GamePage
      username={username}
      userId={userId}
      onBack={() => setScreen('home')}
    />
  );
}

function decodeUserId(token: string | null): string {
  if (!token) return '';
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    // ASP.NET Core Identity JWT uses nameid or sub for the user ID
    return decoded['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']
      ?? decoded['sub']
      ?? decoded['nameid']
      ?? '';
  } catch {
    return '';
  }
}

export default App;
