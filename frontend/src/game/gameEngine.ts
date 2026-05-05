// gameEngine.ts — thin wrapper around the SignalR WebSocket connection.
//
// SignalR keeps a persistent connection open between the browser and the server.
// Instead of the browser sending an HTTP request and waiting for a response,
// both sides can push messages at any time — which is what makes the game real-time.
//
// This class hides the SignalR details so the rest of the frontend
// (Phaser scene, React components) just calls plain methods like attackNearest().

import * as signalR from '@microsoft/signalr';
import { getToken } from '../services/authService';
import type { GameState, HeroClass } from '../types/gameTypes';

export class GameEngine {
  private connection: signalR.HubConnection;
  private _sessionId = '';

  // React sets this callback so it receives every state update from the server.
  onStateUpdate: ((state: GameState) => void) | null = null;

  constructor() {
    this.connection = new signalR.HubConnectionBuilder()
      // /gamehub is proxied by Vite to http://localhost:5000/gamehub (see vite.config.ts).
      // accessTokenFactory attaches the JWT so the server can identify who is connecting.
      .withUrl('/gamehub', { accessTokenFactory: () => getToken() ?? '' })
      // Automatically reconnects if the connection drops (e.g. brief network blip).
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    // "GameStateUpdate" is the event name the server uses when it calls
    // Clients.Group(sessionId).SendAsync("GameStateUpdate", dto).
    // Every player in the session receives this message simultaneously.
    this.connection.on('GameStateUpdate', (state: GameState) => {
      this.onStateUpdate?.(state);
    });
  }

  // Opens the WebSocket. Must be called before any other method.
  async connect(): Promise<void> {
    if (this.connection.state === signalR.HubConnectionState.Disconnected) {
      await this.connection.start();
    }
  }

  async disconnect(): Promise<void> {
    await this.connection.stop();
  }

  // Creates a new dungeon session on the server and returns the 6-char join code.
  async createSession(username: string, heroClass: HeroClass): Promise<string> {
    const id = await this.connection.invoke<string>('CreateSession', username, heroClass);
    this._sessionId = id;
    return id;
  }

  // Joins an existing session by code. Returns false if the code is invalid or the session is full.
  async joinSession(sessionId: string, username: string, heroClass: HeroClass): Promise<boolean> {
    const ok = await this.connection.invoke<boolean>('JoinSession', sessionId, username, heroClass);
    if (ok) this._sessionId = sessionId;
    return ok;
  }

  // Sends the local player's current position to the server every ~50 ms.
  // The server stores it and includes it in the next broadcast so other players
  // can see where this player is. Fire-and-forget — no awaiting needed.
  sendPosition(x: number, y: number): void {
    this.connection.invoke('SendPosition', this._sessionId, x, y).catch(() => {});
  }

  // Tells the server the player pressed SPACE.
  // dirX/dirY is a normalised direction vector toward the mouse cursor.
  // Warrior: cone melee. Archer/Wizard: ray-cast skillshot.
  attackDirectional(dirX: number, dirY: number): void {
    this.connection.invoke('AttackDirectional', this._sessionId, dirX, dirY).catch(() => {});
  }

  // Legacy auto-target — kept for potential fallback use.
  attackNearest(): void {
    this.connection.invoke('AttackNearest', this._sessionId).catch(() => {});
  }

  // Tells the server the player pressed Q (class ability).
  // dirX/dirY is the normalised aim direction — used by Archer's Multi-Shot.
  useAbility(dirX = 0, dirY = 0): void {
    this.connection.invoke('UseAbility', this._sessionId, dirX, dirY).catch(() => {});
  }

  // Tells the server to move the party to the next room (only works if room is cleared).
  moveToNextRoom(): void {
    this.connection.invoke('MoveToNextRoom', this._sessionId).catch(() => {});
  }

  get sessionId(): string { return this._sessionId; }
}
