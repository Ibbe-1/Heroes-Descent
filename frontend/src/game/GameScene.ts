import Phaser from 'phaser';
import type { GameState, EnemyState, PlayerState, RoomState, ActiveProjectile } from '../types/gameTypes';
import type { GameEngine } from './gameEngine';
import { REGION_W, REGION_H } from './MapRegionManager';

const ATTACK_RANGE = 150;
const CLASS_RANGE: Record<string, number> = { Warrior: 150, Archer: 600, Wizard: 800 };
const HIT_RADIUS: Record<string, number> = { Archer: 32, Wizard: 52 };

// Scale chosen so each class renders at roughly 70 px tall on the 960×640 viewport.
const CLASS_SCALE: Record<string, number> = {
  Warrior: 0.95,
  Wizard:  0.6,
  Archer:  1.0,
};

const ENEMY_COLOR: Record<string, number> = {};

// ── World decorations ──────────────────────────────────────────────────────
// Torch positions in world-space (origin at (0, 0), world = REGION_W × REGION_H).
// These are placed on top of whatever map region is currently rendered.

interface HazardZone { x1: number; y1: number; x2: number; y2: number; }

const WORLD_TORCHES: { x: number; y: number }[] = [
  { x: 100,  y: 80  }, { x: 640,  y: 80  }, { x: 1180, y: 80  },
  { x: 100,  y: 450 }, { x: 1180, y: 450 },
  { x: 100,  y: 820 }, { x: 640,  y: 820 }, { x: 1180, y: 820 },
];

function roomDisplayName(roomType?: string, roomIndex = 0): string {
  if (roomType === 'Boss')          return 'Boss Sanctum';
  if (roomType === 'TreasureChest') return 'Treasure Vault';
  if (roomType === 'Elite')         return 'Elite Chamber';
  return `Chamber ${roomIndex + 1}`;
}

// ── Sprite interfaces ───────────────────────────────────────────────────────

// Regular enemies render as coloured rectangles; boss/Golem use animated sprites.
interface EnemySprite {
  body:         Phaser.GameObjects.Rectangle | null;
  sprite:       Phaser.GameObjects.Sprite    | null;
  // Golem only: the charge orb sprite shown in front of the Golem during wind-up.
  chargeSprite: Phaser.GameObjects.Sprite    | null;
  label:        Phaser.GameObjects.Text      | null;
  prevHp:       number;
  dead:         boolean;
  prevX:        number;
  prevY:        number;
  animKey:      string;
  // Tracks whether isLaserFiring was true last tick to detect the firing transition.
  wasFiring:    boolean;
}

// Other players are rendered as animated sprites.
interface OtherSprite {
  sprite:    Phaser.GameObjects.Sprite;
  label:     Phaser.GameObjects.Text;
  heroClass: string;
  animKey:   string;
  prevX:     number;
  prevY:     number;
  dead:      boolean;
}

// Animations that block idle/run transitions until they complete.
const LOCKED_ANIMS = new Set([
  'warrior-attack', 'warrior-dash', 'warrior-take-hit', 'warrior-death',
  'wizard-attack1',  'wizard-attack2',  'wizard-hit',     'wizard-death',
  'archer-attack',   'archer-get-hit',  'archer-death',
]);

export class GameScene extends Phaser.Scene {
  private engine: GameEngine | null = null;
  private myUserId   = '';
  private myUsername = '';

  private state:         GameState | null = null;
  private lastRoomIndex     = -1;
  private regularRoomCount  = 0;

  private localX = REGION_W / 2;
  private localY = REGION_H / 2;
  private levelWidth  = REGION_W;
  private levelHeight = REGION_H;
  private readonly SPEED = 220;
  private lastPosSent   = 0;
  private lastAttackTime = 0;

  private mySprite!: Phaser.GameObjects.Sprite;
  private myLabel!:  Phaser.GameObjects.Text;
  private hpBars!:   Phaser.GameObjects.Graphics;

  private others:           Map<string, OtherSprite> = new Map();
  private enemySprites:     Map<string, EnemySprite>  = new Map();
  // Tracks one fireball sprite per active server-side projectile ID.
  // Entries are added when a new ID appears in state.activeProjectiles and
  // destroyed (with an impact burst) when the ID disappears.
  private projectileSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();

  // Treasure chest sprite — only present in TreasureChest rooms.
  private chestSprite: {
    body: Phaser.GameObjects.Sprite;
    hint: Phaser.GameObjects.Text;
  } | null = null;
  private chestIsOpen = false;

  // One Graphics object per active flame wave from the Dark Mage boss.
  // Drawn as a glowing vertical fire band; updated each server tick.
  private flameWaveGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();

  private myHeroClass    = '';
  private prevPlayerHp:  Map<string, number> = new Map();
  private prevMyHp       = -1;
  private currentAnimKey = '';
  private aimGraphics!:  Phaser.GameObjects.Graphics;

  // ── Keyboard bindings ─────────────────────────────────────────────────────
  // Registered in create() via kb.addKey().
  // Every key is also passed to kb.addCapture() so the browser never intercepts
  // it (e.g. SPACE scrolling the page, W/S moving the scrollbar).
  private kW!:     Phaser.Input.Keyboard.Key;  // W     — move player UP
  private kA!:     Phaser.Input.Keyboard.Key;  // A     — move player LEFT
  private kS!:     Phaser.Input.Keyboard.Key;  // S     — move player DOWN
  private kD!:     Phaser.Input.Keyboard.Key;  // D     — move player RIGHT
  private kSpace!: Phaser.Input.Keyboard.Key;  // SPACE — basic attack aimed at the mouse cursor
  private kQ!:     Phaser.Input.Keyboard.Key;  // Q     — class ability (Warrior: Undying Rage | Wizard: Fireball | Archer: Multi-Shot)

  private roomDecorations: Phaser.GameObjects.GameObject[] = [];
  // Active hazard zones for the current room — checked every move() tick.
  private currentHazards: HazardZone[] = [];

  // ── Audio ─────────────────────────────────────────────────────────────────
  private bgMusic: Phaser.Sound.BaseSound | null = null;
  private masterVol = 0.8;
  private musicVol  = 0.7;
  private sfxVol    = 0.8;
  private golemWalkTimer = 0;
  private prevMeAlive    = true;

  constructor() { super({ key: 'GameScene' }); }

  // ── Phaser lifecycle: preload ──────────────────────────────────────────────

