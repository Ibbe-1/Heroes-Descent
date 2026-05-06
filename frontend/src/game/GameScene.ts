// GameScene.ts — the Phaser 3 game scene that renders the dungeon room.
//
// Phaser uses a scene lifecycle with three key methods:
//   create()  — called once when the scene starts; set up all game objects and input.
//   update()  — called every frame (~60fps); handle movement, input, and redraw bars.
//
// Because React and Phaser run in separate worlds, data flows between them via
// the Phaser event bus (game.events). React emits events like 'stateUpdate' and
// Phaser listens for them — no shared variables needed.

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

// Warrior melee attack range (px).
const ATTACK_RANGE = 120;

// Per-class attack ranges — must match RoomBounds.cs on the server.
const CLASS_RANGE: Record<string, number> = { Warrior: 120, Archer: 600, Wizard: 800 };

// Projectile hit-box radii shown on the aim line indicator.
const HIT_RADIUS: Record<string, number> = { Archer: 16, Wizard: 28 };

// Rectangle fill colors for each hero class — helps players tell each other apart.
const CLASS_COLOR: Record<string, number> = {
  Warrior: 0xe74c3c,  // red
  Wizard:  0x8e44ad,  // purple
  Archer:  0x27ae60,  // green
};

// Rectangle fill colors for each enemy type.
// Bosses are all red because they share the same "danger" cue.
const ENEMY_COLOR: Record<string, number> = {
  Skeleton:          0xbdc3c7,
  Goblin:            0x2ecc71,
  Spider:            0x6c3483,
  'Bone Titan':      0xe74c3c,
  'Ancient Colossus':0xe74c3c,
  'Dungeon Overlord':0xff0000,
};
const BOSS_NAMES = new Set(['Bone Titan', 'Ancient Colossus', 'Dungeon Overlord']);

// Every entity on screen (player or enemy) is represented by a rectangle + text label.
// Storing both together makes it easy to move or destroy them as a pair.
interface EntitySprites {
  body: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  // References injected by React via the event bus after the scene is created.
  private engine: GameEngine | null = null;  // used to send actions to the server
  private myUserId = '';
  private myUsername = '';

  // Latest snapshot received from the server.
  private state: GameState | null = null;
  // Tracked to detect when the server moves us to a new room.
  private lastRoomIndex = -1;

  // Local player position — updated locally at 60fps for smooth movement,
  // then sent to the server every 50ms so others can see where we are.
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
  private kQ!: Phaser.Input.Keyboard.Key;

  constructor() { super({ key: 'GameScene' }); }

  // ── Phaser lifecycle: preload ──────────────────────────────────────────────

