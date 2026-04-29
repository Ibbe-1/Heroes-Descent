import { useState, type FormEvent } from 'react';
import { register } from '../services/authService';
import styles from './AuthPage.module.css';

interface Props {
  onRegistered: () => void;
  onNavigateLogin: () => void;
}

export default function RegisterPage({ onRegistered, onNavigateLogin }: Props) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register({ username, email, password });
      onRegistered();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Heroes Descent</h1>
        <h2 className={styles.subtitle}>Create Account</h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Username
            <input
              className={styles.input}
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
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
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Begin Your Journey'}
          </button>
        </form>
        <p className={styles.switch}>
          Already have an account?{' '}
          <button className={styles.link} type="button" onClick={onNavigateLogin}>
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
