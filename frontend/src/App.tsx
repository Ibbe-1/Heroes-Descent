import { useState } from 'react';
import { getToken, getUsername, clearAuth } from './services/authService';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

type Screen = 'login' | 'register' | 'game';

function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    getToken() ? 'game' : 'login'
  );
  const [username, setUsername] = useState<string>(() => getUsername() ?? '');

  function handleLogin(name: string) {
    setUsername(name);
    setScreen('game');
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

  return (
    <div>
      <p>Welcome, {username}! <button onClick={handleLogout}>Logout</button></p>
    </div>
  );
}

export default App;
