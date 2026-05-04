// friendService.ts
// All API calls related to the friends/party system.
// Every request sends the player's JWT so the backend knows who is calling.
//
// Endpoints used:
//   GET    /api/friends              — fetch your friend list
//   POST   /api/friends              — add a friend by username
//   DELETE /api/friends/{username}   — remove a friend

import { getToken } from './authService';

export interface FriendEntry {
  username: string;
  online: boolean; // always false until SignalR presence is wired up
}

// Builds the Authorization header from the stored JWT.
// All friends endpoints are [Authorize] on the backend, so this is required.
function authHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`,
  };
}

// Fetches the current player's friend list from the database.
export async function getFriends(): Promise<FriendEntry[]> {
  const res = await fetch('/api/friends', { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to load friends.');
  return res.json();
}

// Sends a request to add a friend by their username.
// Throws with the server's error message on failure (e.g. "No hero found").
export async function addFriend(username: string): Promise<void> {
  const res = await fetch('/api/friends', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to add friend.');
  }
}

// Removes a friend from the current player's list.
// Throws with the server's error message on failure.
export async function removeFriend(username: string): Promise<void> {
  const res = await fetch(`/api/friends/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to remove friend.');
  }
}
