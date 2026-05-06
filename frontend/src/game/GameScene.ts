import Phaser from 'phaser';
import type { GameState, EnemyState, PlayerState } from '../types/gameTypes';
import type { GameEngine } from './gameEngine';

// World dimensions — the full size of every dungeon level.
// The Phaser canvas (960 × 640) is the camera's viewport, smaller than the world,
// so the camera follows the local player around a much larger map.
const WORLD_W = 1920;
const WORLD_H = 1280;

// Room bounds — pixel coordinates that must match RoomBounds.cs on the server.
// Walls are 48 px thick on every side, leaving an 1824 × 1184 playable area
// large enough to hold several connected chambers per level.
// R.CX / R.CY is the center where players spawn.
const R = { L: 48, R: WORLD_W - 48, T: 48, B: WORLD_H - 48,
            W: WORLD_W - 96, H: WORLD_H - 96,
            CX: WORLD_W / 2, CY: WORLD_H / 2 };

const ATTACK_RANGE = 120;
const CLASS_RANGE: Record<string, number> = { Warrior: 120, Archer: 600, Wizard: 800 };
const HIT_RADIUS: Record<string, number> = { Archer: 16, Wizard: 28 };

// Rectangle fill colors for each hero class — helps players tell each other apart.
const CLASS_COLOR: Record<string, number> = {
  Warrior: 0xe74c3c,  // red
  Wizard:  0x8e44ad,  // purple
  Archer:  0x27ae60,  // green
};

const ENEMY_COLOR: Record<string, number> = {
  Skeleton:           0xbdc3c7,
  Goblin:             0x2ecc71,
  Spider:             0x6c3483,
  'Bone Titan':       0xe74c3c,
  'Ancient Colossus': 0xe74c3c,
  'Dungeon Overlord': 0xff0000,
};
const BOSS_NAMES = new Set(['Bone Titan', 'Ancient Colossus', 'Dungeon Overlord']);

// Enemies are still rendered as coloured rectangles.
interface EnemySprite {
  body:   Phaser.GameObjects.Rectangle;
  label:  Phaser.GameObjects.Text;
  prevHp: number;
  dead:   boolean;
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
  private readonly SPEED = 220;  // pixels per second
  private lastPosSent = 0;       // timestamp of last position send

  // Phaser game objects for the local player.
  private myBody!: Phaser.GameObjects.Rectangle;
  private myLabel!: Phaser.GameObjects.Text;
  // Single shared Graphics object redrawn every frame for all HP bars.
  private hpBars!: Phaser.GameObjects.Graphics;

  // Maps from userId / enemy-id to sprite objects.
  // Using a Map lets us add/remove individual sprites when players join/leave
  // or enemies are defeated, without rebuilding the entire scene.
  private others = new Map<string, EntitySprites>();
  private enemySprites = new Map<string, EntitySprites & { prevHp: number; dead: boolean }>();

  // Room visuals — destroyed and rebuilt on every room transition.
  private roomMap: Phaser.Tilemaps.Tilemap | null = null;
  private roomDecorations: Phaser.GameObjects.GameObject[] = [];
  // Boolean wall grid (rows × cols of 16-px tiles) used by client-side
  // collision so the local player can't walk through chamber walls.
  private wallGrid: boolean[][] = [];

  // Hero class of the local player — set from state updates, used for aim visuals.
  private myHeroClass = '';

  // Tracks last-known HP per player so we can detect damage taken between updates.
  private prevPlayerHp = new Map<string, number>();

  // Graphics object redrawn every frame to show the directional aim indicator.
  private aimGraphics!: Phaser.GameObjects.Graphics;

  // Keyboard keys — registered in create() and polled in update().
  private kW!: Phaser.Input.Keyboard.Key;
  private kA!: Phaser.Input.Keyboard.Key;
  private kS!: Phaser.Input.Keyboard.Key;
  private kD!: Phaser.Input.Keyboard.Key;
  private kSpace!: Phaser.Input.Keyboard.Key;
  private kQ!:     Phaser.Input.Keyboard.Key;

  constructor() { super({ key: 'GameScene' }); }

  // ── Phaser lifecycle: preload ──────────────────────────────────────────────