  preload() {
    // Background images — one per room environment, displayed at native resolution.
    this.load.image('bg-entrance-hall',           '/assets/BackgroundAssets/EntranceHall.png');
    this.load.image('bg-green-garden',            '/assets/BackgroundAssets/GreenGarden.png');
    this.load.image('bg-water-canal',             '/assets/BackgroundAssets/WaterCanal.png');
    this.load.image('bg-lava-maze',               '/assets/BackgroundAssets/LavaMaze.png');
    this.load.image('bg-library',                 '/assets/BackgroundAssets/Library.png');
    this.load.image('bg-crystal-cave',            '/assets/BackgroundAssets/CrystalCave.png');
    this.load.image('bg-armory',                  '/assets/BackgroundAssets/Armory.png');
    this.load.image('bg-throne-room',             '/assets/BackgroundAssets/ThroneRoom.png');
    this.load.image('bg-treasury',                '/assets/BackgroundAssets/Treasury.png');
    this.load.image('bg-demonic-summoning-room',  '/assets/BackgroundAssets/DemonicSummoningRoom.png');
    this.load.image('bg-boss-room',               '/assets/BackgroundAssets/BossRoom.png');
    this.load.image('bg-exit-hall',               '/assets/BackgroundAssets/ExitHall.png');

    // Shop NPCs — sprite sheets displayed in the Exit Hall after the boss is defeated.
    // Measured dimensions: Blacksmith 672×96 (7×96 frames), Alchemist 768×96 (8×96 frames),
    // Enchanter 1024×96 (8×128 frames — wider scene with bookshelf + cauldron).
    this.load.spritesheet('shop-blacksmith', '/assets/Shop/Blacksmith/BLACKSMITH.png', { frameWidth: 96,  frameHeight: 96 });
    this.load.spritesheet('shop-enchanter',  '/assets/Shop/Enchanter/ENCHANTER.png',   { frameWidth: 128, frameHeight: 96 });
    this.load.spritesheet('shop-alchemist',  '/assets/Shop/Alchemist/ALCHEMIST.png',   { frameWidth: 96,  frameHeight: 96 });

    // Warrior — 140×140 frames
    this.load.spritesheet('warrior-idle',     '/assets/Warrior/Idle.png',     { frameWidth: 140, frameHeight: 140 });
    this.load.spritesheet('warrior-run',      '/assets/Warrior/Run.png',      { frameWidth: 140, frameHeight: 140 });
    this.load.spritesheet('warrior-jump',     '/assets/Warrior/Jump.png',     { frameWidth: 140, frameHeight: 140 });
    this.load.spritesheet('warrior-fall',     '/assets/Warrior/Fall.png',     { frameWidth: 140, frameHeight: 140 });
    this.load.spritesheet('warrior-dash',     '/assets/Warrior/Dash.png',     { frameWidth: 140, frameHeight: 140 });
    this.load.spritesheet('warrior-attack',   '/assets/Warrior/Attack.png',   { frameWidth: 140, frameHeight: 140 });
    this.load.spritesheet('warrior-take-hit', '/assets/Warrior/Take Hit.png', { frameWidth: 140, frameHeight: 140 });
    this.load.spritesheet('warrior-death',    '/assets/Warrior/Death.png',    { frameWidth: 140, frameHeight: 140 });

    // Wizard — 231×190 frames
    this.load.spritesheet('wizard-idle',    '/assets/Wizzard/Idle.png',    { frameWidth: 231, frameHeight: 190 });
    this.load.spritesheet('wizard-run',     '/assets/Wizzard/Run.png',     { frameWidth: 231, frameHeight: 190 });
    this.load.spritesheet('wizard-jump',    '/assets/Wizzard/Jump.png',    { frameWidth: 231, frameHeight: 190 });
    this.load.spritesheet('wizard-fall',    '/assets/Wizzard/Fall.png',    { frameWidth: 231, frameHeight: 190 });
    this.load.spritesheet('wizard-attack1', '/assets/Wizzard/Attack1.png', { frameWidth: 231, frameHeight: 190 });
    this.load.spritesheet('wizard-attack2', '/assets/Wizzard/Attack2.png', { frameWidth: 231, frameHeight: 190 });
    this.load.spritesheet('wizard-hit',     '/assets/Wizzard/Hit.png',     { frameWidth: 231, frameHeight: 190 });
    this.load.spritesheet('wizard-death',   '/assets/Wizzard/Death.png',   { frameWidth: 231, frameHeight: 190 });

    // Archer — 100×100 frames
    this.load.spritesheet('archer-idle',    '/assets/Archer/Character/Idle.png',    { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('archer-run',     '/assets/Archer/Character/Run.png',     { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('archer-jump',    '/assets/Archer/Character/Jump.png',    { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('archer-fall',    '/assets/Archer/Character/Fall.png',    { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('archer-attack',  '/assets/Archer/Character/Attack.png',  { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('archer-get-hit', '/assets/Archer/Character/Get Hit.png', { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('archer-death',   '/assets/Archer/Character/Death.png',   { frameWidth: 100, frameHeight: 100 });

    // Dark Mage boss — 250×250 frames
    this.load.spritesheet('boss-idle',     '/assets/Darkmage/Idle.png',     { frameWidth: 250, frameHeight: 250 });
    this.load.spritesheet('boss-run',      '/assets/Darkmage/Run.png',      { frameWidth: 250, frameHeight: 250 });
    this.load.spritesheet('boss-attack',   '/assets/Darkmage/Attack2.png',  { frameWidth: 250, frameHeight: 250 });
    this.load.spritesheet('boss-take-hit', '/assets/Darkmage/Take hit.png', { frameWidth: 250, frameHeight: 250 });
    this.load.spritesheet('boss-death',    '/assets/Darkmage/Death.png',    { frameWidth: 250, frameHeight: 250 });
    this.load.spritesheet('boss-jump',     '/assets/Darkmage/Jump.png',     { frameWidth: 250, frameHeight: 250 });
    this.load.spritesheet('boss-fall',     '/assets/Darkmage/Fall.png',     { frameWidth: 250, frameHeight: 250 });
    // Fireball — 128×160, 4 cols × 5 rows of 32×32; purple = row 1 (frames 4–7)
    this.load.spritesheet('boss-fireball', '/assets/Darkmage/Fireball.png', { frameWidth: 32, frameHeight: 32 });

    // Golem Elite MiniBoss — Character_sheet.png is 1000×1000 (10×10 grid of 100×100 frames)
    //   Row 0 (frames  0– 3): Idle
    //   Row 1 (frames 10–17): Walk
    //   Row 2 (frames 20–28): Attack
    //   Row 3 (frames 30–37): Hit stagger
    //   Row 8 (frames 80–83): Death
    this.load.spritesheet('golem-sheet', '/assets/Golem/Mecha-stone Golem 0.1/PNG sheet/Character_sheet.png', { frameWidth: 100, frameHeight: 100 });
    // Glowing arm projectile — 300×300 (3×3 grid of 100×100 frames, frames 0–8)
    this.load.spritesheet('golem-projectile', '/assets/Golem/Mecha-stone Golem 0.1/weapon PNG/arm_projectile_glowing.png', { frameWidth: 100, frameHeight: 100 });
    // Laser sheet — 300×1500 (1 col × 15 rows of 300×100 frames)
    //   Frames 0–7:  charge-up orb growing (played as looping wind-up visual)
    //   Frames 8–14: full laser beam firing (played once when the shot lands)
    this.load.spritesheet('golem-laser', '/assets/Golem/Mecha-stone Golem 0.1/weapon PNG/Laser_sheet.png', { frameWidth: 300, frameHeight: 100 });
    // Goblin — 150×150 frames
    this.load.spritesheet('goblin-attack', '/assets/Goblin/Attack3.png',     { frameWidth: 150, frameHeight: 150 });
    this.load.spritesheet('goblin-bomb',   '/assets/Goblin/Bomb_sprite.png', { frameWidth: 100, frameHeight: 100 });

    // Skeleton — 150×150 body frames, 92×102 sword projectile frames
    this.load.spritesheet('skeleton-attack', '/assets/Skeleton/Attack3.png',     { frameWidth: 150, frameHeight: 150 });
    this.load.spritesheet('skeleton-sword',  '/assets/Skeleton/Sword_sprite.png', { frameWidth: 92,  frameHeight: 102 });

    // Bat — 87×87 frames
    this.load.spritesheet('bat-fly',         '/assets/Bat/fly.png',         { frameWidth: 87, frameHeight: 87 });
    this.load.spritesheet('bat-attack',      '/assets/Bat/attack.png',      { frameWidth: 87, frameHeight: 87 });
    this.load.spritesheet('bat-hurt',        '/assets/Bat/hurt.png',        { frameWidth: 87, frameHeight: 87 });
    this.load.spritesheet('bat-fly-to-fall', '/assets/Bat/fly-to-fall.png', { frameWidth: 87, frameHeight: 87 });
    this.load.spritesheet('bat-fall',        '/assets/Bat/fall.png',        { frameWidth: 87, frameHeight: 87 });
    this.load.spritesheet('bat-death',       '/assets/Bat/death.png',       { frameWidth: 87, frameHeight: 87 });

    // Slime — 156×156 frames
    this.load.spritesheet('slime-idle',   '/assets/Slime/idle.png',   { frameWidth: 156, frameHeight: 156 });
    this.load.spritesheet('slime-walk',   '/assets/Slime/walk.png',   { frameWidth: 156, frameHeight: 156 });
    this.load.spritesheet('slime-attack', '/assets/Slime/attack.png', { frameWidth: 156, frameHeight: 156 });
    this.load.spritesheet('slime-hurt',   '/assets/Slime/hurt.png',   { frameWidth: 156, frameHeight: 156 });
    this.load.spritesheet('slime-death',  '/assets/Slime/death.png',  { frameWidth: 156, frameHeight: 156 });

    // Mushroom — 150×150 body frames, 50×50 projectile frames
    this.load.spritesheet('mushroom-attack',     '/assets/Mushroom/Attack3.png',          { frameWidth: 150, frameHeight: 150 });
    this.load.spritesheet('mushroom-projectile', '/assets/Mushroom/Projectile_sprite.png', { frameWidth: 50,  frameHeight: 50  });

    // Mimic — 146×146 frames
    this.load.spritesheet('mimic-idle-closed',    '/assets/Mimic/Idle_closed.png',      { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-opening',         '/assets/Mimic/opening.png',          { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-idle-open',       '/assets/Mimic/idle_open.png',        { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-transform',       '/assets/Mimic/transform.png',        { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-idle-transformed','/assets/Mimic/idle_transformed.png', { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-walk',            '/assets/Mimic/walk.png',             { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-attack-1',        '/assets/Mimic/attack_1.png',         { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-attack-2',        '/assets/Mimic/attack_2.png',         { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-hurt',            '/assets/Mimic/hurt.png',             { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-death',           '/assets/Mimic/death.png',            { frameWidth: 146, frameHeight: 146 });

    // Treasure chest — 36×25 frames, 2 rows of 8; row 0 (frames 0–7) = Basic brown/gold, row 1 = Fancy green
    this.load.spritesheet('chest-sheet', '/assets/TreasureChest/Treasure Chest - Basic & Fancy.png', { frameWidth: 36, frameHeight: 25 });

    // Mad King — treasure guardian, 160×111 frames
    this.load.spritesheet('madking-idle',     '/assets/MadKing/Idle.png',     { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-run',      '/assets/MadKing/Run.png',      { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-attack1',  '/assets/MadKing/Attack1.png',  { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-attack2',  '/assets/MadKing/Attack2.png',  { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-attack3',  '/assets/MadKing/Attack3.png',  { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-take-hit', '/assets/MadKing/Take Hit.png', { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-death',    '/assets/MadKing/Death.png',    { frameWidth: 160, frameHeight: 111 });

    // Audio
    this.load.audio('music-dungeon', '/assets/Audio/Main-Dungeon-Theme.ogg');
    this.load.audio('music-shop',    '/assets/Audio/Music-Shop.ogg');
    this.load.audio('music-victory', '/assets/Audio/Victory-track.ogg');
    this.load.audio('music-lose',    '/assets/Audio/Losing-Track.ogg');
    this.load.audio('sfx-rare-drop',       '/assets/Audio/Rare-Item-Drop.ogg');
    this.load.audio('sfx-darkmage-attack', '/assets/Audio/Enemy-Sounds/DarkMage-Attack.ogg');
    this.load.audio('sfx-golem-hit',       '/assets/Audio/Enemy-Sounds/Golem-Hit.ogg');
    this.load.audio('sfx-golem-walk',      '/assets/Audio/Enemy-Sounds/Golem-Walk-Sound.ogg');
    this.load.audio('sfx-golem-attack',    '/assets/Audio/Enemy-Sounds/Golem-Attack.ogg');
    this.load.audio('sfx-golem-death',     '/assets/Audio/Enemy-Sounds/Golem-Death.ogg');
  }

  // ── Phaser lifecycle: create ───────────────────────────────────────────────

  private loadVolumeSettings() {
    try {
      const raw = localStorage.getItem('hd_settings');
      if (raw) {
        const s = JSON.parse(raw);
        this.masterVol = (s.masterVolume ?? 80) / 100;
        this.musicVol  = (s.musicVolume  ?? 70) / 100;
        this.sfxVol    = (s.sfxVolume    ?? 80) / 100;
      }
    } catch { /* ignore corrupt settings */ }
  }

  private playMusic(key: string) {
    if (this.bgMusic && (this.bgMusic as Phaser.Sound.WebAudioSound).isPlaying && this.bgMusic.key === key) return;
    this.bgMusic?.stop();
    this.bgMusic?.destroy();
    this.bgMusic = this.sound.add(key, { loop: true, volume: this.masterVol * this.musicVol });
    (this.bgMusic as Phaser.Sound.WebAudioSound).play();
  }

  private playSfx(key: string) {
    this.sound.play(key, { volume: this.masterVol * this.sfxVol });
  }

  create() {
    this.loadVolumeSettings();
    this.renderBackground('bg-entrance-hall');
    this.createWarriorAnims();
    this.createWizardAnims();
    this.createArcherAnims();
    this.createDarkMageAnims();
    this.createGolemAnims();
    this.createGoblinAnims();
    this.createSkeletonAnims();
    this.createBatAnims();
    this.createSlimeAnims();
    this.createMushroomAnims();
    this.createMimicAnims();
    this.createMadKingAnims();
    this.createChestAnims();
    this.createShopAnims();

    this.hpBars      = this.add.graphics().setDepth(20);
    this.aimGraphics = this.add.graphics().setDepth(6);

    // Placeholder sprite — invisible until class is known so no wrong-class flash.
    this.mySprite = this.add.sprite(REGION_W / 2, REGION_H / 2, 'warrior-idle', 0)
      .setDepth(10)
      .setScale(0.5)
      .setAlpha(0);

    this.myLabel = this.add.text(REGION_W / 2, REGION_H / 2 - 45, '', {
      fontFamily: 'Courier New', fontSize: '10px', color: '#ffffff',
    }).setOrigin(0.5, 1).setDepth(11);

    this.cameras.main.startFollow(this.mySprite);
    this.cameras.main.setBounds(0, 0, this.levelWidth, this.levelHeight);

    const kb = this.input.keyboard!;

    // ── Register keys ───────────────────────────────────────────────────────
    // addKey() creates a Key object that tracks up/down/just-pressed state each frame.
    this.kW     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);     // W     — move UP
    this.kA     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);     // A     — move LEFT
    this.kS     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);     // S     — move DOWN
    this.kD     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);     // D     — move RIGHT
    this.kSpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE); // SPACE — basic attack toward mouse cursor
    this.kQ     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);     // Q     — class ability

    // ── Capture keys from the browser ───────────────────────────────────────
    // Without capture, the browser handles these keys before Phaser does:
    //   W / S  → scroll the page up/down
    //   SPACE  → jump the page scroll to the bottom
    //   Q      → no browser default, but captured for consistency
    // addCapture() stops that default behaviour so only Phaser receives them.
    kb.addCapture([
      Phaser.Input.Keyboard.KeyCodes.W,      // captured — browser would scroll up
      Phaser.Input.Keyboard.KeyCodes.A,      // captured — no browser default, safe
      Phaser.Input.Keyboard.KeyCodes.S,      // captured — browser would scroll down
      Phaser.Input.Keyboard.KeyCodes.D,      // captured — no browser default, safe
      Phaser.Input.Keyboard.KeyCodes.SPACE,  // captured — browser would scroll to bottom
      Phaser.Input.Keyboard.KeyCodes.Q,      // captured — no browser default, safe
    ]);

    this.game.events.on('setEngine',    (e: GameEngine) => { this.engine = e; });
    this.game.events.on('setUserId',    (id: string)    => {
      this.myUserId = id;
      if (this.state) this.applyState(this.state);
    });
    this.game.events.on('setUsername',  (n: string)     => {
      this.myUsername = n;
      this.myLabel.setText(n);
    });
    // heroClass is sent by GamePage right after sceneReady fires so the sprite
    // is visible from the very first update() tick, without waiting for server state.
    this.game.events.on('setHeroClass', (hc: string)    => {
      if (hc && this.myHeroClass !== hc) {
        this.myHeroClass = hc;
        this.initPlayerSprite(hc);
      }
    });
    this.game.events.on('stateUpdate',  (s: GameState)  => { this.syncProjectiles(s); this.applyState(s); });

    this.game.canvas.setAttribute('tabindex', '0');
    this.game.canvas.focus();

    // Tell GamePage that create() is done and all listeners are live.
    this.game.events.emit('sceneReady');

    this.playMusic('music-dungeon');
  }

  // ── Animation setup ────────────────────────────────────────────────────────

  private createWarriorAnims() {
    const a = this.anims;
    a.create({ key: 'warrior-idle',     frames: a.generateFrameNumbers('warrior-idle',     { start: 0, end: 10 }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'warrior-run',      frames: a.generateFrameNumbers('warrior-run',      { start: 0, end: 7  }), frameRate: 10, repeat: -1 });
    a.create({ key: 'warrior-jump',     frames: a.generateFrameNumbers('warrior-jump',     { start: 0, end: 3  }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'warrior-fall',     frames: a.generateFrameNumbers('warrior-fall',     { start: 0, end: 3  }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'warrior-dash',     frames: a.generateFrameNumbers('warrior-dash',     { start: 0, end: 3  }), frameRate: 12, repeat: 0  });
    a.create({ key: 'warrior-attack',   frames: a.generateFrameNumbers('warrior-attack',   { start: 0, end: 5  }), frameRate: 12, repeat: 0  });
    a.create({ key: 'warrior-take-hit', frames: a.generateFrameNumbers('warrior-take-hit', { start: 0, end: 3  }), frameRate: 10, repeat: 0  });
    a.create({ key: 'warrior-death',    frames: a.generateFrameNumbers('warrior-death',    { start: 0, end: 8  }), frameRate: 8,  repeat: 0  });
  }

  private createWizardAnims() {
    const a = this.anims;
    a.create({ key: 'wizard-idle',    frames: a.generateFrameNumbers('wizard-idle',    { start: 0, end: 5 }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'wizard-run',     frames: a.generateFrameNumbers('wizard-run',     { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
    a.create({ key: 'wizard-jump',    frames: a.generateFrameNumbers('wizard-jump',    { start: 0, end: 1 }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'wizard-fall',    frames: a.generateFrameNumbers('wizard-fall',    { start: 0, end: 1 }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'wizard-attack1', frames: a.generateFrameNumbers('wizard-attack1', { start: 0, end: 7 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'wizard-attack2', frames: a.generateFrameNumbers('wizard-attack2', { start: 0, end: 7 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'wizard-hit',     frames: a.generateFrameNumbers('wizard-hit',     { start: 0, end: 3 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'wizard-death',   frames: a.generateFrameNumbers('wizard-death',   { start: 0, end: 6 }), frameRate: 8,  repeat: 0  });
  }

  private createArcherAnims() {
    const a = this.anims;
    a.create({ key: 'archer-idle',    frames: a.generateFrameNumbers('archer-idle',    { start: 0, end: 9 }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'archer-run',     frames: a.generateFrameNumbers('archer-run',     { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
    a.create({ key: 'archer-jump',    frames: a.generateFrameNumbers('archer-jump',    { start: 0, end: 1 }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'archer-fall',    frames: a.generateFrameNumbers('archer-fall',    { start: 0, end: 1 }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'archer-attack',  frames: a.generateFrameNumbers('archer-attack',  { start: 0, end: 5 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'archer-get-hit', frames: a.generateFrameNumbers('archer-get-hit', { start: 0, end: 2 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'archer-death',   frames: a.generateFrameNumbers('archer-death',   { start: 0, end: 9 }), frameRate: 8,  repeat: 0  });
  }

  private createDarkMageAnims() {
    const a = this.anims;
    a.create({ key: 'boss-idle',     frames: a.generateFrameNumbers('boss-idle',     { start: 0, end: 7 }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'boss-run',      frames: a.generateFrameNumbers('boss-run',      { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
    a.create({ key: 'boss-attack',   frames: a.generateFrameNumbers('boss-attack',   { start: 0, end: 7 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'boss-take-hit', frames: a.generateFrameNumbers('boss-take-hit', { start: 0, end: 2 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'boss-death',    frames: a.generateFrameNumbers('boss-death',    { start: 0, end: 6 }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'boss-jump',     frames: a.generateFrameNumbers('boss-jump',     { start: 0, end: 1 }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'boss-fall',     frames: a.generateFrameNumbers('boss-fall',     { start: 0, end: 1 }), frameRate: 8,  repeat: 0  });
    // Purple fireball — row 1 of the shared sheet (frames 4–7)
    a.create({ key: 'boss-fireball', frames: a.generateFrameNumbers('boss-fireball', { start: 4, end: 7 }), frameRate: 10, repeat: -1 });
  }

  private createGolemAnims() {
    const a = this.anims;
    // Character_sheet.png is a 10×10 grid of 100×100 frames.
    // Row index N starts at frame N*10.
    //   Row 0 (frames  0– 3): Idle loop — stone golem breathing/glowing
    //   Row 1 (frames 10–17): Walk — heavy plodding movement
    //   Row 2 (frames 20–28): Attack — arm-slam or punch animation
    //   Row 3 (frames 30–37): Hit stagger — recoils when damaged
    //   Row 8 (frames 80–83): Death — crumbles to the ground
    a.create({ key: 'golem-idle',     frames: a.generateFrameNumbers('golem-sheet', { start:  0, end:  3 }), frameRate: 6,  repeat: -1 });
    a.create({ key: 'golem-run',      frames: a.generateFrameNumbers('golem-sheet', { start: 10, end: 17 }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'golem-attack',   frames: a.generateFrameNumbers('golem-sheet', { start: 20, end: 28 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'golem-take-hit', frames: a.generateFrameNumbers('golem-sheet', { start: 30, end: 37 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'golem-death',    frames: a.generateFrameNumbers('golem-sheet', { start: 80, end: 83 }), frameRate: 8,  repeat: 0  });
    // Glowing arm projectile — arm_projectile_glowing.png is a 3×3 grid of 100×100 frames (0–8)
    a.create({ key: 'golem-projectile', frames: a.generateFrameNumbers('golem-projectile', { start: 0, end: 8 }), frameRate: 10, repeat: -1 });
    // Laser charge wind-up — orb growing (frames 0–7, loops while chargePercent is rising)
    a.create({ key: 'golem-laser-charge', frames: a.generateFrameNumbers('golem-laser', { start: 0, end: 7 }), frameRate: 8, repeat: -1 });
    // Laser beam fire — full beam extending (frames 8–14, play once when the shot lands)
    a.create({ key: 'golem-laser-fire', frames: a.generateFrameNumbers('golem-laser', { start: 8, end: 14 }), frameRate: 12, repeat: 0 });
  }

  private createGoblinAnims() {
    const a = this.anims;
    a.create({ key: 'goblin-attack', frames: a.generateFrameNumbers('goblin-attack', { start: 0, end: 11 }), frameRate: 10, repeat: 0 });
    a.create({ key: 'goblin-bomb',   frames: a.generateFrameNumbers('goblin-bomb',   { start: 0, end: 18 }), frameRate: 14, repeat: 0  });
  }

  private createSkeletonAnims() {
    const a = this.anims;
    a.create({ key: 'skeleton-attack', frames: a.generateFrameNumbers('skeleton-attack', { start: 0, end: 5 }), frameRate: 10, repeat: 0 });
    a.create({ key: 'skeleton-sword',  frames: a.generateFrameNumbers('skeleton-sword',  { start: 0, end: 7 }), frameRate: 16, repeat: -1 });
  }

  private createBatAnims() {
    const a = this.anims;
    a.create({ key: 'bat-fly',         frames: a.generateFrameNumbers('bat-fly',         { start: 0, end: 10 }), frameRate: 10, repeat: -1 });
    a.create({ key: 'bat-attack',      frames: a.generateFrameNumbers('bat-attack',      { start: 0, end: 10 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'bat-hurt',        frames: a.generateFrameNumbers('bat-hurt',        { start: 0, end: 2  }), frameRate: 10, repeat: 0  });
    a.create({ key: 'bat-fly-to-fall', frames: a.generateFrameNumbers('bat-fly-to-fall', { start: 0, end: 2  }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'bat-fall',        frames: a.generateFrameNumbers('bat-fall',        { start: 0, end: 4  }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'bat-death',       frames: a.generateFrameNumbers('bat-death',       { start: 0, end: 3  }), frameRate: 8,  repeat: 0  });
  }

  private createSlimeAnims() {
    const a = this.anims;
    a.create({ key: 'slime-idle',   frames: a.generateFrameNumbers('slime-idle',   { start: 0, end: 13 }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'slime-walk',   frames: a.generateFrameNumbers('slime-walk',   { start: 0, end: 5  }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'slime-attack', frames: a.generateFrameNumbers('slime-attack', { start: 0, end: 18 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'slime-hurt',   frames: a.generateFrameNumbers('slime-hurt',   { start: 0, end: 2  }), frameRate: 10, repeat: 0  });
    a.create({ key: 'slime-death',  frames: a.generateFrameNumbers('slime-death',  { start: 0, end: 10 }), frameRate: 8,  repeat: 0  });
  }

  private createMushroomAnims() {
    const a = this.anims;
    a.create({ key: 'mushroom-attack',     frames: a.generateFrameNumbers('mushroom-attack',     { start: 0, end: 10 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'mushroom-projectile', frames: a.generateFrameNumbers('mushroom-projectile', { start: 0, end: 7  }), frameRate: 12, repeat: -1 });
  }

  private createMimicAnims() {
    const a = this.anims;
    a.create({ key: 'mimic-idle-closed',     frames: a.generateFrameNumbers('mimic-idle-closed',     { start: 0, end: 0  }), frameRate: 1,  repeat: -1 });
    a.create({ key: 'mimic-opening',          frames: a.generateFrameNumbers('mimic-opening',          { start: 0, end: 5  }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'mimic-idle-open',        frames: a.generateFrameNumbers('mimic-idle-open',        { start: 0, end: 0  }), frameRate: 1,  repeat: -1 });
    a.create({ key: 'mimic-transform',        frames: a.generateFrameNumbers('mimic-transform',        { start: 0, end: 6  }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'mimic-idle-transformed', frames: a.generateFrameNumbers('mimic-idle-transformed', { start: 0, end: 8  }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'mimic-walk',             frames: a.generateFrameNumbers('mimic-walk',             { start: 0, end: 5  }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'mimic-attack-1',         frames: a.generateFrameNumbers('mimic-attack-1',         { start: 0, end: 13 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'mimic-attack-2',         frames: a.generateFrameNumbers('mimic-attack-2',         { start: 0, end: 12 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'mimic-hurt',             frames: a.generateFrameNumbers('mimic-hurt',             { start: 0, end: 2  }), frameRate: 10, repeat: 0  });
    a.create({ key: 'mimic-death',            frames: a.generateFrameNumbers('mimic-death',            { start: 0, end: 5  }), frameRate: 8,  repeat: 0  });
  }

  private createChestAnims() {
    const a = this.anims;
    // 8 frames of 36×50 in a single row; frames 0–5 go from closed to fully open (peak interior visible).
    // Frames 6–7 are the lid settling flat, so we stop at 5 to keep the chest looking open.
    a.create({ key: 'chest-open', frames: a.generateFrameNumbers('chest-sheet', { start: 0, end: 5 }), frameRate: 10, repeat: 0 });
  }

  private createMadKingAnims() {
    const a = this.anims;
    a.create({ key: 'madking-idle',     frames: a.generateFrameNumbers('madking-idle',     { start: 0, end: 7 }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'madking-run',      frames: a.generateFrameNumbers('madking-run',      { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
    a.create({ key: 'madking-attack1',  frames: a.generateFrameNumbers('madking-attack1',  { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
    a.create({ key: 'madking-attack2',  frames: a.generateFrameNumbers('madking-attack2',  { start: 0, end: 3 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'madking-attack3',  frames: a.generateFrameNumbers('madking-attack3',  { start: 0, end: 3 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'madking-take-hit', frames: a.generateFrameNumbers('madking-take-hit', { start: 0, end: 3 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'madking-death',    frames: a.generateFrameNumbers('madking-death',    { start: 0, end: 5 }), frameRate: 8,  repeat: 0  });
  }

  private initPlayerSprite(heroClass: string) {
    this.mySprite.anims.stop();
    this.currentAnimKey = '';

    const prefix = heroClass.toLowerCase();
    const scale  = CLASS_SCALE[heroClass] ?? 0.5;
    this.mySprite.setTexture(`${prefix}-idle`, 0).setScale(scale).setAlpha(1);
    this.playAnim(`${prefix}-idle`);
  }

  private playAnim(key: string) {
    if (this.currentAnimKey === key) return;
    this.currentAnimKey = key;
    this.mySprite.play(key);
  }

  // ── Phaser lifecycle: update ───────────────────────────────────────────────

  update(_time: number, delta: number) {
    this.move(delta);
    this.sendPos(_time);
    this.handleInput();
    this.drawHpBars();
    this.drawAim();
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  private move(delta: number) {
    // Convert speed from px/sec to px/frame using the actual elapsed time.
    const s = this.SPEED * (delta / 1000);
    let dx = 0, dy = 0;
    if (this.kW.isDown) dy -= s; // W → move up
    if (this.kS.isDown) dy += s; // S → move down
    if (this.kA.isDown) dx -= s; // A → move left
    if (this.kD.isDown) dx += s; // D → move right

    // Diagonal movement would be faster (√2 ≈ 1.41×) without this normalisation.
    // Multiplying by 0.707 (1/√2) keeps diagonal speed equal to cardinal speed.
    if (dx && dy) { dx *= 0.707; dy *= 0.707; }

    const pad  = 32;
    const newX = Phaser.Math.Clamp(this.localX + dx, pad, this.levelWidth  - pad);
    const newY = Phaser.Math.Clamp(this.localY + dy, pad, this.levelHeight - pad);

    // Hazard collision — try full move, then axis-only fallbacks.
    if (!this.inHazard(newX, newY)) {
      this.localX = newX;
      this.localY = newY;
    } else if (!this.inHazard(newX, this.localY)) {
      this.localX = newX;
    } else if (!this.inHazard(this.localX, newY)) {
      this.localY = newY;
    }
    // else: both axes blocked — position unchanged.

    this.mySprite.setPosition(this.localX, this.localY);
    const labelY = this.localY - this.mySprite.displayHeight / 2 - 10;
    this.myLabel.setPosition(this.localX, labelY);

    if (this.myHeroClass) {
      if (dx < 0) this.mySprite.setFlipX(true);
      else if (dx > 0) this.mySprite.setFlipX(false);

      if (!LOCKED_ANIMS.has(this.currentAnimKey)) {
        const moving = dx !== 0 || dy !== 0;
        const prefix = this.myHeroClass.toLowerCase();
        this.playAnim(moving ? `${prefix}-run` : `${prefix}-idle`);
      }
    }
  }

  // Returns true if the point (x, y) lies inside any hazard zone for the current room.
  private inHazard(x: number, y: number): boolean {
    return this.currentHazards.some(h => x > h.x1 && x < h.x2 && y > h.y1 && y < h.y2);
  }

  private sendPos(time: number) {
    if (time - this.lastPosSent > 50 && this.engine) {
      this.engine.sendPosition(this.localX, this.localY);
      this.lastPosSent = time;
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private handleInput() {
    if (!this.engine || !this.state || !this.myHeroClass) return;

    // ── SPACE — Basic attack ────────────────────────────────────────────────
    // JustDown fires once per key-press (not while held), preventing attack spam.
    // The direction vector (nx, ny) points from the player toward the mouse cursor
    // so the attack always goes where the player is aiming.
    //   Warrior  → cone melee hit (attackNearest); direction used for the flash VFX only
    //   Archer   → directional arrow ray-cast (attackDirectional)
    //   Wizard   → directional magic bolt ray-cast (attackDirectional)
    if (Phaser.Input.Keyboard.JustDown(this.kSpace)) {
      const me = this.state.players.find(p => p.userId === this.myUserId);
      const cooldownMs = me?.attackCooldownMs ?? 2000; // per-hero cooldown from server
      const now = Date.now();
      if (now - this.lastAttackTime < cooldownMs) return; // still on cooldown — ignore

      const ptr = this.input.activePointer;
      const dx = ptr.worldX - this.localX;
      const dy = ptr.worldY - this.localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Normalise to a unit direction vector; default to "up" if cursor is on the player.
      const nx = dist > 0 ? dx / dist : 0;
      const ny = dist > 0 ? dy / dist : -1;

      if (this.myHeroClass === 'Warrior') {
        // Warrior uses nearest-enemy melee — direction only drives the swing VFX.
        this.lastAttackTime = now;
        this.engine.attackNearest();
        this.flashAttack(nx, ny, ATTACK_RANGE);
      } else if (dist > 0) {
        // Archer / Wizard fire a directional skillshot along the mouse aim line.
        const maxRange = CLASS_RANGE[this.myHeroClass] ?? ATTACK_RANGE;
        this.lastAttackTime = now;
        this.engine.attackDirectional(nx, ny);
        this.flashAttack(nx, ny, Math.min(dist, maxRange));
      }
    }

    // ── Q — Class ability ───────────────────────────────────────────────────
    // Each hero class has a unique ability triggered by Q:
    //   Warrior  → Undying Rage   — become untargetable for 5 s (no aim needed)
    //   Wizard   → Fireball       — aimed single-target blast with area splash
    //   Archer   → Multi-Shot     — fires 3 arrows in a ±15° spread from the aim direction
    // canUseAbility is checked server-side too; the client check just avoids a wasted round-trip.
    if (Phaser.Input.Keyboard.JustDown(this.kQ)) {
      const me = this.state.players.find(p => p.userId === this.myUserId);
      if (!me?.canUseAbility) return; // ability not ready (resource too low or on cooldown)
      const ptr = this.input.activePointer;
      const dx = ptr.worldX - this.localX;
      const dy = ptr.worldY - this.localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Aim direction sent with the ability; ignored server-side for Warrior.
      const nx = dist > 0 ? dx / dist : 0;
      const ny = dist > 0 ? dy / dist : -1;
      this.engine.useAbility(nx, ny);
      this.flashAbility(nx, ny);
    }
  }

  // ── State sync ─────────────────────────────────────────────────────────────

  private applyState(s: GameState) {
    if (s.currentRoomIndex !== this.lastRoomIndex) {
      this.lastRoomIndex = s.currentRoomIndex;
      this.clearEnemies();
      this.destroyChest();
      this.clearProjectiles();  // discard any fireballs still in flight from the previous room
      this.clearFlameWaves();   // discard any flame waves from the previous room
      this.clearRoomVisuals();
      this.renderBackground(this.backgroundKeyForRoom(s.currentRoomIndex, s.currentRoom.type));
      this.showRoomBanner(s.currentRoomIndex, s.currentRoom.type);
      if (s.currentRoom.type === 'ExitHall') {
        this.spawnShopNpcs();
        this.playMusic('music-shop');
      } else {
        this.playMusic('music-dungeon');
      }
      this.prevPlayerHp.clear();
      const me = s.players.find(p => p.userId === this.myUserId);
      if (me) { this.localX = me.x; this.localY = me.y; }
    }

    this.showEnemyAttacks(s);
    this.showFlameWaves(s);
    this.state = s;

    if (this.myUserId) this.destroyOther(this.myUserId);

    // ── Local player ──
    const me = s.players.find(p => p.userId === this.myUserId);
    if (me) {
      const prevClass = this.myHeroClass;
      this.myHeroClass = me.heroClass;

      if (this.myHeroClass && this.myHeroClass !== prevClass) {
        this.initPlayerSprite(this.myHeroClass);
      }

      const prefix  = this.myHeroClass.toLowerCase();
      const hitKey  = this.myHeroClass === 'Archer' ? 'archer-get-hit'
                    : this.myHeroClass === 'Wizard'  ? 'wizard-hit'
                    : 'warrior-take-hit';
      const deathKey = `${prefix}-death`;

      if (!me.isAlive) {
        if (this.currentAnimKey !== deathKey) {
          this.currentAnimKey = deathKey;
          this.mySprite.play(deathKey);
          this.playMusic('music-lose');
        }
        this.mySprite.setAlpha(0.7);
      } else {
        if (!this.prevMeAlive) {
          // Respawned — resume appropriate background music.
          const inShop = s.currentRoom.type === 'ExitHall';
          this.playMusic(inShop ? 'music-shop' : 'music-dungeon');
        }
        this.mySprite.setAlpha(1);
        if (this.prevMyHp > 0 && me.currentHp < this.prevMyHp && !LOCKED_ANIMS.has(this.currentAnimKey)) {
          this.currentAnimKey = hitKey;
          this.mySprite.play(hitKey);
          this.mySprite.once('animationcomplete', () => {
            if (this.currentAnimKey === hitKey) {
              const moving = this.kW.isDown || this.kS.isDown || this.kA.isDown || this.kD.isDown;
              this.playAnim(moving ? `${prefix}-run` : `${prefix}-idle`);
            }
          });
        }
      }
      this.prevMyHp    = me.currentHp;
      this.prevMeAlive = me.isAlive;
    }

    // ── Other players ──
    const myId = this.myUserId;
    for (const p of s.players) {
      if (p.userId !== myId) this.syncOther(p);
    }
    for (const [id] of this.others) {
      if (!s.players.some(p => p.userId === id) || id === myId) this.destroyOther(id);
    }

    // ── Enemies ──
    for (const e of s.currentRoom.enemies) this.syncEnemy(e, s.players);
    for (const [id] of this.enemySprites) {
      if (!s.currentRoom.enemies.some(e => e.id === id)) this.destroyEnemy(id);
    }

    this.syncChest(s.currentRoom, me);
  }

  // ── Other-player sprites ───────────────────────────────────────────────────

  private syncOther(p: PlayerState) {
    if (p.userId === this.myUserId) return;

    let sp = this.others.get(p.userId);

    if (!sp) {
      const prefix = p.heroClass.toLowerCase();
      const scale  = CLASS_SCALE[p.heroClass] ?? 0.5;
      const sprite = this.add.sprite(p.x, p.y, `${prefix}-idle`, 0)
        .setDepth(9)
        .setScale(scale)
        .setAlpha(0.9);
      sprite.play(`${prefix}-idle`);

      const label = this.add.text(p.x, p.y - 45, p.username, {
        fontFamily: 'Courier New', fontSize: '10px', color: '#cccccc',
      }).setOrigin(0.5, 1).setDepth(10);

      sp = {
        sprite, label,
        heroClass: p.heroClass,
        animKey:   `${prefix}-idle`,
        prevX: p.x, prevY: p.y,
        dead:  false,
      };
      this.others.set(p.userId, sp);
    }

    if (!p.isAlive && !sp.dead) {
      sp.dead = true;
      const deathKey = `${sp.heroClass.toLowerCase()}-death`;
      sp.animKey = deathKey;
      sp.sprite.play(deathKey);
      sp.sprite.once('animationcomplete', () => { sp!.sprite.setAlpha(0.3); });
      sp.label.setAlpha(0.3);

    } else if (p.isAlive) {
      sp.sprite.setPosition(p.x, p.y).setAlpha(0.9);
      const labelY = p.y - sp.sprite.displayHeight / 2 - 10;
      sp.label.setPosition(p.x, labelY).setAlpha(1);

      const mdx = p.x - sp.prevX;
      if (mdx < -1)      sp.sprite.setFlipX(true);
      else if (mdx > 1)  sp.sprite.setFlipX(false);

      if (!sp.dead) {
        const moving  = Math.abs(p.x - sp.prevX) > 1 || Math.abs(p.y - sp.prevY) > 1;
        const prefix  = sp.heroClass.toLowerCase();
        const wantKey = moving ? `${prefix}-run` : `${prefix}-idle`;
        if (sp.animKey !== wantKey) {
          sp.animKey = wantKey;
          sp.sprite.play(wantKey);
        }
      }
    }

    sp.prevX = p.x;
    sp.prevY = p.y;
  }

  // ── Enemy sprites ──────────────────────────────────────────────────────────

  private syncEnemy(e: EnemyState, players: PlayerState[]) {
    let sp = this.enemySprites.get(e.id);

    if (!sp) {
      let isNewMimic = false;
      if (e.name === 'Dark Mage') {
        // Dark Mage boss — animated sprite, 240 px rendered (scale 0.96 on 250 px frames)
        const spr = this.add.sprite(e.x, e.y, 'boss-idle', 0).setDepth(8).setScale(0.96);
        spr.play('boss-idle');
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 22, 'Dark Mage', {
          fontFamily: 'Courier New', fontSize: '10px', color: '#ffffff',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: 'boss-idle', wasFiring: false };

      } else if (e.name === 'Golem') {
        // Golem Elite MiniBoss — animated sprite using Character_sheet.png (100×100 frames)
        // Scale 1.4 renders the Golem at ~140 px tall, slightly bigger than regular enemies.
        const spr = this.add.sprite(e.x, e.y, 'golem-sheet', 0).setDepth(8).setScale(1.4);
        spr.play('golem-idle');
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 10, 'Golem', {
          fontFamily: 'Courier New', fontSize: '10px', color: '#aabbcc',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: 'golem-idle', wasFiring: false };

      } else if (e.name === 'Goblin') {
        const spr = this.add.sprite(e.x, e.y, 'goblin-attack', 0).setDepth(8).setScale(0.95);
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 6, 'Goblin', {
          fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: '', wasFiring: false };

      } else if (e.name === 'Skeleton') {
        const spr = this.add.sprite(e.x, e.y, 'skeleton-attack', 0).setDepth(8).setScale(0.95);
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 6, 'Skeleton', {
          fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: '', wasFiring: false };

      } else if (e.name === 'Bat') {
        const spr = this.add.sprite(e.x, e.y, 'bat-fly', 0).setDepth(8).setScale(1.3);
        spr.play('bat-fly');
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 6, 'Bat', {
          fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: 'bat-fly', wasFiring: false };

      } else if (e.name === 'Slime') {
        const spr = this.add.sprite(e.x, e.y, 'slime-idle', 0).setDepth(8).setScale(1.1);
        spr.play('slime-idle');
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 6, 'Slime', {
          fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: 'slime-idle', wasFiring: false };

      } else if (e.name === 'Mushroom') {
        const spr = this.add.sprite(e.x, e.y, 'mushroom-attack', 0).setDepth(8).setScale(1.0);
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 6, 'Mushroom', {
          fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: '', wasFiring: false };

      } else if (e.name === 'Mimic') {
        const spr = this.add.sprite(e.x, e.y, 'mimic-idle-closed', 0).setDepth(8).setScale(1.1);
        spr.play('mimic-idle-closed');
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 6, '???', {
          fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: 'mimic-idle-closed', wasFiring: false };
        isNewMimic = true;

      } else if (e.name === 'Mad King') {
        const spr = this.add.sprite(e.x, e.y, 'madking-idle', 0).setDepth(8).setScale(1.3);
        spr.play('madking-idle');
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 14, 'Mad King', {
          fontFamily: 'Courier New', fontSize: '10px', color: '#e8b4b8',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, chargeSprite: null, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: 'madking-idle', wasFiring: false };

      } else {
        // Regular enemies (Skeleton, Goblin, Spider) — coloured rectangle
        const size  = 28;
        const col   = ENEMY_COLOR[e.name] ?? 0xff4444;
        const body  = this.add.rectangle(e.x, e.y, size, size, col).setDepth(8);
        const label = this.add.text(e.x, e.y - (size / 2 + 6), e.name, {
          fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body, sprite: null, chargeSprite: null, label, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: '', wasFiring: false };
      }
      this.enemySprites.set(e.id, sp);
      if (isNewMimic) this.startMimicReveal(sp!);
    }

    // ── Death ──
    if (!e.isAlive && !sp.dead) {
      sp.dead = true;
      // Destroy any active charge orb when the Golem dies.
      sp.chargeSprite?.destroy();
      sp.chargeSprite = null;
      sp.label?.setAlpha(0);
      if (e.name === 'Golem' && sp.sprite) {
        sp.animKey = 'golem-death';
        sp.sprite.play('golem-death');
        this.playSfx('sfx-golem-death');
      }

      if (e.name === 'Dark Mage' && sp.sprite) {
        sp.animKey = 'boss-death';
        sp.sprite.play('boss-death');
        this.playMusic('music-victory');
        sp.sprite.once('animationcomplete', () => {
          this.tweens.add({ targets: sp!.sprite, alpha: 0, duration: 500, onComplete: () => sp!.sprite?.setVisible(false) });
        });

      } else if (e.name === 'Bat' && sp.sprite) {
        sp.animKey = 'bat-fly-to-fall';
        sp.sprite.play('bat-fly-to-fall');
        sp.sprite.once('animationcomplete', () => {
          sp!.animKey = 'bat-fall';
          sp!.sprite?.play('bat-fall');
          sp!.sprite?.once('animationcomplete', () => {
            this.tweens.add({ targets: sp!.sprite, alpha: 0, duration: 300, onComplete: () => sp!.sprite?.setVisible(false) });
          });
        });

      } else if (e.name === 'Slime' && sp.sprite) {
        sp.animKey = 'slime-death';
        sp.sprite.play('slime-death');
        sp.sprite.once('animationcomplete', () => {
          this.tweens.add({ targets: sp!.sprite, alpha: 0, duration: 300, onComplete: () => sp!.sprite?.setVisible(false) });
        });

      } else if (e.name === 'Mimic' && sp.sprite) {
        sp.animKey = 'mimic-death';
        sp.sprite.play('mimic-death');
        sp.sprite.once('animationcomplete', () => {
          this.tweens.add({ targets: sp!.sprite, alpha: 0, duration: 300, onComplete: () => sp!.sprite?.setVisible(false) });
        });

      } else if (e.name === 'Mad King' && sp.sprite) {
        sp.animKey = 'madking-death';
        sp.sprite.play('madking-death');
        sp.sprite.once('animationcomplete', () => {
          this.tweens.add({ targets: sp!.sprite, alpha: 0, duration: 500, onComplete: () => sp!.sprite?.setVisible(false) });
        });

      } else if (sp.sprite) {
        // Goblin / Skeleton / Mushroom: fade out (no dedicated death animation provided)
        this.tweens.add({
          targets: sp.sprite, alpha: 0, duration: 400,
          onComplete: () => sp!.sprite?.setVisible(false),
        });

      } else if (sp.body) {
        this.tweens.add({
          targets: [sp.body, sp.label],
          alpha: 0, angle: 90, duration: 350,
          onComplete: () => { sp!.body?.setVisible(false); sp!.label?.setVisible(false); },
        });
      }

    // ── Alive: update position and animations ──
    } else if (e.isAlive) {
      if (sp.sprite) {
        // Pick animation keys based on whether this is the Golem or the Dark Mage.
        const isGolem   = e.name === 'Golem';
        const idleKey   = isGolem ? 'golem-idle'     : 'boss-idle';
        const runKey    = isGolem ? 'golem-run'      : 'boss-run';
        const hitKey    = isGolem ? 'golem-take-hit' : 'boss-take-hit';
        const attackKey = isGolem ? 'golem-attack'   : 'boss-attack';
        const deathKey  = isGolem ? 'golem-death'    : 'boss-death';
        const labelOffsetY = isGolem ? 10 : 22;

        sp.sprite.setPosition(e.x, e.y);
        sp.label?.setPosition(e.x, e.y - sp.sprite.displayHeight / 2 - labelOffsetY);

        // ── Golem laser charge visual ──────────────────────────────────────────
        if (isGolem) {
          // Beam rotation angle — always computed from the server-locked direction vector.
          // atan2(laserDirY, laserDirX) gives the exact angle the server aimed at charge start.
          const beamAngle = Math.atan2(e.laserDirY, e.laserDirX);

          if (e.chargePercent > 0) {
            // Charging — show the growing orb sprite in front of the Golem.
            // Origin (0, 0.5) puts the orb (left side of the frame) at the Golem's center;
            // setRotation aims it toward the locked-in target direction.
            if (!sp.chargeSprite) {
              const cs = this.add.sprite(e.x, e.y, 'golem-laser', 0)
                .setDepth(16)
                .setOrigin(0, 0.5)
                .setScale(1.0)
                .setRotation(beamAngle);
              cs.play('golem-laser-charge');
              sp.chargeSprite = cs;
            } else {
              // Update position and aim each tick while charging (direction stays fixed).
              sp.chargeSprite.setPosition(e.x, e.y).setRotation(beamAngle);
            }
            // Keep the Golem body in idle during charge (it's winding up, not running).
            if (sp.animKey !== idleKey && sp.animKey !== hitKey && sp.animKey !== deathKey) {
              sp.animKey = idleKey;
              sp.sprite.play(idleKey);
            }
          } else if (sp.chargeSprite) {
            // Charge ended (fired or cancelled) — remove the charge orb sprite.
            sp.chargeSprite.destroy();
            sp.chargeSprite = null;
          }

          // ── Laser beam fire visual ─────────────────────────────────────────────
          // Detect the first tick where isLaserFiring flips from false → true.
          // Spawn a beam sprite that plays golem-laser-fire, rotated to the aim direction.
          if (e.isLaserFiring && !sp.wasFiring) {
            const beam = this.add.sprite(e.x, e.y, 'golem-laser', 8)
              .setDepth(17)
              .setOrigin(0, 0.5)   // anchor at left edge — orb at Golem center, beam extends out
              .setScale(1.5)       // 450 px long rendered beam
              .setRotation(beamAngle);  // aim exactly where the server was pointing
            beam.play('golem-laser-fire');
            beam.once('animationcomplete', () => beam.destroy());
            // Brief screen flash so players feel the laser impact.
            this.cameras.main.flash(200, 0, 200, 255, false);
            this.playSfx('sfx-golem-attack');
          }
          sp.wasFiring = e.isLaserFiring;
        }

        // Flip horizontally so the enemy always faces the direction it's moving.
        const mdx = e.x - sp.prevX;
        if (mdx < -1)     sp.sprite.setFlipX(true);
        else if (mdx > 1) sp.sprite.setFlipX(false);

        if (isGolem) {
          const charging = e.chargePercent > 0;
          const locked = sp.animKey === hitKey || sp.animKey === deathKey || sp.animKey === attackKey;
          if (e.health < sp.prevHp && !locked && !charging) {
            sp.animKey = hitKey;
            sp.sprite.play(hitKey);
            this.playSfx('sfx-golem-hit');
            sp.sprite.once('animationcomplete', () => {
              if (sp!.animKey === hitKey) {
                const moving = Math.abs(e.x - sp!.prevX) > 1 || Math.abs(e.y - sp!.prevY) > 1;
                sp!.animKey = moving ? runKey : idleKey;
                sp!.sprite?.play(sp!.animKey);
              }
            });
          } else if (!locked && !charging) {
            const moving = Math.abs(e.x - sp.prevX) > 1 || Math.abs(e.y - sp.prevY) > 1;
            const want   = moving ? runKey : idleKey;
            if (sp.animKey !== want) { sp.animKey = want; sp.sprite.play(want); }
            // Periodic walk sound while the Golem is moving.
            if (moving) {
              this.golemWalkTimer -= this.game.loop.delta;
              if (this.golemWalkTimer <= 0) {
                this.playSfx('sfx-golem-walk');
                this.golemWalkTimer = 900;
              }
            } else {
              this.golemWalkTimer = 0;
            }
          }

        } else if (e.name === 'Dark Mage') {
          const locked = sp.animKey === 'boss-take-hit' || sp.animKey === 'boss-death' || sp.animKey === 'boss-attack';
          if (e.health < sp.prevHp && !locked) {
            sp.animKey = 'boss-take-hit';
            sp.sprite.play('boss-take-hit');
            sp.sprite.once('animationcomplete', () => {
              if (sp!.animKey === 'boss-take-hit') {
                const moving = Math.abs(e.x - sp!.prevX) > 1 || Math.abs(e.y - sp!.prevY) > 1;
                sp!.animKey = moving ? 'boss-run' : 'boss-idle';
                sp!.sprite?.play(sp!.animKey);
              }
            });
          } else if (!locked) {
            const moving = Math.abs(e.x - sp.prevX) > 1 || Math.abs(e.y - sp.prevY) > 1;
            const want   = moving ? 'boss-run' : 'boss-idle';
            if (sp.animKey !== want) { sp.animKey = want; sp.sprite.play(want); }
          }

        } else if (e.name === 'Bat') {
          const LOCKED_BAT = new Set(['bat-hurt', 'bat-attack', 'bat-fly-to-fall', 'bat-fall']);
          if (e.health < sp.prevHp && !LOCKED_BAT.has(sp.animKey)) {
            sp.animKey = 'bat-hurt';
            sp.sprite.play('bat-hurt');
            sp.sprite.once('animationcomplete', () => {
              if (sp!.animKey === 'bat-hurt') { sp!.animKey = 'bat-fly'; sp!.sprite?.play('bat-fly'); }
            });
          }

        } else if (e.name === 'Slime') {
          const LOCKED_SLIME = new Set(['slime-attack', 'slime-hurt', 'slime-death']);
          if (e.health < sp.prevHp && !LOCKED_SLIME.has(sp.animKey)) {
            sp.animKey = 'slime-hurt';
            sp.sprite.play('slime-hurt');
            sp.sprite.once('animationcomplete', () => {
              if (sp!.animKey === 'slime-hurt') {
                const moving = Math.abs(e.x - sp!.prevX) > 1 || Math.abs(e.y - sp!.prevY) > 1;
                sp!.animKey = moving ? 'slime-walk' : 'slime-idle';
                sp!.sprite?.play(sp!.animKey);
              }
            });
          } else if (!LOCKED_SLIME.has(sp.animKey)) {
            const moving = Math.abs(e.x - sp.prevX) > 1 || Math.abs(e.y - sp.prevY) > 1;
            const want   = moving ? 'slime-walk' : 'slime-idle';
            if (sp.animKey !== want) { sp.animKey = want; sp.sprite.play(want); }
          }

        } else if (e.name === 'Mimic') {
          const REVEAL_LOCKED = new Set(['mimic-idle-closed', 'mimic-opening', 'mimic-idle-open', 'mimic-transform']);
          const BATTLE_LOCKED = new Set(['mimic-attack-1', 'mimic-attack-2', 'mimic-hurt', 'mimic-death']);
          if (e.health < sp.prevHp && !REVEAL_LOCKED.has(sp.animKey) && !BATTLE_LOCKED.has(sp.animKey)) {
            sp.animKey = 'mimic-hurt';
            sp.sprite.play('mimic-hurt');
            sp.sprite.once('animationcomplete', () => {
              if (sp!.animKey === 'mimic-hurt') {
                sp!.animKey = 'mimic-idle-transformed';
                sp!.sprite?.play('mimic-idle-transformed');
              }
            });
          } else if (!REVEAL_LOCKED.has(sp.animKey) && !BATTLE_LOCKED.has(sp.animKey)) {
            const moving = Math.abs(e.x - sp.prevX) > 1 || Math.abs(e.y - sp.prevY) > 1;
            const want   = moving ? 'mimic-walk' : 'mimic-idle-transformed';
            if (sp.animKey !== want) { sp.animKey = want; sp.sprite.play(want); }
          }

        } else if (e.name === 'Mad King') {
          const LOCKED_MK = new Set(['madking-take-hit', 'madking-death', 'madking-attack2', 'madking-attack3']);
          const attackKey = `madking-attack${e.attackIndex}` as const;
          if (e.health < sp.prevHp && !LOCKED_MK.has(sp.animKey)) {
            sp.animKey = 'madking-take-hit';
            sp.sprite!.play('madking-take-hit');
            sp.sprite!.once('animationcomplete', () => {
              if (sp!.animKey === 'madking-take-hit') {
                const nearestDist = Math.min(...players.map(p => Math.hypot(e.x - p.x, e.y - p.y)));
                const moving = Math.abs(e.x - sp!.prevX) > 1 || Math.abs(e.y - sp!.prevY) > 1;
                sp!.animKey = nearestDist <= 80 ? 'madking-attack1' : moving ? 'madking-run' : 'madking-idle';
                sp!.sprite?.play(sp!.animKey);
              }
            });
          } else if (e.isAttacking && sp.animKey !== attackKey && !LOCKED_MK.has(sp.animKey)) {
            sp.animKey = attackKey;
            sp.sprite!.play(attackKey);
            sp.sprite!.once('animationcomplete', () => {
              if (sp!.animKey === attackKey) {
                const nearestDist = Math.min(...players.map(p => Math.hypot(e.x - p.x, e.y - p.y)));
                const moving = Math.abs(e.x - sp!.prevX) > 1 || Math.abs(e.y - sp!.prevY) > 1;
                sp!.animKey = nearestDist <= 80 ? 'madking-attack1' : moving ? 'madking-run' : 'madking-idle';
                sp!.sprite?.play(sp!.animKey);
              }
            });
          } else if (!LOCKED_MK.has(sp.animKey)) {
            const nearestDist = Math.min(...players.map(p => Math.hypot(e.x - p.x, e.y - p.y)));
            const moving = Math.abs(e.x - sp.prevX) > 1 || Math.abs(e.y - sp.prevY) > 1;
            const want = nearestDist <= 80 ? 'madking-attack1' : moving ? 'madking-run' : 'madking-idle';
            if (sp.animKey !== want) { sp.animKey = want; sp.sprite!.play(want); }
          }

        } else {
          // Goblin / Skeleton / Mushroom: flash on damage (no hurt animation available)
          if (e.health < sp.prevHp) {
            this.tweens.add({
              targets: sp.sprite, alpha: 0.25, duration: 80, yoyo: true, repeat: 1,
              onComplete: () => sp!.sprite?.setAlpha(1),
            });
          }
        }

      } else {
        // Fallback rectangle enemy
        sp.body!.setPosition(e.x, e.y);
        sp.label?.setPosition(e.x, e.y - (sp.body!.height / 2 + 6));
        if (e.health < sp.prevHp) {
          this.tweens.add({
            targets: sp.body, alpha: 0.2, duration: 80, yoyo: true, repeat: 1,
            onComplete: () => sp!.body?.setAlpha(1),
          });
        }
      }
    }

    // Floating damage number — shown whenever the enemy takes a hit this tick.
    if (e.health < sp.prevHp) {
      const dmg = sp.prevHp - e.health;
      const nx = sp.sprite?.x ?? sp.body?.x ?? e.x;
      const ny = sp.sprite?.y ?? sp.body?.y ?? e.y;
      const big = dmg >= 20;
      this.spawnFloatingNumber(nx, ny, `${dmg}`, '#ffee44', big ? 18 : 14);
    }

    sp.prevX  = e.x;
    sp.prevY  = e.y;
    sp.prevHp = e.health;
  }

  // ── HP bars ────────────────────────────────────────────────────────────────

  private drawHpBars() {
    this.hpBars.clear();
    if (!this.state) return;

    const me = this.state.players.find(p => p.userId === this.myUserId);
    if (me && this.myHeroClass) {
      const top = this.localY - this.mySprite.displayHeight / 2;
      this.drawBar(this.localX, top - 8, me.currentHp, me.maxHp, 0x2ecc71);
    }

    for (const [id, sp] of this.others) {
      const p = this.state.players.find(pl => pl.userId === id);
      if (p && p.isAlive) {
        const top = sp.sprite.y - sp.sprite.displayHeight / 2;
        this.drawBar(sp.sprite.x, top - 8, p.currentHp, p.maxHp, 0x2ecc71);
      }
    }

    for (const [id, sp] of this.enemySprites) {
      if (sp.dead) continue;
      const e = this.state.currentRoom.enemies.find(en => en.id === id);
      if (!e || !e.isAlive) continue;
      if (sp.sprite) {
        const top = sp.sprite.y - sp.sprite.displayHeight / 2;
        this.drawBar(sp.sprite.x, top - 8, e.health, e.maxHealth, 0x8e44ad, 60);

        // ── Golem laser charge bar ────────────────────────────────────────────
        // Drawn as a cyan bar directly below the HP bar, fills left→right as charge
        // progresses from 0 % to 100 %. Label text shows the numeric percentage.
        if (e.name === 'Golem') {
          if (e.chargePercent > 0) {
            // Cyan fill bar (charge progress) below the HP bar.
            this.drawBar(sp.sprite.x, top - 1, e.chargePercent, 1, 0x00ccff, 60);
            // Update label to show "⚡ XX%" so the player knows how close the laser is.
            sp.label?.setText(`⚡ ${Math.round(e.chargePercent * 100)}%`);
          } else {
            // Restore the default "Golem" label when not charging.
            if (sp.label?.text !== 'Golem') sp.label?.setText('Golem');
          }
        }
      } else if (sp.body) {
        const top = sp.body.y - sp.body.height / 2;
        this.drawBar(sp.body.x, top - 8, e.health, e.maxHealth, 0xe74c3c, sp.body.width);
      }
    }
  }

  private drawBar(x: number, y: number, hp: number, max: number, color: number, width = 32) {
    if (max <= 0) return;
    const bx  = x - width / 2;
    const pct = Math.max(0, hp / max);
    this.hpBars.fillStyle(0x222222);
    this.hpBars.fillRect(bx, y, width, 5);
    this.hpBars.fillStyle(color);
    this.hpBars.fillRect(bx, y, width * pct, 5);
  }

  // ── Room drawing ───────────────────────────────────────────────────────────

  // Returns the Phaser texture key for the background that matches the given room.
  // Room 0 is always the entrance; Boss and TreasureChest rooms have dedicated art;
  // all other rooms cycle through the remaining themed environments in order.
  private backgroundKeyForRoom(roomIndex: number, roomType: string): string {
    if (roomIndex === 0) {
      this.regularRoomCount = 0;
      return 'bg-entrance-hall';
    }
    if (roomType === 'Boss')          return 'bg-boss-room';
    if (roomType === 'TreasureChest') return 'bg-treasury';
    if (roomType === 'ExitHall')      return 'bg-exit-hall';
    const pool = [
      'bg-green-garden', 'bg-water-canal', 'bg-lava-maze',
      'bg-library', 'bg-crystal-cave', 'bg-armory',
      'bg-throne-room', 'bg-demonic-summoning-room',
    ];
    const key = pool[this.regularRoomCount % pool.length];
    this.regularRoomCount++;
    return key;
  }

  // ── Shop NPC configuration ────────────────────────────────────────────────
  //
  // ExitHall layout (camera bounds: 1280 × 900 px):
  //   Central carpet  x ≈ 490–790, full height → keep NPCs clear of this band
  //   Left open floor x ≈ 60–460  (Phaser torch pillar at x=100)
  //   Right open floor x ≈ 820–1220 (Phaser torch pillar at x=1180)
  //   Bottom torches at (100,820), (640,820), (1180,820) → NPCs sit at y ≤ 730
  //
  // Scale 1.5 → 96 px frame renders at 144 px tall, matching player-character height.
  //
  // Each entry is the single source of truth for that NPC's animation and position.
  // To add future interaction, key/animKey are the only identifiers needed downstream.
  private static readonly SHOP_NPC_CONFIGS = [
    {
      key:        'shop-blacksmith',
      animKey:    'shop-blacksmith-idle',
      frameCount: 7,
      frameRate:  8,    // hammering cadence — slightly snappier
      x:          265,  // left clear floor, well clear of x=100 torch pillar
      y:          685,  // between mid-left torch (y=450) and bottom-left torch (y=820)
      label:      'Blacksmith',
      subtitle:   'Weapons & Armor',
    },
    {
      key:        'shop-enchanter',
      animKey:    'shop-enchanter-idle',
      frameCount: 8,
      frameRate:  6,    // slow magical stirring
      x:          640,  // carpet centre — thematically fits the enchanter
      y:          740,  // below carpet diamond, above bottom-centre torch (y=820)
      label:      'Enchanter',
      subtitle:   'Magic & Spells',
    },
    {
      key:        'shop-alchemist',
      animKey:    'shop-alchemist-idle',
      frameCount: 8,
      frameRate:  6,    // slow potion-mixing
      x:          1015, // right clear floor, well clear of x=1180 torch pillar
      y:          685,  // mirrors Blacksmith vertically
      label:      'Alchemist',
      subtitle:   'Potions & Brews',
    },
  ] as const;

  // Registers one looping idle animation per shop NPC.
  // Called once in create(); guarded by anims.exists() so hot-reload is safe.
  private createShopAnims() {
    for (const cfg of GameScene.SHOP_NPC_CONFIGS) {
      if (this.anims.exists(cfg.animKey)) continue;
      this.anims.create({
        key:       cfg.animKey,
        frames:    this.anims.generateFrameNumbers(cfg.key, { start: 0, end: cfg.frameCount - 1 }),
        frameRate: cfg.frameRate,
        repeat:    -1,
      });
    }
  }

  // Spawns one animated sprite + two text labels per shop NPC into the Exit Hall.
  // All objects are pushed into roomDecorations so clearRoomVisuals() destroys them
  // automatically on room change — no duplicates are ever created.
  private spawnShopNpcs() {
    // 96 px native frame × 0.75 → 72 px on screen.
    // Smaller than player characters (~100–144 px), appropriate for stationary stall NPCs.
    // roundPixels is set on the global renderer (GamePage.tsx) so no extra step needed here.
    const SCALE  = 0.75;
    const HALF_H = 96 * SCALE / 2;   // 36 px — used to place labels above sprite top

    for (const cfg of GameScene.SHOP_NPC_CONFIGS) {
      const sprite = this.add.sprite(cfg.x, cfg.y, cfg.key, 0)
        .setDepth(5)
        .setScale(SCALE);
      sprite.play(cfg.animKey);

      // labelY pins to just above the rendered sprite top with a small gap.
      const labelY = cfg.y - HALF_H - 10;

      const name = this.add.text(cfg.x, labelY, cfg.label, {
        fontFamily: 'Courier New',
        fontSize:   '11px',
        color:      '#c9a84c',
      }).setOrigin(0.5, 1).setDepth(6);

      const sub = this.add.text(cfg.x, labelY + 2, cfg.subtitle, {
        fontFamily: 'Courier New',
        fontSize:   '8px',
        color:      'rgba(255,255,255,0.38)',
      }).setOrigin(0.5, 0).setDepth(6);

      this.roomDecorations.push(sprite, name, sub);
    }
  }

  private renderBackground(bgKey: string) {
    this.levelWidth  = REGION_W;
    this.levelHeight = REGION_H;

    // Place background at world origin at native resolution (no scaling).
    const bg = this.add.image(0, 0, bgKey)
      .setOrigin(0, 0)
      .setDepth(0);
    this.roomDecorations.push(bg);

    for (const t of WORLD_TORCHES) this.placeTorch(t.x, t.y);

    this.cameras.main.setBounds(0, 0, REGION_W, REGION_H);
    this.currentHazards = [];
  }

  private placeTorch(x: number, y: number) {
    const t = this.add.graphics().setDepth(2).setPosition(x, y);
    t.fillStyle(0xffcc44, 0.18);  t.fillCircle(0, 0, 20);
    t.fillStyle(0xff8800, 0.40);  t.fillCircle(0, 0, 11);
    t.fillStyle(0xffcc44, 0.80);  t.fillCircle(0, 0,  5);
    t.fillStyle(0xffffff, 0.85);  t.fillCircle(0, 0,  2);
    this.roomDecorations.push(t);
    const dur = 500 + Math.random() * 300;
    this.tweens.add({
      targets: t,
      alpha:  { from: 0.60, to: 1.0 },
      scaleX: { from: 0.85, to: 1.15 },
      scaleY: { from: 0.85, to: 1.15 },
      duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  private clearRoomVisuals() {
    for (const d of this.roomDecorations) d.destroy();
    this.roomDecorations = [];
    this.currentHazards  = [];
  }

  private showRoomBanner(roomIndex: number, roomType?: string) {
    const name = roomDisplayName(roomType, roomIndex);
    const sub  = roomType === 'Boss'          ? '— Boss Encounter —'
               : roomType === 'Elite'         ? '— Elite —'
               : roomType === 'TreasureChest' ? '— Treasure —'
               : `Room ${roomIndex + 1}`;

    const panelW = 340, panelH = 72;
    const panelX = (960 - panelW) / 2, panelY = 176;

    const bg = this.add.graphics().setDepth(50).setAlpha(0).setScrollFactor(0);
    bg.fillStyle(0x000000, 0.75);
    bg.fillRect(panelX, panelY, panelW, panelH);
    bg.lineStyle(1, 0xc9a84c, 0.8);
    bg.strokeRect(panelX, panelY, panelW, panelH);

    const titleObj = this.add.text(480, panelY + 18, name, {
      fontFamily: 'Courier New', fontSize: '18px', color: '#c9a84c',
    }).setOrigin(0.5, 0).setDepth(51).setAlpha(0).setScrollFactor(0);

    const subObj = this.add.text(480, panelY + 44, sub, {
      fontFamily: 'Courier New', fontSize: '11px', color: '#aaaaaa',
    }).setOrigin(0.5, 0).setDepth(51).setAlpha(0).setScrollFactor(0);

    const targets = [bg, titleObj, subObj];
    this.tweens.add({
      targets, alpha: 1, duration: 400,
      onComplete: () => {
        this.tweens.add({
          targets, alpha: 0, duration: 600, delay: 2000,
          onComplete: () => { bg.destroy(); titleObj.destroy(); subObj.destroy(); },
        });
      },
    });
  }

  // ── Visual effects ─────────────────────────────────────────────────────────

  private flashAttack(nx: number, ny: number, aimDist: number) {
    const endX = this.localX + nx * aimDist;
    const endY = this.localY + ny * aimDist;

    if (this.myHeroClass === 'Warrior') {
      this.currentAnimKey = 'warrior-attack';
      this.mySprite.play('warrior-attack');
      this.mySprite.once('animationcomplete', () => {
        if (this.currentAnimKey === 'warrior-attack') {
          const moving = this.kW.isDown || this.kS.isDown || this.kA.isDown || this.kD.isDown;
          this.playAnim(moving ? 'warrior-run' : 'warrior-idle');
        }
      });
      const atkAngle = Math.atan2(ny, nx);
      const half     = Math.PI / 4;
      const g = this.add.graphics().setDepth(15);
      g.fillStyle(0xc9a84c, 0.45);
      g.beginPath();
      g.moveTo(this.localX, this.localY);
      g.arc(this.localX, this.localY, ATTACK_RANGE, atkAngle - half, atkAngle + half, false);
      g.closePath();
      g.fillPath();
      this.tweens.add({ targets: g, alpha: 0, duration: 250, onComplete: () => g.destroy() });

    } else if (this.myHeroClass === 'Archer') {
      this.currentAnimKey = 'archer-attack';
      this.mySprite.play('archer-attack');
      this.mySprite.once('animationcomplete', () => {
        if (this.currentAnimKey === 'archer-attack') {
          const moving = this.kW.isDown || this.kS.isDown || this.kA.isDown || this.kD.isDown;
          this.playAnim(moving ? 'archer-run' : 'archer-idle');
        }
      });
      const arrow = this.add.rectangle(this.localX, this.localY, 16, 3, 0x27ae60).setDepth(15);
      arrow.rotation = Math.atan2(ny, nx);
      this.tweens.add({ targets: arrow, x: endX, y: endY, duration: 220, onComplete: () => arrow.destroy() });

    } else if (this.myHeroClass === 'Wizard') {
      this.currentAnimKey = 'wizard-attack1';
      this.mySprite.play('wizard-attack1');
      this.mySprite.once('animationcomplete', () => {
        if (this.currentAnimKey === 'wizard-attack1') {
          const moving = this.kW.isDown || this.kS.isDown || this.kA.isDown || this.kD.isDown;
          this.playAnim(moving ? 'wizard-run' : 'wizard-idle');
        }
      });
      const orb = this.add.arc(this.localX, this.localY, 9, 0, 360, false, 0x8e44ad, 0.9).setDepth(15);
      this.tweens.add({ targets: orb, x: endX, y: endY, duration: 420, alpha: 0.15, onComplete: () => orb.destroy() });
    }
  }

  private findFireballImpact(nx: number, ny: number): { x: number; y: number } {
    const range     = CLASS_RANGE['Wizard'];
    const hitRadius = HIT_RADIUS['Wizard'] ?? 28;
    let bestT = range;

    if (this.state) {
      for (const e of this.state.currentRoom.enemies) {
        if (!e.isAlive) continue;
        const ex = e.x - this.localX;
        const ey = e.y - this.localY;
        const t  = ex * nx + ey * ny;
        if (t < 0 || t >= bestT) continue;
        const cx   = this.localX + nx * t;
        const cy   = this.localY + ny * t;
        const perp = Math.sqrt((cx - e.x) ** 2 + (cy - e.y) ** 2);
        if (perp <= hitRadius) bestT = t;
      }
    }
    return { x: this.localX + nx * bestT, y: this.localY + ny * bestT };
  }

  private flashAbility(nx: number, ny: number) {
    if (this.myHeroClass === 'Warrior') {
      this.currentAnimKey = 'warrior-dash';
      this.mySprite.play('warrior-dash');
      this.mySprite.once('animationcomplete', () => {
        if (this.currentAnimKey === 'warrior-dash') {
          const moving = this.kW.isDown || this.kS.isDown || this.kA.isDown || this.kD.isDown;
          this.playAnim(moving ? 'warrior-run' : 'warrior-idle');
        }
      });
      const ring = this.add.arc(this.localX, this.localY, 22, 0, 360, false, 0xc9a84c, 0.75).setDepth(15);
      this.tweens.add({ targets: ring, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 420, onComplete: () => ring.destroy() });

    } else if (this.myHeroClass === 'Archer') {
      this.currentAnimKey = 'archer-attack';
      this.mySprite.play('archer-attack');
      this.mySprite.once('animationcomplete', () => {
        if (this.currentAnimKey === 'archer-attack') {
          const moving = this.kW.isDown || this.kS.isDown || this.kA.isDown || this.kD.isDown;
          this.playAnim(moving ? 'archer-run' : 'archer-idle');
        }
      });
      const centerAngle = Math.atan2(ny, nx);
      const spread      = Math.PI / 12;
      const range       = CLASS_RANGE['Archer'];
      [-spread, 0, spread].forEach(offset => {
        const angle = centerAngle + offset;
        const arrow = this.add.rectangle(this.localX, this.localY, 18, 3, 0x27ae60).setDepth(15);
        arrow.rotation = angle;
        this.tweens.add({
          targets: arrow,
          x: this.localX + Math.cos(angle) * range,
          y: this.localY + Math.sin(angle) * range,
          duration: 210,
          onComplete: () => arrow.destroy(),
        });
      });

    } else if (this.myHeroClass === 'Wizard') {
      this.currentAnimKey = 'wizard-attack2';
      this.mySprite.play('wizard-attack2');
      this.mySprite.once('animationcomplete', () => {
        if (this.currentAnimKey === 'wizard-attack2') {
          const moving = this.kW.isDown || this.kS.isDown || this.kA.isDown || this.kD.isDown;
          this.playAnim(moving ? 'wizard-run' : 'wizard-idle');
        }
      });
      const { x: impactX, y: impactY } = this.findFireballImpact(nx, ny);
      const tdx      = impactX - this.localX;
      const tdy      = impactY - this.localY;
      const dist     = Math.sqrt(tdx * tdx + tdy * tdy);
      const duration = Math.max(120, (dist / CLASS_RANGE['Wizard']) * 480);
      const orb = this.add.arc(this.localX, this.localY, 11, 0, 360, false, 0xe67e22, 0.95).setDepth(15);
      this.tweens.add({
        targets: orb, x: impactX, y: impactY, duration,
        onComplete: () => {
          orb.destroy();
          const burst = this.add.arc(impactX, impactY, 12, 0, 360, false, 0xe67e22, 0.7).setDepth(15);
          this.tweens.add({ targets: burst, scaleX: 7, scaleY: 7, alpha: 0, duration: 300, onComplete: () => burst.destroy() });
        },
      });
    }
  }

  // ── Aim indicator ──────────────────────────────────────────────────────────

  private drawAim() {
    this.aimGraphics.clear();
    if (!this.myHeroClass || !this.state) return;

    const me = this.state.players.find(p => p.userId === this.myUserId);
    if (!me || !me.isAlive) return;

    const ptr  = this.input.activePointer;
    const dx   = ptr.worldX - this.localX;
    const dy   = ptr.worldY - this.localY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;

    const nx = dx / dist;
    const ny = dy / dist;

    if (this.myHeroClass === 'Warrior') {
      const half  = Math.PI / 4;
      const angle = Math.atan2(ny, nx);
      const a1    = angle - half;
      const a2    = angle + half;
      this.aimGraphics.lineStyle(1.5, 0xc9a84c, 0.55);
      this.aimGraphics.lineBetween(this.localX, this.localY, this.localX + Math.cos(a1) * ATTACK_RANGE, this.localY + Math.sin(a1) * ATTACK_RANGE);
      this.aimGraphics.lineBetween(this.localX, this.localY, this.localX + Math.cos(a2) * ATTACK_RANGE, this.localY + Math.sin(a2) * ATTACK_RANGE);
      this.aimGraphics.beginPath();
      this.aimGraphics.arc(this.localX, this.localY, ATTACK_RANGE, a1, a2, false);
      this.aimGraphics.strokePath();
    } else {
      const range = CLASS_RANGE[this.myHeroClass] ?? 600;
      const hitR  = HIT_RADIUS[this.myHeroClass] ?? 16;
      const endX  = this.localX + nx * range;
      const endY  = this.localY + ny * range;
      this.aimGraphics.lineStyle(1, 0xc9a84c, 0.35);
      this.aimGraphics.lineBetween(this.localX, this.localY, endX, endY);
      this.aimGraphics.strokeCircle(endX, endY, hitR);
    }
  }

  // ── Treasure chest ───────────────────────────────────────────────────────

  // Creates or updates the chest sprite for TreasureChest rooms.
  // The chest sits at the top-centre of the room. Only one player can interact
  // at a time — others see "IN USE" until the current player claims or closes.
  private syncChest(room: RoomState, me: PlayerState | undefined) {
    if (room.type !== 'TreasureChest' || room.chestGold === 0) {
      this.destroyChest();
      return;
    }

    const cx = REGION_W / 2;
    const cy = REGION_H / 2;

    if (!this.chestSprite) {
      // frame 0 = closed dark-wood chest (row 0, col 0 of the 60×32 sheet)
      const body = this.add.sprite(cx, cy, 'chest-sheet', 0)
        .setDepth(7).setScale(2);
      const hint = this.add.text(cx, cy - 42, 'LOCKED', {
        fontFamily: 'Arial Black', fontSize: '11px', color: '#444444',
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(8);
      this.chestSprite = { body, hint };
    }

    if (!room.isCleared) return;

    const { body, hint } = this.chestSprite;

    // Switch to the open frame the first time someone clicks the chest.
    // Triggered by chestOpenerId being set (a player has the loot window open)
    // or chestClaimed being true (this player already claimed their gold).
    const chestHasBeenOpened = !!room.chestOpenerId || (me?.chestClaimed ?? false);
    if (chestHasBeenOpened && !this.chestIsOpen) {
      this.chestIsOpen = true;
      body.play('chest-open');
      this.playSfx('sfx-rare-drop');
      this.tweens.add({
        targets: body, scaleX: 2.4, scaleY: 2.4, duration: 160,
        yoyo: true, onComplete: () => body.setScale(2),
      });
    }

    // Update hint text and click handler based on lock/claim state each tick.
    const claimed = me?.chestClaimed ?? false;
    const inUse   = !!room.chestOpenerId && room.chestOpenerId !== this.myUserId;

    body.off('pointerdown');

    if (claimed) {
      hint.setText('▶ VIEW CHEST').setStyle({ color: '#c9a84c', stroke: '#000000', strokeThickness: 3 });
      body.setInteractive({ useHandCursor: true });
      body.on('pointerdown', () => this.game.events.emit('viewClaimedChest'));
    } else if (inUse) {
      hint.setText('IN USE').setStyle({ color: '#666666', stroke: '#000000', strokeThickness: 3 });
      body.disableInteractive();
    } else {
      hint.setText('▶ CLICK TO OPEN').setStyle({ color: '#c9a84c', stroke: '#000000', strokeThickness: 3 });
      body.setInteractive({ useHandCursor: true });
      body.on('pointerdown', () => this.engine?.interactChest());
    }
  }

  private destroyChest() {
    if (this.chestSprite) {
      this.chestSprite.body.destroy();
      this.chestSprite.hint.destroy();
      this.chestSprite = null;
    }
    this.chestIsOpen = false;
  }

  // ── Boss fireball rendering ────────────────────────────────────────────────

  // Keeps the projectileSprites map in sync with s.activeProjectiles each tick.
  //
  // How it works:
  //   • New ID in state  → create a fireball sprite at the server position.
  //   • Existing ID      → tween the sprite to the updated server position (100 ms = one tick).
  //   • ID gone from state → fireball hit or expired; destroy sprite with an impact burst.
  //
  // Because the server only applies damage when the projectile physically reaches
  // a player, moving out of its path after it is fired genuinely dodges the damage.
  private syncProjectiles(s: GameState) {
    const incoming = new Set((s.activeProjectiles ?? []).map(p => p.id));

    // ── Destroy sprites for projectiles that no longer exist on the server ──
    for (const [id, spr] of this.projectileSprites) {
      if (incoming.has(id)) continue;

      // The server removed this ID — the fireball either hit someone or ran out of range.
      // Show a purple burst at the sprite's last known position as visual feedback.
      const burst = this.add.arc(spr.x, spr.y, 10, 0, 360, false, 0x8b5cf6, 0.85).setDepth(15);
      this.tweens.add({
        targets: burst, scaleX: 5, scaleY: 5, alpha: 0, duration: 260,
        onComplete: () => burst.destroy(),
      });
      spr.destroy();
      this.projectileSprites.delete(id);
    }

    if (!incoming.size) return;

    // Determine which type of attacker is alive in this room so we can use the
    // correct projectile sprite and trigger the correct attack animation.
    // Boss rooms have Dark Mage; Elite rooms have Golem — they never mix.
    let attackerSp: EnemySprite | undefined;
    let attackerName = '';
    for (const [id, sp] of this.enemySprites) {
      const enemy = s.currentRoom.enemies.find(e => e.id === id && e.isAlive);
      if (sp.sprite && !sp.dead && enemy) {
        attackerSp   = sp;
        attackerName = enemy.name;   // 'Dark Mage' or 'Golem'
        break;
      }
    }

    // Pick the projectile sprite key and scale based on the attacker type.
    // Dark Mage → purple fireball (boss-fireball, scale 2.5)
    // Golem → glowing arm projectile (golem-projectile, scale 2.0 — 200×200 px, clearly visible)
    const projKey   = attackerName === 'Golem' ? 'golem-projectile' : 'boss-fireball';
    const projScale = attackerName === 'Golem' ? 2.0 : 2.5;

    // ── Create or update a sprite for each active projectile ──
    for (const p of s.activeProjectiles ?? []) {
      const existing = this.projectileSprites.get(p.id);

      if (!existing) {
        // ── New projectile: create the sprite at the server's reported position ──
        const spr = this.add.sprite(p.x, p.y, projKey).setDepth(15).setScale(projScale);

        // Rotate the arm-projectile to face its actual travel direction.
        // The sprite faces RIGHT by default; atan2 from the attacker to the projectile
        // gives the correct angle for any direction the Golem threw it.
        if (attackerName === 'Golem' && attackerSp?.sprite) {
          const dx = p.x - attackerSp.sprite.x;
          const dy = p.y - attackerSp.sprite.y;
          if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            spr.setRotation(Math.atan2(dy, dx));
          }
        }

        spr.play(attackerName === 'Golem' ? 'golem-projectile' : 'boss-fireball');
        this.projectileSprites.set(p.id, spr);

        // Trigger the attacker's fire animation the moment it launches a projectile.
        if (attackerSp?.sprite) {
          const atkKey  = attackerName === 'Golem' ? 'golem-attack'  : 'boss-attack';
          const idleKey = attackerName === 'Golem' ? 'golem-idle'    : 'boss-idle';
          if (attackerSp.animKey !== atkKey && attackerSp.animKey !== (attackerName === 'Golem' ? 'golem-death' : 'boss-death')) {
            attackerSp.animKey = atkKey;
            attackerSp.sprite.play(atkKey);
            if (attackerName === 'Dark Mage') this.playSfx('sfx-darkmage-attack');
            attackerSp.sprite.once('animationcomplete', () => {
              if (attackerSp!.animKey === atkKey) {
                attackerSp!.animKey = idleKey;
                attackerSp!.sprite?.play(idleKey);
              }
            });
          }
        }

      } else {
        // ── Existing projectile: smoothly move to the server's updated position ──
        // The server moves the projectile ~26 px per 100 ms tick; tweening over
        // exactly 100 ms with Linear easing reproduces that constant speed visually.
        this.tweens.add({
          targets: existing,
          x: p.x, y: p.y,
          duration: 100,  // one server tick — keeps sprite in lockstep with server
          ease: 'Linear', // no acceleration — the projectile travels at constant speed
        });
      }
    }
  }

  // Destroys all fireball sprites without impact bursts.
  // Called on room transition so no stale fireballs linger in the new room.
  private clearProjectiles() {
    for (const spr of this.projectileSprites.values()) spr.destroy();
    this.projectileSprites.clear();
  }

  // ── Floating combat numbers ────────────────────────────────────────────────

  // Spawns a number that floats upward and fades out over ~1 second.
  // color '#ffee44' for damage dealt to enemies, '#ff4444' for damage taken by players.
  private spawnFloatingNumber(x: number, y: number, label: string, color: string, fontSize = 15) {
    const jitter = Phaser.Math.Between(-10, 10);
    const t = this.add.text(x + jitter, y - 20, label, {
      fontFamily: 'Courier New, monospace',
      fontSize: `${fontSize}px`,
      color,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(20);

    this.tweens.add({
      targets: t,
      y: y - 80,
      alpha: 0,
      duration: 950,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  // ── Flame wave rendering ───────────────────────────────────────────────────

  private showFlameWaves(s: GameState) {
    const incoming = new Set((s.activeFlameWaves ?? []).map(w => w.id));

    // Remove Graphics objects for waves that have left the room or been cleared.
    for (const [id, g] of this.flameWaveGraphics) {
      if (!incoming.has(id)) {
        g.destroy();
        this.flameWaveGraphics.delete(id);
      }
    }

    for (const w of s.activeFlameWaves ?? []) {
      const hh = w.halfHeight;
      const existing = this.flameWaveGraphics.get(w.id);

      if (!existing) {
        this.playSfx('sfx-darkmage-attack');
        const g = this.add.graphics().setDepth(13);
        const isVertical = Math.abs(w.dirY ?? 0) > 0.5;

        if (isVertical) {
          // Horizontal band for a vertically-travelling wave.
          // Outer glow — wide, translucent deep purple.
          g.fillStyle(0x7d3c98, 0.22);
          g.fillRect(-(hh + 14), -24, (hh + 14) * 2, 48);
          // Main flame band — vivid purple.
          g.fillStyle(0x8e44ad, 0.82);
          g.fillRect(-hh, -10, hh * 2, 20);
          // Bright inner core — pale lavender.
          g.fillStyle(0xd7bde2, 0.95);
          g.fillRect(-(hh - 10), -4, (hh - 10) * 2, 8);
        } else {
          // Vertical band for a horizontally-travelling wave.
          // Outer glow — tall, translucent deep purple.
          g.fillStyle(0x7d3c98, 0.22);
          g.fillRect(-24, -(hh + 14), 48, (hh + 14) * 2);
          // Main flame band — vivid purple.
          g.fillStyle(0x8e44ad, 0.82);
          g.fillRect(-10, -hh, 20, hh * 2);
          // Bright inner core — pale lavender.
          g.fillStyle(0xd7bde2, 0.95);
          g.fillRect(-4, -(hh - 10), 8, (hh - 10) * 2);
        }

        g.setPosition(w.x, w.y);
        this.flameWaveGraphics.set(w.id, g);
      } else {
        // Server moves waves ~20 px per 100 ms tick — tween for smooth motion.
        if (Math.abs(w.dirY ?? 0) > 0.5) {
          this.tweens.add({ targets: existing, y: w.y, duration: 100, ease: 'Linear' });
        } else {
          this.tweens.add({ targets: existing, x: w.x, duration: 100, ease: 'Linear' });
        }
      }
    }
  }

  private clearFlameWaves() {
    for (const g of this.flameWaveGraphics.values()) g.destroy();
    this.flameWaveGraphics.clear();
  }

  // ── Enemy attack visuals ───────────────────────────────────────────────────
  // Fired when a player's HP decreases: shows a per-enemy attack animation.
  // Skeleton: animated sword sprite flies to the target.
  // Goblin:   bomb animation plays at the goblin's position (melee burst).
  // Bat:      triggers the bat's attack animation on its sprite.

  private showEnemyAttacks(s: GameState) {
    const skeletons = s.currentRoom.enemies.filter(e => e.name === 'Skeleton'  && e.isAlive);
    const goblins   = s.currentRoom.enemies.filter(e => e.name === 'Goblin'    && e.isAlive);
    const bats      = s.currentRoom.enemies.filter(e => e.name === 'Bat'       && e.isAlive);
    const slimes    = s.currentRoom.enemies.filter(e => e.name === 'Slime'     && e.isAlive);
    const mushrooms = s.currentRoom.enemies.filter(e => e.name === 'Mushroom'  && e.isAlive);
    const mimics    = s.currentRoom.enemies.filter(e => e.name === 'Mimic'     && e.isAlive);

    for (const player of s.players) {
      const prevHp = this.prevPlayerHp.get(player.userId) ?? player.currentHp;
      this.prevPlayerHp.set(player.userId, player.currentHp);
      if (!player.isAlive || player.currentHp >= prevHp) continue;

      const targetX = player.userId === this.myUserId
        ? this.localX
        : (this.others.get(player.userId)?.sprite.x ?? player.x);
      const targetY = player.userId === this.myUserId
        ? this.localY
        : (this.others.get(player.userId)?.sprite.y ?? player.y);

      // Floating red damage number above the player who was hit.
      this.spawnFloatingNumber(targetX, targetY, `-${prevHp - player.currentHp}`, '#ff4444', 14);

      // Skeleton: play attack anim on the skeleton's sprite, then launch a spinning sword projectile.
      for (const sk of skeletons) {
        const sdx = targetX - sk.x;
        const sdy = targetY - sk.y;
        if (sdx * sdx + sdy * sdy > 260 * 260) continue;
        const skSp = this.enemySprites.get(sk.id);
        if (skSp?.sprite && !skSp.dead && skSp.animKey !== 'skeleton-attack') {
          skSp.animKey = 'skeleton-attack';
          skSp.sprite.play('skeleton-attack');
          skSp.sprite.once('animationcomplete', () => {
            if (skSp.animKey === 'skeleton-attack') { skSp.animKey = ''; skSp.sprite?.setFrame(0); }
          });
        }
        const sword = this.add.sprite(sk.x, sk.y, 'skeleton-sword', 0).setDepth(15).setScale(0.7);
        sword.play('skeleton-sword');
        this.tweens.add({ targets: sword, x: targetX, y: targetY, duration: 280, onComplete: () => sword.destroy() });
      }

      // Goblin: play attack anim on the goblin's sprite, then show a bomb burst at its position.
      for (const gb of goblins) {
        const gdx = targetX - gb.x;
        const gdy = targetY - gb.y;
        if (gdx * gdx + gdy * gdy > 130 * 130) continue;
        const gbSp = this.enemySprites.get(gb.id);
        if (gbSp?.sprite && !gbSp.dead && gbSp.animKey !== 'goblin-attack') {
          gbSp.animKey = 'goblin-attack';
          gbSp.sprite.play('goblin-attack');
          gbSp.sprite.once('animationcomplete', () => {
            if (gbSp.animKey === 'goblin-attack') { gbSp.animKey = ''; gbSp.sprite?.setFrame(0); }
          });
        }
        const bomb = this.add.sprite(gb.x, gb.y, 'goblin-bomb', 0).setDepth(15).setScale(0.55);
        bomb.play('goblin-bomb');
        bomb.once('animationcomplete', () => bomb.destroy());
      }

      // Bat: trigger the bat-attack animation on the bat's own sprite.
      for (const bt of bats) {
        const bdx = targetX - bt.x;
        const bdy = targetY - bt.y;
        if (bdx * bdx + bdy * bdy > 130 * 130) continue;
        const batSp = this.enemySprites.get(bt.id);
        if (!batSp?.sprite || batSp.dead) continue;
        const LOCKED_BAT = new Set(['bat-attack', 'bat-fly-to-fall', 'bat-fall']);
        if (!LOCKED_BAT.has(batSp.animKey)) {
          batSp.animKey = 'bat-attack';
          batSp.sprite.play('bat-attack');
          batSp.sprite.once('animationcomplete', () => {
            if (batSp.animKey === 'bat-attack') { batSp.animKey = 'bat-fly'; batSp.sprite?.play('bat-fly'); }
          });
        }
      }

      // Slime: play slime-attack on the slime's sprite (melee).
      for (const sl of slimes) {
        const sdx = targetX - sl.x;
        const sdy = targetY - sl.y;
        if (sdx * sdx + sdy * sdy > 130 * 130) continue;
        const slSp = this.enemySprites.get(sl.id);
        if (!slSp?.sprite || slSp.dead) continue;
        const LOCKED_SLIME = new Set(['slime-attack', 'slime-hurt', 'slime-death']);
        if (!LOCKED_SLIME.has(slSp.animKey)) {
          slSp.animKey = 'slime-attack';
          slSp.sprite.play('slime-attack');
          slSp.sprite.once('animationcomplete', () => {
            if (slSp.animKey === 'slime-attack') {
              const moving = Math.abs(sl.x - slSp.prevX) > 1 || Math.abs(sl.y - slSp.prevY) > 1;
              slSp.animKey = moving ? 'slime-walk' : 'slime-idle';
              slSp.sprite?.play(slSp.animKey);
            }
          });
        }
      }

      // Mushroom: play mushroom-attack then launch a spinning projectile toward the player.
      for (const mu of mushrooms) {
        const mdx = targetX - mu.x;
        const mdy = targetY - mu.y;
        if (mdx * mdx + mdy * mdy > 220 * 220) continue;
        const muSp = this.enemySprites.get(mu.id);
        if (!muSp?.sprite || muSp.dead) continue;
        if (muSp.animKey !== 'mushroom-attack') {
          muSp.animKey = 'mushroom-attack';
          muSp.sprite.play('mushroom-attack');
          muSp.sprite.once('animationcomplete', () => {
            if (muSp.animKey === 'mushroom-attack') { muSp.animKey = ''; muSp.sprite?.setFrame(0); }
          });
        }
        const dist = Math.sqrt(mdx * mdx + mdy * mdy);
        const proj = this.add.sprite(mu.x, mu.y, 'mushroom-projectile', 0).setDepth(15).setScale(1.0);
        proj.play('mushroom-projectile');
        this.tweens.add({
          targets: proj, x: targetX, y: targetY,
          duration: Math.max(150, (dist / 220) * 400),
          onComplete: () => proj.destroy(),
        });
      }

      // Mimic: randomly play mimic-attack-1 or -2 (only after reveal completes).
      for (const mi of mimics) {
        const midx = targetX - mi.x;
        const midy = targetY - mi.y;
        if (midx * midx + midy * midy > 130 * 130) continue;
        const miSp = this.enemySprites.get(mi.id);
        if (!miSp?.sprite || miSp.dead) continue;
        const REVEAL_LOCKED = new Set(['mimic-idle-closed', 'mimic-opening', 'mimic-idle-open', 'mimic-transform']);
        const BATTLE_LOCKED = new Set(['mimic-attack-1', 'mimic-attack-2', 'mimic-hurt']);
        if (REVEAL_LOCKED.has(miSp.animKey) || BATTLE_LOCKED.has(miSp.animKey)) continue;
        const atkKey = Math.random() < 0.5 ? 'mimic-attack-1' : 'mimic-attack-2';
        miSp.animKey = atkKey;
        miSp.sprite.play(atkKey);
        miSp.sprite.once('animationcomplete', () => {
          if (miSp.animKey === atkKey) {
            miSp.animKey = 'mimic-idle-transformed';
            miSp.sprite?.play('mimic-idle-transformed');
          }
        });
      }
    }
  }

  // ── Mimic reveal sequence ──────────────────────────────────────────────────

  private startMimicReveal(sp: EnemySprite) {
    this.time.delayedCall(1500, () => {
      if (sp.dead || !sp.sprite) return;
      sp.animKey = 'mimic-opening';
      sp.sprite.play('mimic-opening');
      sp.sprite.once('animationcomplete', () => {
        if (sp.dead || !sp.sprite) return;
        sp.animKey = 'mimic-idle-open';
        sp.sprite.play('mimic-idle-open');
        this.time.delayedCall(400, () => {
          if (sp.dead || !sp.sprite) return;
          sp.animKey = 'mimic-transform';
          sp.sprite.play('mimic-transform');
          sp.sprite.once('animationcomplete', () => {
            if (sp.dead || !sp.sprite) return;
            sp.animKey = 'mimic-idle-transformed';
            sp.sprite.play('mimic-idle-transformed');
            if (sp.label) sp.label.setText('Mimic');
          });
        });
      });
    });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private clearEnemies() {
    for (const [id] of this.enemySprites) this.destroyEnemy(id);
  }

  private destroyEnemy(id: string) {
    const sp = this.enemySprites.get(id);
    if (sp) {
      sp.body?.destroy();
      sp.sprite?.destroy();
      sp.chargeSprite?.destroy();  // remove Golem charge orb if present
      sp.label?.destroy();
    }
    this.enemySprites.delete(id);
  }

  private destroyOther(id: string) {
    const sp = this.others.get(id);
    if (sp) { sp.sprite.destroy(); sp.label.destroy(); }
    this.others.delete(id);
  }
}
