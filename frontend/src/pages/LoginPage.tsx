import { useState, type FormEvent } from 'react';
import { login, saveAuth } from '../services/authService';
import styles from './AuthPage.module.css';

interface Props {
  onLogin: (username: string, token: string) => void;
  onNavigateRegister: () => void;
}

export default function LoginPage({ onLogin, onNavigateRegister }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login({ email, password });
      saveAuth(res.token, res.username);
      onLogin(res.username, res.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.logoBanner}>
        <img src="/logga.webp" className={styles.logo} alt="Heroes Descent" />
      </div>
      <div className={styles.card}>
        <h2 className={styles.subtitle}>— Sign In —</h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Entering...' : '⚔ Enter the Descent ⚔'}
          </button>
        </form>
        <p className={styles.switch}>
          No account?{' '}
          <button className={styles.link} type="button" onClick={onNavigateRegister}>
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
