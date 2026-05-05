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

// Room bounds — pixel coordinates that must match RoomBounds.cs on the server.
// The canvas is 960 × 640; the playable room area is inset by 48px on each side.
// R.CX / R.CY is the center of the room where players spawn.
const R = { L: 48, R: 912, T: 48, B: 592, W: 864, H: 544, CX: 480, CY: 320 };

// Warrior melee attack range (px).
const ATTACK_RANGE = 120;

// Per-class attack ranges — must match RoomBounds.cs on the server.
const CLASS_RANGE: Record<string, number> = { Warrior: 120, Archer: 600, Wizard: 800 };

// Projectile hit-box radii shown on the aim line indicator.
const HIT_RADIUS: Record<string, number> = { Archer: 16, Wizard: 28 };

// Tile size for the checkerboard floor pattern.
const TILE = 64;

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
  // Semi-transparent circle that shows the player's attack range visually.
  private rangeCircle!: Phaser.GameObjects.Arc;
  // Single shared Graphics object redrawn every frame for all HP bars.
  private hpBars!: Phaser.GameObjects.Graphics;

  // Maps from userId / enemy-id to sprite objects.
  // Using a Map lets us add/remove individual sprites when players join/leave
  // or enemies are defeated, without rebuilding the entire scene.
  private others = new Map<string, EntitySprites>();
  private enemySprites = new Map<string, EntitySprites & { prevHp: number; dead: boolean }>();

  // Hero class of the local player — set from state updates, used for aim visuals.
  private myHeroClass = '';

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

  // ── Phaser lifecycle: create ───────────────────────────────────────────────

  // Called once when the scene starts. We draw the room, create sprites,
  // register input, and start listening for events from React.
  create() {
    this.drawRoom();

    // HP bars use a shared Graphics object. Every frame we clear() it and
    // redraw all bars from scratch — simpler than updating many individual objects.
    this.hpBars = this.add.graphics().setDepth(20);

    // Aim indicator redrawn each frame — shows cone (Warrior) or aim line (Archer/Wizard).
    this.aimGraphics = this.add.graphics().setDepth(6);

    // Faint gold circle centered on the player — only visible for Warrior (melee range hint).
    // Hidden by default; applyState() shows it once hero class is known.
    this.rangeCircle = this.add.arc(R.CX, R.CY, ATTACK_RANGE, 0, 360, false, 0xc9a84c, 0.07).setDepth(5).setVisible(false);

    // The local player's rectangle and name tag. setDepth() controls draw order —
    // higher values appear on top. Player (10) is above enemies (8) and floor (0).
    this.myBody = this.add.rectangle(R.CX, R.CY, 30, 30, 0x3498db).setDepth(10);
    this.myLabel = this.add.text(R.CX, R.CY - 22, '', {
      fontFamily: 'Courier New', fontSize: '10px', color: '#ffffff',
    }).setOrigin(0.5, 1).setDepth(11);

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
    this.game.events.on('setUserId',   (id: string)    => { this.myUserId = id; });
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

    // Clamp to keep the player inside the room walls.
    this.localX = Phaser.Math.Clamp(this.localX + dx, R.L + 16, R.R - 16);
    this.localY = Phaser.Math.Clamp(this.localY + dy, R.T + 16, R.B - 16);

    // Move all objects that track the player's position.
    this.myBody.setPosition(this.localX, this.localY);
    this.myLabel.setPosition(this.localX, this.localY - 22);
    this.rangeCircle.setPosition(this.localX, this.localY);
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
      if (dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const maxRange = CLASS_RANGE[this.myHeroClass] ?? ATTACK_RANGE;
        // Travel to cursor position, capped at class max range.
        const aimDist = Math.min(dist, maxRange);
        this.engine.attackDirectional(nx, ny);
        this.flashAttack(nx, ny, aimDist);
      }
    }
    if (Phaser.Input.Keyboard.JustDown(this.kQ)) {
      this.engine.useAbility();
    }
  }

  // ── State update from server ──────────────────────────────────────────────

  // Called every time the server sends a GameStateUpdate message.
  // We reconcile the server snapshot with the current Phaser objects:
  // create new sprites for new entities, update existing ones, destroy removed ones.
  private applyState(s: GameState) {
    // Room changed → destroy all enemy sprites and snap player to their new spawn.
    // The server teleports players to spawn points when MoveToNextRoom is called.
    if (s.currentRoomIndex !== this.lastRoomIndex) {
      this.lastRoomIndex = s.currentRoomIndex;
      this.clearEnemies();
      const me = s.players.find(p => p.userId === this.myUserId);
      if (me) { this.localX = me.x; this.localY = me.y; }
    }

    this.state = s;

    // Tint the local player's rectangle to match their hero class.
    // Turn grey if dead so the player can see they're out of the fight.
    const me = s.players.find(p => p.userId === this.myUserId);
    if (me) {
      this.myHeroClass = me.heroClass;
      const col = CLASS_COLOR[me.heroClass] ?? 0x3498db;
      this.myBody.setFillStyle(me.isAlive ? col : 0x555555);
      // Range circle only makes sense for Warrior (melee) — ranged classes get the aim line.
      this.rangeCircle.setVisible(me.heroClass === 'Warrior' && me.isAlive);
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

  // Draws the static dungeon room background once during create().
  // Uses a checkerboard pattern to give the floor visual texture without
  // needing any image assets.
  private drawRoom() {
    const g = this.add.graphics().setDepth(0);

    // Dark outer area (walls outside the playable room).
    g.fillStyle(0x0d0b08);
    g.fillRect(0, 0, 960, 640);

    // Checkerboard floor tiles. Two slightly different dark shades alternate
    // based on whether the column+row index sum is even or odd.
    for (let tx = R.L; tx < R.R; tx += TILE) {
      for (let ty = R.T; ty < R.B; ty += TILE) {
        const w = Math.min(TILE, R.R - tx);
        const h = Math.min(TILE, R.B - ty);
        const even = (Math.floor((tx - R.L) / TILE) + Math.floor((ty - R.T) / TILE)) % 2 === 0;
        g.fillStyle(even ? 0x2a1f14 : 0x231a10);
        g.fillRect(tx, ty, w, h);
      }
    }

    // Gold border around the playable area — drawn at low opacity so it's
    // visible but doesn't distract from the action.
    g.lineStyle(2, 0xc9a84c, 0.3);
    g.strokeRect(R.L, R.T, R.W, R.H);
    g.lineStyle(1, 0xc9a84c, 0.1);
    g.strokeRect(R.L + 4, R.T + 4, R.W - 8, R.H - 8);
  }

  // ── Visual effects ────────────────────────────────────────────────────────

  // Class-aware attack visual triggered immediately on SPACE press.
  // nx/ny is the normalised aim direction; aimDist is how far the effect travels.
  // This runs client-side for responsiveness — the server confirms actual hits.
  private flashAttack(nx: number, ny: number, aimDist: number) {
    const endX = this.localX + nx * aimDist;
    const endY = this.localY + ny * aimDist;

    if (this.myHeroClass === 'Warrior') {
      // Expanding golden arc — communicates a melee swing without a projectile.
      const ring = this.add.arc(this.localX, this.localY, ATTACK_RANGE * 0.6, 0, 360, false, 0xc9a84c, 0.4).setDepth(15);
      this.tweens.add({
        targets: ring, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 250,
        onComplete: () => ring.destroy(),
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
