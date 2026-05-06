import Phaser from 'phaser';
import type { GameState, EnemyState, PlayerState } from '../types/gameTypes';
import type { GameEngine } from './gameEngine';

// Room bounds — pixel coordinates that must match RoomBounds.cs on the server.
const R = { L: 48, R: 912, T: 48, B: 592, W: 864, H: 544, CX: 480, CY: 320 };

const ATTACK_RANGE = 120;
const CLASS_RANGE: Record<string, number> = { Warrior: 120, Archer: 600, Wizard: 800 };
const HIT_RADIUS: Record<string, number> = { Archer: 16, Wizard: 28 };
const TILE = 64;

// Scale chosen so each class renders at roughly 70 px tall on the 960×640 canvas.
// Warrior frames are 140 px, Wizard 190 px, Archer 100 px.
const CLASS_SCALE: Record<string, number> = {
  Warrior: 0.5,
  Wizard:  0.4,
  Archer:  0.7,
};

const ENEMY_COLOR: Record<string, number> = {
  Skeleton: 0xbdc3c7,
  Goblin:   0x2ecc71,
  Spider:   0x6c3483,
};
const BOSS_NAMES = new Set(['Dark Mage']);

// Regular enemies render as coloured rectangles; the Dark Mage boss uses an animated sprite.
interface EnemySprite {
  body:    Phaser.GameObjects.Rectangle | null;
  sprite:  Phaser.GameObjects.Sprite    | null;
  label:   Phaser.GameObjects.Text      | null;
  prevHp:  number;
  dead:    boolean;
  prevX:   number;
  prevY:   number;
  animKey: string;
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
  private lastRoomIndex = -1;

  private localX = R.CX;
  private localY = R.CY;
  private readonly SPEED = 220;
  private lastPosSent   = 0;

  private mySprite!: Phaser.GameObjects.Sprite;
  private myLabel!:  Phaser.GameObjects.Text;
  private hpBars!:   Phaser.GameObjects.Graphics;

  private others:       Map<string, OtherSprite> = new Map();
  private enemySprites: Map<string, EnemySprite>  = new Map();

  private myHeroClass    = '';
  private prevPlayerHp:  Map<string, number> = new Map();
  private prevMyHp       = -1;
  private currentAnimKey = '';
  private aimGraphics!:  Phaser.GameObjects.Graphics;

  private kW!:     Phaser.Input.Keyboard.Key;
  private kA!:     Phaser.Input.Keyboard.Key;
  private kS!:     Phaser.Input.Keyboard.Key;
  private kD!:     Phaser.Input.Keyboard.Key;
  private kSpace!: Phaser.Input.Keyboard.Key;
  private kQ!:     Phaser.Input.Keyboard.Key;