  preload() {
    this.load.spritesheet('dungeon', '/assets/tiled/walls_floor.png',
      { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('fire', '/assets/tiled/fire_animation.png',
      { frameWidth: 16, frameHeight: 16 });
  }

  // ── Phaser lifecycle: create ───────────────────────────────────────────────

  create() {
    // Torch fire animation: 6 keyframes from column 0 of fire_animation.png,
    // distributed every 3 rows (frames 0, 33, 66, 99, 132, 165).
    this.anims.create({
      key: 'torch',
      frames: [
        { key: 'fire', frame: 0   },
        { key: 'fire', frame: 33  },
        { key: 'fire', frame: 66  },
        { key: 'fire', frame: 99  },
        { key: 'fire', frame: 132 },
        { key: 'fire', frame: 165 },
      ],
      frameRate: 6,
      repeat: -1,
    });

    this.drawRoom(0);

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

    // Camera setup — viewport is the canvas (960 × 640) but the world is
    // WORLD_W × WORLD_H, so the camera follows the local player around the map.
    // Lerp values smooth the follow so the camera doesn't snap on every frame.
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.startFollow(this.myBody, true, 0.12, 0.12);
    this.cameras.main.setRoundPixels(true);

    // Register keyboard keys. addKey returns an object we can query each frame.
    const kb = this.input.keyboard!;
    this.kW     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.kA     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.kS     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.kD     = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.kSpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.kQ = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    // Listen for events emitted by React (via gameRef.current.events.emit).
    // This is the bridge between the React component tree and the Phaser scene.
    this.game.events.on('setEngine',   (e: GameEngine) => { this.engine = e; });
    this.game.events.on('setUserId', (id: string) => {
      this.myUserId = id;
      // If a state update arrived before we knew our own ID, the local player
      // was added to `others` as a ghost. Destroy it now that we can identify it.
      if (this.others.has(id)) this.destroyOther(id);
    });
    this.game.events.on('setUsername', (n: string)     => {
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

  // Move the local player based on which WASD keys are held down.
  // Movement is split per-axis so the player slides along walls instead of
  // sticking when one axis is blocked but the other is free.
  private move(delta: number) {
    const s = this.SPEED * (delta / 1000);
    let dx = 0, dy = 0;
    if (this.kW.isDown) dy -= s;
    if (this.kS.isDown) dy += s;
    if (this.kA.isDown) dx -= s;
    if (this.kD.isDown) dx += s;

    if (dx && dy) { dx *= 0.707; dy *= 0.707; }

    // Try X then Y separately; reject either step if it would put us in a wall.
    if (dx) {
      const nx = Phaser.Math.Clamp(this.localX + dx, R.L + 16, R.R - 16);
      if (!this.wallAt(nx, this.localY)) this.localX = nx;
    }
    if (dy) {
      const ny = Phaser.Math.Clamp(this.localY + dy, R.T + 16, R.B - 16);
      if (!this.wallAt(this.localX, ny)) this.localY = ny;
    }

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

  // True if a 28×28 hit-box centered on (x, y) overlaps any wall tile.
  // Checks the four corners of the hit-box against the wallGrid built when
  // the room was drawn — pure pixel-to-tile lookup, no Phaser physics needed.
  private wallAt(x: number, y: number): boolean {
    const HALF = 14;
    for (const ox of [-HALF, HALF]) {
      for (const oy of [-HALF, HALF]) {
        const c = Math.floor((x + ox) / 16);
        const r = Math.floor((y + oy) / 16);
        if (this.wallGrid[r]?.[c]) return true;
      }
    }
    return false;
  }

  // Throttle position sends to every 50ms (20 updates/sec) to avoid flooding
  // the server. The server rebroadcasts positions at 10fps via EnemyAiService.
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
    // Room changed → rebuild room visuals, clear enemies, snap player to spawn.
    if (s.currentRoomIndex !== this.lastRoomIndex) {
      this.lastRoomIndex = s.currentRoomIndex;
      this.clearEnemies();
      this.clearRoomVisuals();
      this.drawRoom(s.currentRoomIndex, s.currentRoom.type);
      this.prevPlayerHp.clear();
      const me = s.players.find(p => p.userId === this.myUserId);
      if (me) { this.localX = me.x; this.localY = me.y; }
      this.showRoomBanner(s.currentRoomIndex, s.currentRoom.type);
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
      const isBoss = BOSS_NAMES.has(e.name);
      const size   = isBoss ? 40 : 28;
      const col    = ENEMY_COLOR[e.name] ?? 0xff4444;
      const body   = this.add.rectangle(e.x, e.y, size, size, col).setDepth(8);
      const label  = this.add.text(e.x, e.y - (size / 2 + 6), e.name, {
        fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
      }).setOrigin(0.5, 1).setDepth(9);
      sp = { body, label, prevHp: e.health, dead: false };
      this.enemySprites.set(e.id, sp);
    }

    if (!e.isAlive && !sp.dead) {
      sp.dead = true;
      this.tweens.add({
        targets: [sp.body, sp.label],
        alpha: 0, angle: 90, duration: 350,
        onComplete: () => { sp!.body.setVisible(false); sp!.label.setVisible(false); },
      });
    } else if (e.isAlive) {
      sp.body.setPosition(e.x, e.y);
      sp.label.setPosition(e.x, e.y - (sp.body.height / 2 + 6));

      if (e.health < sp.prevHp) {
        this.tweens.add({
          targets: sp.body, alpha: 0.2, duration: 80, yoyo: true, repeat: 1,
          onComplete: () => sp!.body.setAlpha(1),
        });
      }
    }
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
      if (e && e.isAlive) {
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

  private clearRoomVisuals() {
    this.roomMap?.destroy();
    this.roomMap = null;
    for (const obj of this.roomDecorations) { if (obj.active) obj.destroy(); }
    this.roomDecorations = [];
  }

  // Multi-chamber room layouts for the 120×80 tile world.
  // Each layout carves the playable area into several distinct chambers
  // connected by corridors so the player feels like they're moving through
  // a real dungeon instead of a single empty box.
  // Boss rooms always use the throne sanctum layout regardless of index.
  // Tile values use firstgid=1: value = frame + 1.
  //   W=37  → frame 36  (stone wall block from walls_floor.png)
  //   F=139 → frame 138 (stone floor tile from walls_floor.png)
  private buildMapData(roomIndex: number, roomType = 'Normal'): number[][] {
    const W = 37;
    const F = 139;
    const COLS = WORLD_W / 16;   // 120
    const ROWS = WORLD_H / 16;   // 80

    // Initialize: every tile a wall, then carve the playable interior to floor.
    // wallGrid mirrors the tile data so the local-player collision check
    // (wallAt) can do a pure pixel-to-tile lookup with no extra work.
    const d: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(W));
    this.wallGrid = Array.from({ length: ROWS }, () => new Array(COLS).fill(true));

    for (let r = 3; r <= ROWS - 4; r++)
      for (let c = 3; c <= COLS - 4; c++) {
        d[r][c] = F;
        this.wallGrid[r][c] = false;
      }

    // Place a rectangle of wall tiles, marking both tile data and collision grid.
    const wall = (c0: number, r0: number, cw: number, rh: number) => {
      for (let r = r0; r < r0 + rh; r++)
        for (let c = c0; c < c0 + cw; c++)
          if (r >= 3 && r <= ROWS - 4 && c >= 3 && c <= COLS - 4) {
            d[r][c] = W;
            this.wallGrid[r][c] = true;
          }
    };

    // Carve a floor rectangle through whatever walls were placed there.
    const carve = (c0: number, r0: number, cw: number, rh: number) => {
      for (let r = r0; r < r0 + rh; r++)
        for (let c = c0; c < c0 + cw; c++)
          if (r >= 3 && r <= ROWS - 4 && c >= 3 && c <= COLS - 4) {
            d[r][c] = F;
            this.wallGrid[r][c] = false;
          }
    };

    const layout = (roomType === 'Boss') ? 3 : roomIndex % 3;

    switch (layout) {
      case 0:
        // Crossroads — four corner blocks leave a plus-shaped corridor
        // joining a central hub to a chamber on each cardinal side.
        wall(3,  3,  44, 29);   // NW corner block
        wall(73, 3,  44, 29);   // NE corner block
        wall(3,  48, 44, 29);   // SW corner block
        wall(73, 48, 44, 29);   // SE corner block
        // Pillar pairs in each arm to break up the long sight-lines.
        wall(58, 8,  2, 3);  wall(60, 8,  2, 3);
        wall(58, 68, 2, 3);  wall(60, 68, 2, 3);
        wall(8,  38, 2, 3);  wall(40, 38, 2, 3);
        wall(78, 38, 2, 3);  wall(108, 38, 2, 3);
        break;

      case 1:
        // Twin Halls — north and south chambers separated by a thick
        // dividing wall pierced by three doorways. Players cross between
        // halves through whichever door fits their tactical position.
        wall(3,  36, 35, 8);    // wall left of door 1
        wall(45, 36, 30, 8);    // wall between doors 1 and 2
        wall(82, 36, 35, 8);    // wall right of door 3
        // Pillar colonnades lining each chamber for grand-hall framing.
        for (const c of [10, 25, 40, 55, 70, 85, 100, 113]) {
          wall(c, 8,  2, 3);
          wall(c, 68, 2, 3);
        }
        // Open the spawn pocket so the party never lands inside a wall.
        carve(55, 36, 11, 8);
        break;

      case 2:
        // Pillar Cathedral — long central nave flanked by colonnades and
        // four side alcoves on each long wall, joined by short doorways.
        // North alcoves
        wall(3,   3, 18, 12);  wall(28,  3, 18, 12);
        wall(53,  3, 18, 12);  wall(78,  3, 18, 12);
        wall(103, 3, 14, 12);
        // South alcoves
        wall(3,   65, 18, 12);  wall(28,  65, 18, 12);
        wall(53,  65, 18, 12);  wall(78,  65, 18, 12);
        wall(103, 65, 14, 12);
        // Two long pillar rows down the cathedral nave.
        for (const c of [10, 22, 34, 46, 58, 70, 82, 94, 106]) {
          wall(c, 22, 2, 3);
          wall(c, 56, 2, 3);
        }
        // Cut doorways into each alcove so they're enterable.
        for (const cc of [21, 46, 71, 96]) {
          carve(cc, 11, 7, 4);
          carve(cc, 65, 7, 4);
        }
        break;

      case 3:
        // Boss Sanctum — antechamber to the south, throne dais to the north,
        // joined by a single wide doorway. Mighty pillars flank the aisle.
        // Antechamber wall (gap at cols 53-66 = throne entrance)
        wall(3,  24, 50, 6);   wall(67, 24, 50, 6);
        // Throne dais wall behind the throne, with a narrow center gap
        wall(3,   4, 30, 5);   wall(40, 4, 40, 5);   wall(87, 4, 30, 5);
        // Mighty pillars flanking the central aisle (north chamber)
        for (const r0 of [12, 36, 50, 64]) {
          wall(20, r0, 3, 4);
          wall(97, r0, 3, 4);
        }
        // Inner pillars guarding the throne approach
        wall(40, 32, 3, 4);  wall(77, 32, 3, 4);
        wall(40, 50, 3, 4);  wall(77, 50, 3, 4);
        break;
    }

    // Torch niches — 2-tile floor openings cut into the outer wall rows/cols
    // so torch flames appear recessed inside stone alcoves.
    for (const nc of [12, 28, 44, 60, 76, 92, 108]) {
      d[2][nc] = F; d[2][nc + 1] = F;
      d[ROWS - 3][nc] = F; d[ROWS - 3][nc + 1] = F;
    }
    for (const nr of [10, 22, 34, 46, 58, 70]) {
      d[nr][2] = F; d[nr + 1][2] = F;
      d[nr][COLS - 3] = F; d[nr + 1][COLS - 3] = F;
    }

    return d;
  }

  // Rebuilds all room visuals. Called once in create() and again on every room transition.
  private drawRoom(roomIndex: number = 0, roomType = 'Normal') {
    const T = 16;

    // Helper: create a tracked game object so clearRoomVisuals() can destroy it.
    const track = <O extends Phaser.GameObjects.GameObject>(obj: O): O => {
      this.roomDecorations.push(obj);
      return obj;
    };

    // Tilemap layer — walls_floor.png, firstgid=1 so data value = frame index + 1.
    const map = this.make.tilemap({ data: this.buildMapData(roomIndex, roomType), tileWidth: T, tileHeight: T });
    this.roomMap = map;
    const ts = map.addTilesetImage('dungeon', 'dungeon', T, T, 0, 0, 1);
    if (ts) map.createLayer(0, ts, 0, 0, true)?.setDepth(0);

    // Dark overlay covering the outer wall border (no internal corner columns
    // anymore — those are part of each layout's chamber geometry).
    const ov = track(this.add.graphics().setDepth(1));
    ov.fillStyle(0x000000, 0.45);
    ov.fillRect(0,            0,             WORLD_W, 48);    // north
    ov.fillRect(0,            WORLD_H - 48,  WORLD_W, 48);    // south
    ov.fillRect(0,            48,            48, WORLD_H - 96);  // west
    ov.fillRect(WORLD_W - 48, 48,            48, WORLD_H - 96);  // east

    // Shadow gradient where outer walls meet the floor — adds depth.
    const sh = track(this.add.graphics().setDepth(2));
    sh.fillStyle(0x000000, 0.30); sh.fillRect(R.L, R.T,         R.W, T);
    sh.fillStyle(0x000000, 0.14); sh.fillRect(R.L, R.T + T,     R.W, T);
    sh.fillStyle(0x000000, 0.06); sh.fillRect(R.L, R.T + T * 2, R.W, T);
    sh.fillStyle(0x000000, 0.22); sh.fillRect(R.L,         R.T, T, R.H);
    sh.fillStyle(0x000000, 0.10); sh.fillRect(R.L + T,     R.T, T, R.H);
    sh.fillStyle(0x000000, 0.22); sh.fillRect(R.R - T,     R.T, T, R.H);
    sh.fillStyle(0x000000, 0.10); sh.fillRect(R.R - T * 2, R.T, T, R.H);
    sh.fillStyle(0x000000, 0.28); sh.fillRect(R.L, R.B - T,     R.W, T);
    sh.fillStyle(0x000000, 0.12); sh.fillRect(R.L, R.B - T * 2, R.W, T);

    // Torches in the outer-wall niches cut by buildMapData.
    // North/south wall niches at every 16-tile interval (cols 12, 28, 44…).
    const torchPos: Array<{ x: number; y: number }> = [];
    for (const nc of [12, 28, 44, 60, 76, 92, 108]) {
      torchPos.push({ x: (nc + 1) * T,        y: R.T - T / 2 });
      torchPos.push({ x: (nc + 1) * T,        y: R.B + T / 2 });
    }
    for (const nr of [10, 22, 34, 46, 58, 70]) {
      torchPos.push({ x: R.L - T / 2,         y: (nr + 1) * T });
      torchPos.push({ x: R.R + T / 2,         y: (nr + 1) * T });
    }

    for (const { x, y } of torchPos) {
      track(this.add.arc(x, y + 6, 28, 0, 360, false, 0xff6600, 0.09).setDepth(3));
      track(this.add.arc(x, y + 2, 12, 0, 360, false, 0xffcc44, 0.20).setDepth(3));
      track(this.add.sprite(x, y, 'fire', 0).setScale(2).setDepth(4).play('torch'));
    }

    // Stone-edge border at the room perimeter.
    const g = track(this.add.graphics().setDepth(5));
    g.lineStyle(2, 0x8a7050, 0.4);
    g.strokeRect(R.L, R.T, R.W, R.H);
  }

  // Briefly displays the room name in the center of the camera viewport.
  // setScrollFactor(0) pins the text to the screen so it doesn't slide off
  // when the camera follows the player.
  private showRoomBanner(roomIndex: number, roomType: string) {
    const names = ['Crossroads', 'Twin Halls', 'Pillar Cathedral'];
    const name = roomType === 'Boss' ? '⚠ Boss Sanctum ⚠'
      : roomType === 'TreasureChest' ? '✦ Treasure Room ✦'
      : names[roomIndex % names.length];
    const cam = this.cameras.main;
    const txt = this.add.text(cam.width / 2, cam.height / 2, name, {
      fontFamily: 'Courier New', fontSize: '28px', color: '#c9a84c',
      stroke: '#000000', strokeThickness: 4,
    }).setScrollFactor(0).setOrigin(0.5).setDepth(50).setAlpha(0);
    this.tweens.add({
      targets: txt, alpha: 1, duration: 400, yoyo: true, hold: 1200,
      onComplete: () => txt.destroy(),
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
    if (!skeletons.length) return;

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

      for (const sk of skeletons) {
        const sdx = targetX - sk.x;
        const sdy = targetY - sk.y;
        if (sdx * sdx + sdy * sdy > 260 * 260) continue;
        const proj = this.add.arc(sk.x, sk.y, 5, 0, 360, false, 0xbdc3c7, 0.9).setDepth(15);
        this.tweens.add({ targets: proj, x: targetX, y: targetY, duration: 280, onComplete: () => proj.destroy() });
      }
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  private clearEnemies() {
    for (const [id] of this.enemySprites) this.destroyEnemy(id);
  }

  private destroyEnemy(id: string) {
    const sp = this.enemySprites.get(id);
    if (sp) { sp.body.destroy(); sp.label.destroy(); }
    this.enemySprites.delete(id);
  }

  private destroyOther(id: string) {
    const sp = this.others.get(id);
    if (sp) { sp.sprite.destroy(); sp.label.destroy(); }
    this.others.delete(id);
  }
}