  preload() {
    this.load.spritesheet('dungeon', '/assets/tiled/walls_floor.png',
      { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('fire', '/assets/tiled/fire_animation.png',
      { frameWidth: 16, frameHeight: 16 });
  }

  // ── Phaser lifecycle: create ───────────────────────────────────────────────

  // Called once when the scene starts. We draw the room, create sprites,
  // register input, and start listening for events from React.
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

    // HP bars use a shared Graphics object. Every frame we clear() it and
    // redraw all bars from scratch — simpler than updating many individual objects.
    this.hpBars = this.add.graphics().setDepth(20);

    // Aim indicator redrawn each frame — shows cone (Warrior) or aim line (Archer/Wizard).
    this.aimGraphics = this.add.graphics().setDepth(6);

    // The local player's rectangle and name tag. setDepth() controls draw order —
    // higher values appear on top. Player (10) is above enemies (8) and floor (0).
    this.myBody = this.add.rectangle(R.CX, R.CY, 30, 30, 0x3498db).setDepth(10);
    this.myLabel = this.add.text(R.CX, R.CY - 22, '', {
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
    this.kW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.kA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.kS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.kD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
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
    // Every server broadcast triggers applyState, which syncs all sprites.
    this.game.events.on('stateUpdate', (s: GameState)  => this.applyState(s));

    // The canvas must be focused for keyboard events to fire.
    // tabindex='0' makes a non-focusable element focusable.
    this.game.canvas.setAttribute('tabindex', '0');
    this.game.canvas.focus();
  }

  // ── Phaser lifecycle: update ───────────────────────────────────────────────

  // Called every frame. delta is milliseconds since the last frame (~16ms at 60fps).
  // All movement uses delta-time so the game speed is framerate-independent.
  update(_time: number, delta: number) {
    this.move(delta);
    this.sendPos(_time);
    this.handleInput();
    this.drawHpBars();
    this.drawAim();
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  // Move the local player based on which WASD keys are held down.
  // Movement is split per-axis so the player slides along walls instead of
  // sticking when one axis is blocked but the other is free.
  private move(delta: number) {
    const s = this.SPEED * (delta / 1000);  // convert to pixels this frame
    let dx = 0, dy = 0;
    if (this.kW.isDown) dy -= s;
    if (this.kS.isDown) dy += s;
    if (this.kA.isDown) dx -= s;
    if (this.kD.isDown) dx += s;

    // Normalise diagonal movement so moving at 45° isn't faster than cardinal.
    // 0.707 ≈ 1/√2 — the length of a unit diagonal vector.
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

    // Move all objects that track the player's position.
    this.myBody.setPosition(this.localX, this.localY);
    this.myLabel.setPosition(this.localX, this.localY - 22);
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

  // Check for one-shot key presses (JustDown = true only on the frame the key
  // goes from up to down, not while held). This prevents holding SPACE from
  // spamming attacks faster than the server cooldown allows.
  private handleInput() {
    if (!this.engine || !this.state) return;

    if (Phaser.Input.Keyboard.JustDown(this.kSpace)) {
      const ptr = this.input.activePointer;
      const dx = ptr.worldX - this.localX;
      const dy = ptr.worldY - this.localY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dist > 0 ? dx / dist : 0;
      const ny = dist > 0 ? dy / dist : -1;

      if (this.myHeroClass === 'Warrior') {
        // Warrior uses nearest-target so the attack reliably hits the closest enemy
        // regardless of exact cursor angle — removes the "missed cone" confusion.
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
      if (!me?.canUseAbility) return;  // not enough resource — skip animation and server call
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

  // ── State update from server ──────────────────────────────────────────────

  // Called every time the server sends a GameStateUpdate message.
  // We reconcile the server snapshot with the current Phaser objects:
  // create new sprites for new entities, update existing ones, destroy removed ones.
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

    // Check for HP drops before overwriting this.state so we can compare old vs new.
    this.showSkeletonProjectiles(s);

    this.state = s;

    // Tint the local player's rectangle to match their hero class.
    // Turn grey if dead so the player can see they're out of the fight.
    const me = s.players.find(p => p.userId === this.myUserId);
    if (me) {
      this.myHeroClass = me.heroClass;
      const col = CLASS_COLOR[me.heroClass] ?? 0x3498db;
      this.myBody.setFillStyle(me.isAlive ? col : 0x555555);
    }

    // Sync other players: create sprites for new arrivals, update positions,
    // destroy sprites for players who disconnected.
    const myId = this.myUserId;
    for (const p of s.players.filter(pl => pl.userId !== myId)) {
      this.syncOther(p);
    }
    for (const [id] of this.others) {
      if (!s.players.some(p => p.userId === id)) this.destroyOther(id);
    }

    // Sync enemies: create sprites for new enemies, update positions and
    // play death animations, destroy sprites no longer in the room.
    for (const e of s.currentRoom.enemies) this.syncEnemy(e);
    for (const [id] of this.enemySprites) {
      if (!s.currentRoom.enemies.some(e => e.id === id)) this.destroyEnemy(id);
    }
  }

  // Create or update the sprite for another player (not the local user).
  private syncOther(p: PlayerState) {
    let sp = this.others.get(p.userId);
    if (!sp) {
      // First time seeing this player — create their rectangle and name tag.
      const col = CLASS_COLOR[p.heroClass] ?? 0xffffff;
      const body = this.add.rectangle(p.x, p.y, 28, 28, col).setDepth(9).setAlpha(0.85);
      const label = this.add.text(p.x, p.y - 20, p.username, {
        fontFamily: 'Courier New', fontSize: '10px', color: '#cccccc',
      }).setOrigin(0.5, 1).setDepth(10);
      sp = { body, label };
      this.others.set(p.userId, sp);
    }
    // Move to their latest server position and dim if dead.
    sp.body.setPosition(p.x, p.y).setAlpha(p.isAlive ? 0.85 : 0.25);
    sp.label.setPosition(p.x, p.y - 20);
  }

  // Create or update the sprite for one enemy.
  private syncEnemy(e: EnemyState) {
    let sp = this.enemySprites.get(e.id);
    if (!sp) {
      // Bosses are larger (40px vs 28px) so they stand out visually.
      const isBoss = BOSS_NAMES.has(e.name);
      const size = isBoss ? 40 : 28;
      const col = ENEMY_COLOR[e.name] ?? 0xff4444;
      const body = this.add.rectangle(e.x, e.y, size, size, col).setDepth(8);
      const label = this.add.text(e.x, e.y - (size / 2 + 6), e.name, {
        fontFamily: 'Courier New', fontSize: '9px', color: '#dddddd',
      }).setOrigin(0.5, 1).setDepth(9);
      // prevHp tracks the last known HP so we can detect when the enemy was hit.
      sp = { body, label, prevHp: e.health, dead: false };
      this.enemySprites.set(e.id, sp);
    }

    if (!e.isAlive && !sp.dead) {
      // Play death animation: fade out and rotate 90° over 350ms.
      // The onComplete callback hides the object after the tween finishes
      // (destroyed properly in destroyEnemy when the server stops sending it).
      sp.dead = true;
      this.tweens.add({
        targets: [sp.body, sp.label],
        alpha: 0, angle: 90, duration: 350,
        onComplete: () => { sp!.body.setVisible(false); sp!.label.setVisible(false); },
      });
    } else if (e.isAlive) {
      // Move to latest server position.
      sp.body.setPosition(e.x, e.y);
      sp.label.setPosition(e.x, e.y - (sp.body.height / 2 + 6));

      // Flash the sprite when health decreases — gives hit feedback without sounds.
      if (e.health < sp.prevHp) {
        this.tweens.add({
          targets: sp.body, alpha: 0.2, duration: 80, yoyo: true, repeat: 1,
          onComplete: () => sp!.body.setAlpha(1),
        });
      }
    }
    sp.prevHp = e.health;
  }

  // ── HP bar rendering (drawn every frame) ──────────────────────────────────

  // HP bars are drawn imperatively with a Graphics object rather than as
  // individual sprites, because their size changes every frame and using
  // separate objects for every bar would be more complex to manage.
  private drawHpBars() {
    // clear() wipes everything drawn last frame — we redraw from scratch each tick.
    this.hpBars.clear();
    if (!this.state) return;

    // Draw the local player's HP bar above their sprite.
    const me = this.state.players.find(p => p.userId === this.myUserId);
    if (me) this.drawBar(this.localX, this.localY, me.currentHp, me.maxHp, 0x2ecc71);

    // Draw HP bars for every other player.
    for (const [id, sp] of this.others) {
      const p = this.state.players.find(pl => pl.userId === id);
      if (p && p.isAlive) this.drawBar(sp.body.x, sp.body.y, p.currentHp, p.maxHp, 0x2ecc71);
    }

    // Draw HP bars above each enemy. Width matches the enemy rectangle width.
    for (const [id, sp] of this.enemySprites) {
      if (sp.dead) continue;
      const e = this.state.currentRoom.enemies.find(en => en.id === id);
      if (e && e.isAlive) this.drawBar(sp.body.x, sp.body.y - sp.body.height / 2 - 8, e.health, e.maxHealth, 0xe74c3c, sp.body.width);
    }
  }

  // Draw one HP bar: dark background, then colored fill proportional to hp/max.
  private drawBar(x: number, y: number, hp: number, max: number, color: number, width = 32) {
    if (max <= 0) return;
    const bx = x - width / 2, by = y - 20;
    const pct = Math.max(0, hp / max);     // clamp so bar never overflows
    this.hpBars.fillStyle(0x222222);
    this.hpBars.fillRect(bx, by, width, 5);
    this.hpBars.fillStyle(color);
    this.hpBars.fillRect(bx, by, width * pct, 5);
  }

  // ── Room drawing ──────────────────────────────────────────────────────────

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

  // ── Visual effects ────────────────────────────────────────────────────────

  // Class-aware attack visual triggered immediately on SPACE press.
  // nx/ny is the normalised aim direction; aimDist is how far the effect travels.
  // This runs client-side for responsiveness — the server confirms actual hits.
  private flashAttack(nx: number, ny: number, aimDist: number) {
    const endX = this.localX + nx * aimDist;
    const endY = this.localY + ny * aimDist;

    if (this.myHeroClass === 'Warrior') {
      // Filled 90° cone in the aim direction — matches the server's ±45° hit zone.
      const atkAngle = Math.atan2(ny, nx);
      const half = Math.PI / 4;
      const g = this.add.graphics().setDepth(15);
      g.fillStyle(0xc9a84c, 0.45);
      g.beginPath();
      g.moveTo(this.localX, this.localY);
      g.arc(this.localX, this.localY, ATTACK_RANGE, atkAngle - half, atkAngle + half, false);
      g.closePath();
      g.fillPath();
      this.tweens.add({
        targets: g, alpha: 0, duration: 250,
        onComplete: () => g.destroy(),
      });
    } else if (this.myHeroClass === 'Archer') {
      // Thin green rectangle that flies toward the cursor — arrow in flight.
      const arrow = this.add.rectangle(this.localX, this.localY, 16, 3, 0x27ae60).setDepth(15);
      arrow.rotation = Math.atan2(ny, nx);
      this.tweens.add({
        targets: arrow, x: endX, y: endY, duration: 220,
        onComplete: () => arrow.destroy(),
      });
    } else if (this.myHeroClass === 'Wizard') {
      // Purple orb that drifts toward the cursor — slower than an arrow.
      const orb = this.add.arc(this.localX, this.localY, 9, 0, 360, false, 0x8e44ad, 0.9).setDepth(15);
      this.tweens.add({
        targets: orb, x: endX, y: endY, duration: 420, alpha: 0.15,
        onComplete: () => orb.destroy(),
      });
    }
  }

  // Class-specific Q ability visual triggered immediately on Q press.
  // Replicates the server's FindRayTarget logic to predict where the fireball will hit.
  // Returns the impact point so the orb animation can stop and explode there.
  private findFireballImpact(nx: number, ny: number): { x: number; y: number } {
    const range    = CLASS_RANGE['Wizard'];
    const hitRadius = HIT_RADIUS['Wizard'] ?? 28;
    let bestT = range;

    if (this.state) {
      for (const e of this.state.currentRoom.enemies) {
        if (!e.isAlive) continue;
        const ex = e.x - this.localX;
        const ey = e.y - this.localY;
        const t  = ex * nx + ey * ny;
        if (t < 0 || t >= bestT) continue;
        const cx = this.localX + nx * t;
        const cy = this.localY + ny * t;
        const perp = Math.sqrt((cx - e.x) ** 2 + (cy - e.y) ** 2);
        if (perp <= hitRadius) bestT = t;
      }
    }

    return { x: this.localX + nx * bestT, y: this.localY + ny * bestT };
  }

  private flashAbility(nx: number, ny: number) {
    if (this.myHeroClass === 'Warrior') {
      // Shield Block: expanding golden ring — communicates a defensive stance.
      const ring = this.add.arc(this.localX, this.localY, 22, 0, 360, false, 0xc9a84c, 0.75).setDepth(15);
      this.tweens.add({
        targets: ring, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 420,
        onComplete: () => ring.destroy(),
      });
    } else if (this.myHeroClass === 'Archer') {
      // Multi-Shot: three arrows in a ±15° spread — must match server logic.
      const centerAngle = Math.atan2(ny, nx);
      const spread = Math.PI / 12;
      const range  = CLASS_RANGE['Archer'];
      [-spread, 0, spread].forEach(offset => {
        const angle = centerAngle + offset;
        const adx = Math.cos(angle);
        const ady = Math.sin(angle);
        const arrow = this.add.rectangle(this.localX, this.localY, 18, 3, 0x27ae60).setDepth(15);
        arrow.rotation = angle;
        this.tweens.add({
          targets: arrow, x: this.localX + adx * range, y: this.localY + ady * range,
          duration: 210,
          onComplete: () => arrow.destroy(),
        });
      });
    } else if (this.myHeroClass === 'Wizard') {
      // Fireball: orb travels toward the first enemy on the ray, bursts on impact.
      // Client-side ray-cast mirrors server logic so the explosion lands on the target.
      const { x: impactX, y: impactY } = this.findFireballImpact(nx, ny);
      const dx = impactX - this.localX;
      const dy = impactY - this.localY;
      const travelDist = Math.sqrt(dx * dx + dy * dy);
      const duration = Math.max(120, (travelDist / CLASS_RANGE['Wizard']) * 480);
      const orb = this.add.arc(this.localX, this.localY, 11, 0, 360, false, 0xe67e22, 0.95).setDepth(15);
      this.tweens.add({
        targets: orb, x: impactX, y: impactY, duration,
        onComplete: () => {
          orb.destroy();
          const burst = this.add.arc(impactX, impactY, 12, 0, 360, false, 0xe67e22, 0.7).setDepth(15);
          this.tweens.add({
            targets: burst, scaleX: 7, scaleY: 7, alpha: 0, duration: 300,
            onComplete: () => burst.destroy(),
          });
        },
      });
    }
  }

  // Redraws the directional aim indicator every frame based on current mouse position.
  // Warrior: a 90° cone (two lines + arc) showing the melee swing sector.
  // Archer/Wizard: a thin aim line toward the cursor with a hit-box circle at the tip.
  private drawAim() {
    this.aimGraphics.clear();
    if (!this.myHeroClass || !this.state) return;

    const me = this.state.players.find(p => p.userId === this.myUserId);
    if (!me || !me.isAlive) return;

    const ptr = this.input.activePointer;
    const dx = ptr.worldX - this.localX;
    const dy = ptr.worldY - this.localY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;

    const nx = dx / dist;
    const ny = dy / dist;

    if (this.myHeroClass === 'Warrior') {
      const range = ATTACK_RANGE;
      const half = Math.PI / 4;  // 45°
      const angle = Math.atan2(ny, nx);
      const a1 = angle - half;
      const a2 = angle + half;

      this.aimGraphics.lineStyle(1.5, 0xc9a84c, 0.55);
      // Two lines from player forming the cone edges.
      this.aimGraphics.lineBetween(
        this.localX, this.localY,
        this.localX + Math.cos(a1) * range, this.localY + Math.sin(a1) * range,
      );
      this.aimGraphics.lineBetween(
        this.localX, this.localY,
        this.localX + Math.cos(a2) * range, this.localY + Math.sin(a2) * range,
      );
      // Arc closing the cone tip.
      this.aimGraphics.beginPath();
      this.aimGraphics.arc(this.localX, this.localY, range, a1, a2, false);
      this.aimGraphics.strokePath();
    } else {
      const range = CLASS_RANGE[this.myHeroClass] ?? 600;
      const hitR  = HIT_RADIUS[this.myHeroClass] ?? 16;
      const endX  = this.localX + nx * range;
      const endY  = this.localY + ny * range;

      this.aimGraphics.lineStyle(1, 0xc9a84c, 0.35);
      this.aimGraphics.lineBetween(this.localX, this.localY, endX, endY);
      // Small circle at the tip representing the projectile hit-box size.
      this.aimGraphics.strokeCircle(endX, endY, hitR);
    }
  }

  // Animate a bone projectile from any alive Skeleton that is in attack range of
  // a player whose HP just dropped. Called before this.state is updated so we can
  // compare the incoming snapshot against the previous one.
  private showSkeletonProjectiles(s: GameState) {
    const skeletons = s.currentRoom.enemies.filter(e => e.name === 'Skeleton' && e.isAlive);
    if (!skeletons.length) return;

    for (const player of s.players) {
      const prevHp = this.prevPlayerHp.get(player.userId) ?? player.currentHp;
      this.prevPlayerHp.set(player.userId, player.currentHp);

      if (!player.isAlive || player.currentHp >= prevHp) continue;

      // Resolve where the player is on screen.
      const targetX = player.userId === this.myUserId
        ? this.localX
        : (this.others.get(player.userId)?.body.x ?? player.x);
      const targetY = player.userId === this.myUserId
        ? this.localY
        : (this.others.get(player.userId)?.body.y ?? player.y);

      // Fire a visual projectile from every skeleton within shooting range.
      for (const sk of skeletons) {
        const dx = targetX - sk.x;
        const dy = targetY - sk.y;
        if (dx * dx + dy * dy > 260 * 260) continue;  // slightly beyond ProjectileRange
        const proj = this.add.arc(sk.x, sk.y, 5, 0, 360, false, 0xbdc3c7, 0.9).setDepth(15);
        this.tweens.add({
          targets: proj, x: targetX, y: targetY, duration: 280,
          onComplete: () => proj.destroy(),
        });
      }
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  // Removes all enemy sprites from the scene (called on room transition).
  private clearEnemies() {
    for (const [id] of this.enemySprites) this.destroyEnemy(id);
  }

  // Destroys a single enemy's Phaser game objects and removes them from the Map.
  private destroyEnemy(id: string) {
    const sp = this.enemySprites.get(id);
    if (sp) { sp.body.destroy(); sp.label.destroy(); }
    this.enemySprites.delete(id);
  }

  // Destroys another player's sprites (called when they disconnect).
  private destroyOther(id: string) {
    const sp = this.others.get(id);
    if (sp) { sp.body.destroy(); sp.label.destroy(); }
    this.others.delete(id);
  }
}