  private roomDecorations: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: 'GameScene' }); }

  // ── Phaser lifecycle: preload ──────────────────────────────────────────────

  preload() {
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
  }

  // ── Phaser lifecycle: create ───────────────────────────────────────────────

  create() {
    this.drawRoom(0);
    this.createWarriorAnims();
    this.createWizardAnims();
    this.createArcherAnims();
    this.createDarkMageAnims();

    this.hpBars      = this.add.graphics().setDepth(20);
    this.aimGraphics = this.add.graphics().setDepth(6);

    // Placeholder sprite — invisible until class is known so no wrong-class flash.
    this.mySprite = this.add.sprite(R.CX, R.CY, 'warrior-idle', 0)
      .setDepth(10)
      .setScale(0.5)
      .setAlpha(0);

    this.myLabel = this.add.text(R.CX, R.CY - 45, '', {
      fontFamily: 'Courier New', fontSize: '10px', color: '#ffffff',
    }).setOrigin(0.5, 1).setDepth(11);

    const kb = this.input.keyboard!;
    this.kW     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.kA     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.kS     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.kD     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.kSpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.kQ     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    // Prevent WASD / Space / Q from triggering browser defaults (page scroll, etc.)
    kb.addCapture([
      Phaser.Input.Keyboard.KeyCodes.W,
      Phaser.Input.Keyboard.KeyCodes.A,
      Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.Q,
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
    this.game.events.on('stateUpdate',  (s: GameState)  => this.applyState(s));

    this.game.canvas.setAttribute('tabindex', '0');
    this.game.canvas.focus();

    // Tell GamePage that create() is done and all listeners are live.
    // The sceneReady callback in GamePage emits setEngine / setUserId / setHeroClass /
    // stateUpdate synchronously, so by the time this line returns the sprite is
    // already initialised and positioned.
    this.game.events.emit('sceneReady');
  }

  // ── Animation setup ────────────────────────────────────────────────────────

  private createWarriorAnims() {
    const a = this.anims;
    // Frame counts verified from pixel dimensions: Idle=11, Run=8, Jump=4, Fall=4,
    // Dash=4, Attack=6, TakeHit=4, Death=9
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
    // Frame counts: Idle=6, Run=8, Jump=2, Fall=2, Attack1=8, Attack2=8, Hit=4, Death=7
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
    // Frame counts: Idle=10, Run=8, Jump=2, Fall=2, Attack=6, GetHit=3, Death=10
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
    // Frame counts: Idle=8, Run=8, Attack=8, TakeHit=3, Death=7, Jump=2, Fall=2
    a.create({ key: 'boss-idle',     frames: a.generateFrameNumbers('boss-idle',     { start: 0, end: 7 }), frameRate: 8,  repeat: -1 });
    a.create({ key: 'boss-run',      frames: a.generateFrameNumbers('boss-run',      { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
    a.create({ key: 'boss-attack',   frames: a.generateFrameNumbers('boss-attack',   { start: 0, end: 7 }), frameRate: 12, repeat: 0  });
    a.create({ key: 'boss-take-hit', frames: a.generateFrameNumbers('boss-take-hit', { start: 0, end: 2 }), frameRate: 10, repeat: 0  });
    a.create({ key: 'boss-death',    frames: a.generateFrameNumbers('boss-death',    { start: 0, end: 6 }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'boss-jump',     frames: a.generateFrameNumbers('boss-jump',     { start: 0, end: 1 }), frameRate: 8,  repeat: 0  });
    a.create({ key: 'boss-fall',     frames: a.generateFrameNumbers('boss-fall',     { start: 0, end: 1 }), frameRate: 8,  repeat: 0  });
  }

  // Switches the local player sprite to the correct texture, scale, and idle animation.
  private initPlayerSprite(heroClass: string) {
    this.mySprite.anims.stop();
    this.currentAnimKey = '';

    const prefix = heroClass.toLowerCase();
    const scale  = CLASS_SCALE[heroClass] ?? 0.5;
    this.mySprite.setTexture(`${prefix}-idle`, 0).setScale(scale).setAlpha(1);
    this.playAnim(`${prefix}-idle`);
  }

  // Plays an animation on the local sprite only if it isn't already active,
  // which prevents restarting from frame 0 on every update() call.
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
    const s = this.SPEED * (delta / 1000);
    let dx = 0, dy = 0;
    if (this.kW.isDown) dy -= s;
    if (this.kS.isDown) dy += s;
    if (this.kA.isDown) dx -= s;
    if (this.kD.isDown) dx += s;

    if (dx && dy) { dx *= 0.707; dy *= 0.707; }

    this.localX = Phaser.Math.Clamp(this.localX + dx, R.L + 16, R.R - 16);
    this.localY = Phaser.Math.Clamp(this.localY + dy, R.T + 16, R.B - 16);

    this.mySprite.setPosition(this.localX, this.localY);
    // Label floats above the top of the sprite frame.
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

  private sendPos(time: number) {
    if (time - this.lastPosSent > 50 && this.engine) {
      this.engine.sendPosition(this.localX, this.localY);
      this.lastPosSent = time;
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private handleInput() {
    if (!this.engine || !this.state || !this.myHeroClass) return;

    if (Phaser.Input.Keyboard.JustDown(this.kSpace)) {
      const ptr = this.input.activePointer;
      const dx = ptr.worldX - this.localX;
      const dy = ptr.worldY - this.localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dist > 0 ? dx / dist : 0;
      const ny = dist > 0 ? dy / dist : -1;

      if (this.myHeroClass === 'Warrior') {
        this.engine.attackNearest();
        this.flashAttack(nx, ny, ATTACK_RANGE);
      } else if (dist > 0) {
        const maxRange = CLASS_RANGE[this.myHeroClass] ?? ATTACK_RANGE;
        this.engine.attackDirectional(nx, ny);
        this.flashAttack(nx, ny, Math.min(dist, maxRange));
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.kQ)) {
      const me = this.state.players.find(p => p.userId === this.myUserId);
      if (!me?.canUseAbility) return;
      const ptr = this.input.activePointer;
      const dx = ptr.worldX - this.localX;
      const dy = ptr.worldY - this.localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
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
      this.clearRoomVisuals();
      this.drawRoom(s.currentRoomIndex, s.currentRoom.type);
      this.showRoomBanner(s.currentRoomIndex, s.currentRoom.type);
      this.prevPlayerHp.clear();
      const me = s.players.find(p => p.userId === this.myUserId);
      if (me) { this.localX = me.x; this.localY = me.y; }
    }

    this.showSkeletonProjectiles(s);
    this.state = s;

    // Make sure the local player never appears as an other-player sprite.
    if (this.myUserId) this.destroyOther(this.myUserId);

    // ── Local player ──
    const me = s.players.find(p => p.userId === this.myUserId);
    if (me) {
      const prevClass = this.myHeroClass;
      this.myHeroClass = me.heroClass;

      // First time class is known (or if it changes) — swap sprite texture.
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
        }
        this.mySprite.setAlpha(0.7);
      } else {
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
      this.prevMyHp = me.currentHp;
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
    for (const e of s.currentRoom.enemies) this.syncEnemy(e);
    for (const [id] of this.enemySprites) {
      if (!s.currentRoom.enemies.some(e => e.id === id)) this.destroyEnemy(id);
    }
  }

  // ── Other-player sprites ───────────────────────────────────────────────────

  private syncOther(p: PlayerState) {
    if (p.userId === this.myUserId) return;

    let sp = this.others.get(p.userId);

    if (!sp) {
      // New player — create their sprite with the correct class texture.
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
      // Trigger death animation once.
      sp.dead = true;
      const deathKey = `${sp.heroClass.toLowerCase()}-death`;
      sp.animKey = deathKey;
      sp.sprite.play(deathKey);
      sp.sprite.once('animationcomplete', () => { sp!.sprite.setAlpha(0.3); });
      sp.label.setAlpha(0.3);

    } else if (p.isAlive) {
      // Move sprite to latest server position.
      sp.sprite.setPosition(p.x, p.y).setAlpha(0.9);
      const labelY = p.y - sp.sprite.displayHeight / 2 - 10;
      sp.label.setPosition(p.x, labelY).setAlpha(1);

      // Flip based on horizontal movement since last update.
      const mdx = p.x - sp.prevX;
      if (mdx < -1)      sp.sprite.setFlipX(true);
      else if (mdx > 1)  sp.sprite.setFlipX(false);

      // Switch between idle and run based on whether they moved.
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

  // ── Enemy sprites (rectangles) ─────────────────────────────────────────────

  private syncEnemy(e: EnemyState) {
    let sp = this.enemySprites.get(e.id);
    if (!sp) {
      if (e.name === 'Dark Mage') {
        const spr = this.add.sprite(e.x, e.y, 'boss-idle', 0).setDepth(8).setScale(0.96);
        spr.play('boss-idle');
        const lbl = this.add.text(e.x, e.y - spr.displayHeight / 2 - 22, 'Dark Mage', {
          fontFamily: 'Courier New', fontSize: '10px', color: '#ffffff',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body: null, sprite: spr, label: lbl, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: 'boss-idle' };
      } else {
        const size  = 28;
        const col   = ENEMY_COLOR[e.name] ?? 0xff4444;
        const body  = this.add.rectangle(e.x, e.y, size, size, col).setDepth(8);
        const label = this.add.text(e.x, e.y - (size / 2 + 6), e.name, {
          fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
        }).setOrigin(0.5, 1).setDepth(9);
        sp = { body, sprite: null, label, prevHp: e.health, dead: false, prevX: e.x, prevY: e.y, animKey: '' };
      }
      this.enemySprites.set(e.id, sp);
    }

    if (!e.isAlive && !sp.dead) {
      sp.dead = true;
      if (sp.sprite) {
        sp.animKey = 'boss-death';
        sp.sprite.play('boss-death');
        sp.label?.setAlpha(0);
        sp.sprite.once('animationcomplete', () => {
          this.tweens.add({
            targets: sp!.sprite, alpha: 0, duration: 500,
            onComplete: () => sp!.sprite?.setVisible(false),
          });
        });
      } else {
        this.tweens.add({
          targets: [sp.body, sp.label],
          alpha: 0, angle: 90, duration: 350,
          onComplete: () => { sp!.body?.setVisible(false); sp!.label?.setVisible(false); },
        });
      }
    } else if (e.isAlive) {
      if (sp.sprite) {
        sp.sprite.setPosition(e.x, e.y);
        sp.label?.setPosition(e.x, e.y - sp.sprite.displayHeight / 2 - 22);

        const mdx = e.x - sp.prevX;
        if (mdx < -1)     sp.sprite.setFlipX(true);
        else if (mdx > 1) sp.sprite.setFlipX(false);

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
          if (sp.animKey !== want) {
            sp.animKey = want;
            sp.sprite.play(want);
          }
        }
      } else {
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
    sp.prevX  = e.x;
    sp.prevY  = e.y;
    sp.prevHp = e.health;
  }

  // ── HP bars ────────────────────────────────────────────────────────────────

  private drawHpBars() {
    this.hpBars.clear();
    if (!this.state) return;

    // Local player — bar sits just above the sprite's top edge.
    const me = this.state.players.find(p => p.userId === this.myUserId);
    if (me && this.myHeroClass) {
      const top = this.localY - this.mySprite.displayHeight / 2;
      this.drawBar(this.localX, top - 8, me.currentHp, me.maxHp, 0x2ecc71);
    }

    // Other players.
    for (const [id, sp] of this.others) {
      const p = this.state.players.find(pl => pl.userId === id);
      if (p && p.isAlive) {
        const top = sp.sprite.y - sp.sprite.displayHeight / 2;
        this.drawBar(sp.sprite.x, top - 8, p.currentHp, p.maxHp, 0x2ecc71);
      }
    }

    // Enemies.
    for (const [id, sp] of this.enemySprites) {
      if (sp.dead) continue;
      const e = this.state.currentRoom.enemies.find(en => en.id === id);
      if (!e || !e.isAlive) continue;
      if (sp.sprite) {
        const top = sp.sprite.y - sp.sprite.displayHeight / 2;
        this.drawBar(sp.sprite.x, top - 8, e.health, e.maxHealth, 0x8e44ad, 60);
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

  private drawRoom(roomIndex = 0, roomType?: string) {
    const g = this.add.graphics().setDepth(0);
    this.roomDecorations.push(g);

    // Canvas background
    g.fillStyle(0x0b0906);
    g.fillRect(0, 0, 960, 640);

    // Stone wall border fill
    g.fillStyle(0x141008);
    g.fillRect(0, 0, 960, R.T);
    g.fillRect(0, R.B, 960, 640 - R.B);
    g.fillRect(0, R.T, R.L, R.H);
    g.fillRect(R.R, R.T, 960 - R.R, R.H);

    // Floor tiles — 32×32 checkerboard
    const FT = 32;
    for (let tx = R.L; tx < R.R; tx += FT) {
      for (let ty = R.T; ty < R.B; ty += FT) {
        const w = Math.min(FT, R.R - tx);
        const h = Math.min(FT, R.B - ty);
        g.fillStyle(
          (Math.floor((tx - R.L) / FT) + Math.floor((ty - R.T) / FT)) % 2 === 0
            ? 0x2a1f14 : 0x221a0f
        );
        g.fillRect(tx, ty, w, h);
      }
    }

    // Subtle floor grid
    g.lineStyle(1, 0x0d0b08, 0.5);
    for (let tx = R.L + FT; tx < R.R; tx += FT) g.lineBetween(tx, R.T, tx, R.B);
    for (let ty = R.T + FT; ty < R.B; ty += FT) g.lineBetween(R.L, ty, R.R, ty);

    // Inner wall border glow
    g.lineStyle(2, 0xc9a84c, 0.45);
    g.strokeRect(R.L, R.T, R.W, R.H);
    g.lineStyle(1, 0xc9a84c, 0.1);
    g.strokeRect(R.L + 4, R.T + 4, R.W - 8, R.H - 8);

    // Stone block helper — draws a raised pillar/wall block with highlight edges
    const block = (x: number, y: number, w: number, h: number) => {
      g.fillStyle(0x2a2014);
      g.fillRect(x, y, w, h);
      g.lineStyle(1, 0x4a3824, 0.9);
      g.lineBetween(x, y, x + w, y);
      g.lineBetween(x, y, x, y + h);
      g.lineStyle(1, 0x0c0a06, 1);
      g.lineBetween(x + w, y, x + w, y + h);
      g.lineBetween(x, y + h, x + w, y + h);
    };

    const layoutIndex = roomType === 'Boss' ? 5 : roomIndex % 5;
    let torchPos: { x: number; y: number }[] = [];

    switch (layoutIndex) {
      case 0: { // Entrance Hall — 4 corner pillars + mid-side accents
        block(R.L + 24, R.T + 24, 48, 48);
        block(R.R - 72, R.T + 24, 48, 48);
        block(R.L + 24, R.B - 72, 48, 48);
        block(R.R - 72, R.B - 72, 48, 48);
        block(R.L + 24, R.CY - 24, 24, 48);
        block(R.R - 48, R.CY - 24, 24, 48);
        torchPos = [
          { x: R.L + 52, y: R.T + 4 }, { x: R.R - 52, y: R.T + 4 },
          { x: R.L + 4,  y: R.CY    }, { x: R.R - 4,  y: R.CY    },
          { x: R.CX,     y: R.T + 4 }, { x: R.CX,     y: R.B - 4 },
        ];
        break;
      }
      case 1: { // Pillar Crypt — 4×5 grid of stone pillars
        const pcols = [R.L + 100, R.L + 220, R.CX, R.R - 220, R.R - 100];
        const prows = [R.T + 80,  R.T + 210, R.B - 210, R.B - 80];
        for (const px of pcols) for (const py of prows) block(px - 18, py - 18, 36, 36);
        torchPos = [
          { x: R.L + 4, y: R.T + 4 }, { x: R.R - 4, y: R.T + 4 },
          { x: R.L + 4, y: R.B - 4 }, { x: R.R - 4, y: R.B - 4 },
          { x: R.CX,    y: R.T + 4 }, { x: R.CX,    y: R.B - 4 },
        ];
        break;
      }
      case 2: { // Twin Chambers — vertical divider with center doorway
        const gap = 80;
        block(R.CX - 16, R.T, 32, R.H / 2 - gap / 2);
        block(R.CX - 16, R.CY + gap / 2, 32, R.H / 2 - gap / 2);
        torchPos = [
          { x: R.L + 4,    y: R.T + 4 }, { x: R.R - 4,    y: R.T + 4 },
          { x: R.L + 4,    y: R.B - 4 }, { x: R.R - 4,    y: R.B - 4 },
          { x: R.CX - 48,  y: R.CY    }, { x: R.CX + 48,  y: R.CY    },
        ];
        break;
      }
      case 3: { // Cross Hall — L-shaped walls at each corner
        block(R.L, R.T, 80, 48);      block(R.L, R.T, 48, 80);
        block(R.R - 80, R.T, 80, 48); block(R.R - 48, R.T, 48, 80);
        block(R.L, R.B - 48, 80, 48); block(R.L, R.B - 80, 48, 80);
        block(R.R - 80, R.B - 48, 80, 48); block(R.R - 48, R.B - 80, 48, 80);
        torchPos = [
          { x: R.L + 4, y: R.CY }, { x: R.R - 4, y: R.CY },
          { x: R.CX,    y: R.T + 4 }, { x: R.CX,  y: R.B - 4 },
        ];
        break;
      }
      case 4: { // Guard Post — offset pillar pairs + central blockade
        block(R.L + 48,  R.T + 48,  32, 32);
        block(R.R - 80,  R.T + 48,  32, 32);
        block(R.L + 116, R.T + 132, 32, 32);
        block(R.R - 148, R.T + 132, 32, 32);
        block(R.L + 116, R.B - 164, 32, 32);
        block(R.R - 148, R.B - 164, 32, 32);
        block(R.L + 48,  R.B - 80,  32, 32);
        block(R.R - 80,  R.B - 80,  32, 32);
        block(R.CX - 52, R.CY - 60, 104, 28);
        block(R.CX - 52, R.CY + 32, 104, 28);
        torchPos = [
          { x: R.L + 4,  y: R.T + 4 }, { x: R.R - 4,  y: R.T + 4 },
          { x: R.L + 4,  y: R.B - 4 }, { x: R.R - 4,  y: R.B - 4 },
          { x: R.L + 64, y: R.CY    }, { x: R.R - 64, y: R.CY    },
        ];
        break;
      }
      case 5: { // Boss Sanctum — raised bastions + flanking columns
        block(R.L, R.T, 160, 80);
        block(R.R - 160, R.T, 160, 80);
        for (const dy of [120, 200, 280, 360]) {
          block(R.L, R.T + dy, 32, 24);
          block(R.R - 32, R.T + dy, 32, 24);
        }
        torchPos = [
          { x: R.L + 4, y: R.T + 4 }, { x: R.R - 4, y: R.T + 4 },
          { x: R.L + 4, y: R.CY    }, { x: R.R - 4, y: R.CY    },
          { x: R.L + 4, y: R.B - 4 }, { x: R.R - 4, y: R.B - 4 },
          { x: R.CX,    y: R.T + 4 },
        ];
        break;
      }
    }

    for (const { x, y } of torchPos) this.placeTorch(x, y);
  }

  private placeTorch(x: number, y: number) {
    const t = this.add.graphics().setDepth(2).setPosition(x, y);
    t.fillStyle(0xffcc44, 0.2);  t.fillCircle(0, 0, 18);
    t.fillStyle(0xff8800, 0.45); t.fillCircle(0, 0, 10);
    t.fillStyle(0xffcc44, 0.85); t.fillCircle(0, 0,  5);
    t.fillStyle(0xffffff, 0.9);  t.fillCircle(0, 0,  2);
    this.roomDecorations.push(t);
    const dur = 500 + Math.random() * 300;
    this.tweens.add({
      targets: t,
      alpha:  { from: 0.65, to: 1.0 },
      scaleX: { from: 0.88, to: 1.12 },
      scaleY: { from: 0.88, to: 1.12 },
      duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  private clearRoomVisuals() {
    for (const d of this.roomDecorations) d.destroy();
    this.roomDecorations = [];
  }

  private showRoomBanner(roomIndex: number, roomType?: string) {
    const NAMES: Record<string, string[]> = {
      Normal:        ['Entrance Hall', 'Pillar Crypt', 'Twin Chambers', 'Cross Hall', 'Guard Post'],
      Elite:         ['Elite Chamber', "Champion's Hall", "Warlord's Den", 'Iron Gauntlet', "Death's Antechamber"],
      TreasureChest: ['Treasure Vault', 'Hidden Stash', 'The Hoard', 'Gilded Chamber', 'Reward Chamber'],
      Boss:          ['Boss Sanctum'],
    };
    const type  = roomType ?? 'Normal';
    const names = NAMES[type] ?? NAMES['Normal']!;
    const name  = names[roomIndex % names.length];
    const sub   = type === 'Boss'          ? '— Boss Encounter —'
                : type === 'Elite'         ? '— Elite —'
                : type === 'TreasureChest' ? '— Treasure —'
                : `Room ${roomIndex + 1}`;

    const panelW = 340, panelH = 72;
    const panelX = (960 - panelW) / 2, panelY = 176;

    const bg = this.add.graphics().setDepth(50).setAlpha(0);
    bg.fillStyle(0x000000, 0.75);
    bg.fillRect(panelX, panelY, panelW, panelH);
    bg.lineStyle(1, 0xc9a84c, 0.8);
    bg.strokeRect(panelX, panelY, panelW, panelH);

    const titleObj = this.add.text(480, panelY + 18, name, {
      fontFamily: 'Courier New', fontSize: '18px', color: '#c9a84c',
    }).setOrigin(0.5, 0).setDepth(51).setAlpha(0);

    const subObj = this.add.text(480, panelY + 44, sub, {
      fontFamily: 'Courier New', fontSize: '11px', color: '#aaaaaa',
    }).setOrigin(0.5, 0).setDepth(51).setAlpha(0);

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
      // Filled 90° cone in the aim direction.
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
      // Arrow flying toward the cursor.
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
      // Purple orb drifting toward the cursor.
      const orb = this.add.arc(this.localX, this.localY, 9, 0, 360, false, 0x8e44ad, 0.9).setDepth(15);
      this.tweens.add({ targets: orb, x: endX, y: endY, duration: 420, alpha: 0.15, onComplete: () => orb.destroy() });
    }
  }

  // Client-side ray-cast that mirrors the server's FindRayTarget so the fireball
  // burst lands on the first enemy hit rather than at max range.
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
      // Multi-Shot: three arrows in a ±15° spread.
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

  // ── Aim indicator (redrawn every frame) ────────────────────────────────────

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

  // ── Skeleton projectile visuals ────────────────────────────────────────────

  private showSkeletonProjectiles(s: GameState) {
    const skeletons = s.currentRoom.enemies.filter(e => e.name === 'Skeleton' && e.isAlive);

    // Find the Dark Mage boss sprite if one exists in this room.
    let bossSp: EnemySprite | undefined;
    for (const [id, sp] of this.enemySprites) {
      if (sp.sprite && !sp.dead) {
        const bossEnemy = s.currentRoom.enemies.find(e => e.id === id && e.isAlive);
        if (bossEnemy) { bossSp = sp; break; }
      }
    }

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

      // Skeleton bone projectile toward the player who was hit.
      for (const sk of skeletons) {
        const sdx = targetX - sk.x;
        const sdy = targetY - sk.y;
        if (sdx * sdx + sdy * sdy > 260 * 260) continue;
        const proj = this.add.arc(sk.x, sk.y, 5, 0, 360, false, 0xbdc3c7, 0.9).setDepth(15);
        this.tweens.add({ targets: proj, x: targetX, y: targetY, duration: 280, onComplete: () => proj.destroy() });
      }

      // Dark Mage attack animation when a player is hit.
      if (bossSp?.sprite) {
        const locked = bossSp.animKey === 'boss-take-hit' || bossSp.animKey === 'boss-death' || bossSp.animKey === 'boss-attack';
        if (!locked) {
          bossSp.animKey = 'boss-attack';
          bossSp.sprite.play('boss-attack');
          bossSp.sprite.once('animationcomplete', () => {
            if (bossSp!.animKey === 'boss-attack') {
              bossSp!.animKey = 'boss-idle';
              bossSp!.sprite?.play('boss-idle');
            }
          });
        }
      }
    }
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
