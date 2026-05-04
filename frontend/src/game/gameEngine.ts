import * as signalR from '@microsoft/signalr';
import { getToken } from '../services/authService';
import type { GameState, HeroClass } from '../types/gameTypes';

export class GameEngine {
  private connection: signalR.HubConnection;
  private _sessionId = '';

  onStateUpdate: ((state: GameState) => void) | null = null;

  constructor() {
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl('/gamehub', { accessTokenFactory: () => getToken() ?? '' })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.connection.on('GameStateUpdate', (state: GameState) => {
      this.onStateUpdate?.(state);
    });
  }

  async connect(): Promise<void> {
    if (this.connection.state === signalR.HubConnectionState.Disconnected) {
      await this.connection.start();
    }
  }

  async disconnect(): Promise<void> {
    await this.connection.stop();
  }

  async createSession(username: string, heroClass: HeroClass): Promise<string> {
    const id = await this.connection.invoke<string>('CreateSession', username, heroClass);
    this._sessionId = id;
    return id;
  }

  async joinSession(sessionId: string, username: string, heroClass: HeroClass): Promise<boolean> {
    const ok = await this.connection.invoke<boolean>('JoinSession', sessionId, username, heroClass);
    if (ok) this._sessionId = sessionId;
    return ok;
  }

  sendPosition(x: number, y: number): void {
    this.connection.invoke('SendPosition', this._sessionId, x, y).catch(() => {});
  }

  attackNearest(): void {
    this.connection.invoke('AttackNearest', this._sessionId).catch(() => {});
  }

  useAbility(): void {
    this.connection.invoke('UseAbility', this._sessionId).catch(() => {});
  }

  moveToNextRoom(): void {
    this.connection.invoke('MoveToNextRoom', this._sessionId).catch(() => {});
  }

  get sessionId(): string { return this._sessionId; }
}
