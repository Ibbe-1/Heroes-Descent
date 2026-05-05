// gameTypes.ts — TypeScript interfaces that mirror the C# DTOs from
// Application/Dtos/GameStateDto.cs.
//
// Every time the server sends a "GameStateUpdate" SignalR message, the payload
// matches the GameState interface below. The Phaser scene and React HUD both
// read from this same object, so there's only one source of truth per frame.
//
// When adding or changing a field on the C# side, update the matching interface
// here to keep the two in sync — TypeScript won't catch a missing field at runtime.

export type HeroClass = 'Warrior' | 'Wizard' | 'Archer';

// One enemy currently in the room.
// x / y are pixel coordinates in the 960 × 640 game canvas space —
// the Phaser scene uses them to position the enemy's rectangle sprite.
export interface EnemyState {
  id: string;         // unique per enemy instance, matched to Phaser sprites
  name: string;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  x: number;
  y: number;
}

export interface RoomState {
  type: 'Normal' | 'Elite' | 'Boss' | 'TreasureChest';
  enemies: EnemyState[];
  isCleared: boolean;
}

// One player in the session, including all info needed to render their HUD card
// and their sprite at the correct position.
export interface PlayerState {
  userId: string;
  username: string;
  heroClass: HeroClass;
  currentHp: number;
  maxHp: number;
  isAlive: boolean;

  // Resource bar — covers all three classes:
  //   Warrior → Rage, Wizard → Mana, Archer → Energy
  resource: number;
  maxResource: number;
  resourceName: string;

  canUseAbility: boolean;
  abilityName: string;

  // How long (ms) the client should locally disable the attack button after pressing SPACE.
  // Mirrors the server-side cooldown so the UI feels responsive without cheating.
  attackCooldownMs: number;

  // World position — updated ~10 times per second via EnemyAiService broadcasts.
  x: number;
  y: number;

  gold: number;
}

// The full game state sent to all clients after every significant event.
export interface GameState {
  sessionId: string;
  currentRoomIndex: number;
  totalRooms: number;
  currentRoom: RoomState;
  players: PlayerState[];
  log: string[];        // last 15 combat log lines
  isGameOver: boolean;
  isVictory: boolean;
}
