import type { AuthResponse, LoginRequest, RegisterRequest } from '../types/authTypes';

const BASE = '/api/auth';

export async function login(data: LoginRequest): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Login failed');
  }
  return res.json();
}

export async function register(data: RegisterRequest): Promise<void> {
  const res = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // Identity returns an array of error objects with a `description` field
    const message = Array.isArray(body) && body[0]?.description
      ? body[0].description
      : 'Registration failed';
    throw new Error(message);
  }
}

export function saveAuth(token: string, username: string): void {
  localStorage.setItem('hd_token', token);
  localStorage.setItem('hd_username', username);
}

export function getToken(): string | null {
  return localStorage.getItem('hd_token');
}

export function getUsername(): string | null {
  return localStorage.getItem('hd_username');
}

export function clearAuth(): void {
  localStorage.removeItem('hd_token');
  localStorage.removeItem('hd_username');
}
