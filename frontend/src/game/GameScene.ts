import Phaser from 'phaser';
import type { GameState, EnemyState, PlayerState } from '../types/gameTypes';
import type { GameEngine } from './gameEngine';

// Room bounds — must match RoomBounds.cs on the server
const R = { L: 48, R: 912, T: 48, B: 592, W: 864, H: 544, CX: 480, CY: 320 };
const ATTACK_RANGE = 120;
const TILE = 64;

const CLASS_COLOR: Record<string, number> = {
  Warrior: 0xe74c3c,
  Wizard:  0x8e44ad,
  Archer:  0x27ae60,
};
const ENEMY_COLOR: Record<string, number> = {
  Skeleton:          0xbdc3c7,
  Goblin:            0x2ecc71,
  Spider:            0x6c3483,
  'Bone Titan':      0xe74c3c,
  'Ancient Colossus':0xe74c3c,
  'Dungeon Overlord':0xff0000,
};
const BOSS_NAMES = new Set(['Bone Titan', 'Ancient Colossus', 'Dungeon Overlord']);

interface EntitySprites {
  body: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  // External refs
  private engine: GameEngine | null = null;
  private myUserId = '';
  private myUsername = '';

  // State
  private state: GameState | null = null;
  private lastRoomIndex = -1;

  // Local player
  private localX = R.CX;
  private localY = R.CY;
  private readonly SPEED = 220;
  private lastPosSent = 0;

  // Sprites
  private myBody!: Phaser.GameObjects.Rectangle;
  private myLabel!: Phaser.GameObjects.Text;
  private rangeCircle!: Phaser.GameObjects.Arc;
  private hpBars!: Phaser.GameObjects.Graphics;

  private others = new Map<string, EntitySprites>();
  private enemySprites = new Map<string, EntitySprites & { prevHp: number; dead: boolean }>();

  // Input
  private kW!: Phaser.Input.Keyboard.Key;
  private kA!: Phaser.Input.Keyboard.Key;
  private kS!: Phaser.Input.Keyboard.Key;
  private kD!: Phaser.Input.Keyboard.Key;
  private kSpace!: Phaser.Input.Keyboard.Key;
  private kQ!: Phaser.Input.Keyboard.Key;

  constructor() { super({ key: 'GameScene' }); }

  create() {
    this.drawRoom();

    // Shared HP bar graphics layer
    this.hpBars = this.add.graphics().setDepth(20);

    // Attack range indicator
    this.rangeCircle = this.add.arc(R.CX, R.CY, ATTACK_RANGE, 0, 360, false, 0xc9a84c, 0.07).setDepth(5);

    // My sprite
    this.myBody = this.add.rectangle(R.CX, R.CY, 30, 30, 0x3498db).setDepth(10);
    this.myLabel = this.add.text(R.CX, R.CY - 22, '', {
      fontFamily: 'Courier New', fontSize: '10px', color: '#ffffff',
    }).setOrigin(0.5, 1).setDepth(11);

    // Keys
    const kb = this.input.keyboard!;
    this.kW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.kA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.kS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.kD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.kSpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.kQ = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    // Wire external references from React
    this.game.events.on('setEngine',   (e: GameEngine) => { this.engine = e; });
    this.game.events.on('setUserId',   (id: string)    => { this.myUserId = id; });
    this.game.events.on('setUsername', (n: string)     => {
      this.myUsername = n;
      this.myLabel.setText(n);
    });
    this.game.events.on('stateUpdate', (s: GameState)  => this.applyState(s));

    // Focus canvas for keyboard capture
    this.game.canvas.setAttribute('tabindex', '0');
    this.game.canvas.focus();
  }

  update(_time: number, delta: number) {
    this.move(delta);
    this.sendPos(_time);
    this.handleInput();
    this.drawHpBars();
  }

