export type HeroClass = 'Warrior' | 'Wizard' | 'Archer';

export interface EnemyState {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  x: number;
  y: number;
}

export interface RoomState {
  type: 'Normal' | 'Elite' | 'Boss';
  enemies: EnemyState[];
  isCleared: boolean;
}

export interface PlayerState {
  userId: string;
  username: string;
  heroClass: HeroClass;
  currentHp: number;
  maxHp: number;
  isAlive: boolean;
  resource: number;
  maxResource: number;
  resourceName: string;
  canUseAbility: boolean;
  abilityName: string;
  attackCooldownMs: number;
  x: number;
  y: number;
}

export interface GameState {
  sessionId: string;
  currentRoomIndex: number;
  totalRooms: number;
  currentRoom: RoomState;
  players: PlayerState[];
  log: string[];
  isGameOver: boolean;
  isVictory: boolean;
}