  // ── Input ─────────────────────────────────────────────────────────────────

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
    this.myBody.setPosition(this.localX, this.localY);
    this.myLabel.setPosition(this.localX, this.localY - 22);
    this.rangeCircle.setPosition(this.localX, this.localY);
  }

  private sendPos(time: number) {
    if (time - this.lastPosSent > 50 && this.engine) {
      this.engine.sendPosition(this.localX, this.localY);
      this.lastPosSent = time;
    }
  }

  private handleInput() {
    if (!this.engine || !this.state) return;
    if (Phaser.Input.Keyboard.JustDown(this.kSpace)) {
      this.engine.attackNearest();
      this.flashAttack();
    }
    if (Phaser.Input.Keyboard.JustDown(this.kQ)) {
      this.engine.useAbility();
    }
  }

  // ── State update from server ──────────────────────────────────────────────

  private applyState(s: GameState) {
    // Room changed → clear enemy sprites and reset position
    if (s.currentRoomIndex !== this.lastRoomIndex) {
      this.lastRoomIndex = s.currentRoomIndex;
      this.clearEnemies();
      const me = s.players.find(p => p.userId === this.myUserId);
      if (me) { this.localX = me.x; this.localY = me.y; }
    }

    this.state = s;

    // Update my hero color based on class
    const me = s.players.find(p => p.userId === this.myUserId);
    if (me) {
      const col = CLASS_COLOR[me.heroClass] ?? 0x3498db;
      this.myBody.setFillStyle(me.isAlive ? col : 0x555555);
    }

    // Sync other players
    const myId = this.myUserId;
    for (const p of s.players.filter(pl => pl.userId !== myId)) {
      this.syncOther(p);
    }
    // Remove gone players
    for (const [id] of this.others) {
      if (!s.players.some(p => p.userId === id)) this.destroyOther(id);
    }

    // Sync enemies
    for (const e of s.currentRoom.enemies) this.syncEnemy(e);
    for (const [id] of this.enemySprites) {
      if (!s.currentRoom.enemies.some(e => e.id === id)) this.destroyEnemy(id);
    }
  }

  private syncOther(p: PlayerState) {
    let sp = this.others.get(p.userId);
    if (!sp) {
      const col = CLASS_COLOR[p.heroClass] ?? 0xffffff;
      const body = this.add.rectangle(p.x, p.y, 28, 28, col).setDepth(9).setAlpha(0.85);
      const label = this.add.text(p.x, p.y - 20, p.username, {
        fontFamily: 'Courier New', fontSize: '10px', color: '#cccccc',
      }).setOrigin(0.5, 1).setDepth(10);
      sp = { body, label };
      this.others.set(p.userId, sp);
    }
    sp.body.setPosition(p.x, p.y).setAlpha(p.isAlive ? 0.85 : 0.25);
    sp.label.setPosition(p.x, p.y - 20);
  }

  private syncEnemy(e: EnemyState) {
    let sp = this.enemySprites.get(e.id);
    if (!sp) {
      const isBoss = BOSS_NAMES.has(e.name);
      const size = isBoss ? 40 : 28;
      const col = ENEMY_COLOR[e.name] ?? 0xff4444;
      const body = this.add.rectangle(e.x, e.y, size, size, col).setDepth(8);
      const label = this.add.text(e.x, e.y - (size / 2 + 6), e.name, {
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

      // Flash red on damage
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

  private drawHpBars() {
    this.hpBars.clear();
    if (!this.state) return;

    // My bar
    const me = this.state.players.find(p => p.userId === this.myUserId);
    if (me) this.drawBar(this.localX, this.localY, me.currentHp, me.maxHp, 0x2ecc71);

    // Others
    for (const [id, sp] of this.others) {
      const p = this.state.players.find(pl => pl.userId === id);
      if (p && p.isAlive) this.drawBar(sp.body.x, sp.body.y, p.currentHp, p.maxHp, 0x2ecc71);
    }

    // Enemies
    for (const [id, sp] of this.enemySprites) {
      if (sp.dead) continue;
      const e = this.state.currentRoom.enemies.find(en => en.id === id);
      if (e && e.isAlive) this.drawBar(sp.body.x, sp.body.y - sp.body.height / 2 - 8, e.health, e.maxHealth, 0xe74c3c, sp.body.width);
    }
  }

  private drawBar(x: number, y: number, hp: number, max: number, color: number, width = 32) {
    if (max <= 0) return;
    const bx = x - width / 2, by = y - 20;
    const pct = Math.max(0, hp / max);
    this.hpBars.fillStyle(0x222222);
    this.hpBars.fillRect(bx, by, width, 5);
    this.hpBars.fillStyle(color);
    this.hpBars.fillRect(bx, by, width * pct, 5);
  }

  // ── Room drawing ──────────────────────────────────────────────────────────

  private drawRoom() {
    const g = this.add.graphics().setDepth(0);

    // Walls (background)
    g.fillStyle(0x0d0b08);
    g.fillRect(0, 0, 960, 640);

    // Floor tiles (checkerboard)
    for (let tx = R.L; tx < R.R; tx += TILE) {
      for (let ty = R.T; ty < R.B; ty += TILE) {
        const w = Math.min(TILE, R.R - tx);
        const h = Math.min(TILE, R.B - ty);
        const even = (Math.floor((tx - R.L) / TILE) + Math.floor((ty - R.T) / TILE)) % 2 === 0;
        g.fillStyle(even ? 0x2a1f14 : 0x231a10);
        g.fillRect(tx, ty, w, h);
      }
    }

    // Wall border (gold, subtle)
    g.lineStyle(2, 0xc9a84c, 0.3);
    g.strokeRect(R.L, R.T, R.W, R.H);
    g.lineStyle(1, 0xc9a84c, 0.1);
    g.strokeRect(R.L + 4, R.T + 4, R.W - 8, R.H - 8);
  }

  // ── Visual effects ────────────────────────────────────────────────────────

  private flashAttack() {
    const ring = this.add.arc(this.localX, this.localY, ATTACK_RANGE * 0.6, 0, 360, false, 0xc9a84c, 0.4).setDepth(15);
    this.tweens.add({
      targets: ring, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 250,
      onComplete: () => ring.destroy(),
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

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
    if (sp) { sp.body.destroy(); sp.label.destroy(); }
    this.others.delete(id);
  }
}
