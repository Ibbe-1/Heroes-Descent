import Phaser from 'phaser';

export class PreloadScene extends Phaser.Scene {
  constructor() { super({ key: 'PreloadScene' }); }

  preload() {
    const W = this.scale.width;
    const H = this.scale.height;

    // ── Loading screen UI ──────────────────────────────────────────────────────

    this.add.rectangle(W / 2, H / 2, W, H, 0x07070d);

    this.add.text(W / 2, H / 2 - 90, 'HEROES DESCENT', {
      fontFamily: "'Courier New', monospace",
      fontSize: '30px',
      color: '#c9a84c',
      letterSpacing: 10,
    }).setOrigin(0.5);

    // Decorative separator
    this.add.text(W / 2, H / 2 - 54, '────────────────────────────────', {
      fontFamily: "'Courier New', monospace",
      fontSize: '10px',
      color: 'rgba(201,168,76,0.3)',
    }).setOrigin(0.5);

    const statusText = this.add.text(W / 2, H / 2 - 34, 'Loading assets...', {
      fontFamily: "'Courier New', monospace",
      fontSize: '11px',
      color: 'rgba(201,168,76,0.55)',
      letterSpacing: 2,
    }).setOrigin(0.5);

    const barW = 420;
    const barH = 16;
    const barX = W / 2 - barW / 2;
    const barY = H / 2 + 4;

    // Bar border
    const border = this.add.graphics();
    border.lineStyle(1, 0xc9a84c, 0.4);
    border.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

    // Bar background
    this.add.graphics().fillStyle(0xffffff, 0.03).fillRect(barX, barY, barW, barH);

    // Bar fill
    const fill = this.add.graphics();

    const pctText = this.add.text(W / 2, barY + barH + 14, '0%', {
      fontFamily: "'Courier New', monospace",
      fontSize: '10px',
      color: 'rgba(201,168,76,0.5)',
      letterSpacing: 3,
    }).setOrigin(0.5);

    this.load.on('fileprogress', (file: Phaser.Loader.File) => {
      statusText.setText(file.key);
    });

    this.load.on('progress', (value: number) => {
      fill.clear();
      fill.fillStyle(0xc9a84c, 0.75);
      fill.fillRect(barX, barY, barW * value, barH);
      pctText.setText(`${Math.floor(value * 100)}%`);
    });

    // ── Asset loading ──────────────────────────────────────────────────────────

    // Background images
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

    // Shop NPCs
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
    this.load.spritesheet('boss-fireball', '/assets/Darkmage/Fireball.png', { frameWidth: 32, frameHeight: 32 });

    // Golem Elite MiniBoss
    this.load.spritesheet('golem-sheet',      '/assets/Golem/Mecha-stone Golem 0.1/PNG sheet/Character_sheet.png',         { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('golem-projectile', '/assets/Golem/Mecha-stone Golem 0.1/weapon PNG/arm_projectile_glowing.png', { frameWidth: 100, frameHeight: 100 });
    this.load.spritesheet('golem-laser',      '/assets/Golem/Mecha-stone Golem 0.1/weapon PNG/Laser_sheet.png',            { frameWidth: 300, frameHeight: 100 });

    // Goblin — 150×150 frames
    this.load.spritesheet('goblin-attack', '/assets/Goblin/Attack3.png',     { frameWidth: 150, frameHeight: 150 });
    this.load.spritesheet('goblin-bomb',   '/assets/Goblin/Bomb_sprite.png', { frameWidth: 100, frameHeight: 100 });

    // Skeleton — 150×150 body frames, 92×102 sword projectile frames
    this.load.spritesheet('skeleton-attack', '/assets/Skeleton/Attack3.png',      { frameWidth: 150, frameHeight: 150 });
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
    this.load.spritesheet('mushroom-attack',     '/assets/Mushroom/Attack3.png',           { frameWidth: 150, frameHeight: 150 });
    this.load.spritesheet('mushroom-projectile', '/assets/Mushroom/Projectile_sprite.png', { frameWidth: 50,  frameHeight: 50  });

    // Mimic — 146×146 frames
    this.load.spritesheet('mimic-idle-closed',     '/assets/Mimic/Idle_closed.png',      { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-opening',         '/assets/Mimic/opening.png',          { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-idle-open',       '/assets/Mimic/idle_open.png',        { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-transform',       '/assets/Mimic/transform.png',        { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-idle-transformed','/assets/Mimic/idle_transformed.png', { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-walk',            '/assets/Mimic/walk.png',             { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-attack-1',        '/assets/Mimic/attack_1.png',         { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-attack-2',        '/assets/Mimic/attack_2.png',         { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-hurt',            '/assets/Mimic/hurt.png',             { frameWidth: 146, frameHeight: 146 });
    this.load.spritesheet('mimic-death',           '/assets/Mimic/death.png',            { frameWidth: 146, frameHeight: 146 });

    // Treasure chest — 36×25 frames
    this.load.spritesheet('chest-sheet', '/assets/TreasureChest/Treasure Chest - Basic & Fancy.png', { frameWidth: 36, frameHeight: 25 });

    // Mad King — 160×111 frames
    this.load.spritesheet('madking-idle',     '/assets/MadKing/Idle.png',     { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-run',      '/assets/MadKing/Run.png',      { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-attack1',  '/assets/MadKing/Attack1.png',  { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-attack2',  '/assets/MadKing/Attack2.png',  { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-attack3',  '/assets/MadKing/Attack3.png',  { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-take-hit', '/assets/MadKing/Take Hit.png', { frameWidth: 160, frameHeight: 111 });
    this.load.spritesheet('madking-death',    '/assets/MadKing/Death.png',    { frameWidth: 160, frameHeight: 111 });

    // Audio — music
    this.load.audio('music-dungeon',   '/assets/Audio/Main-Dungeon-Theme.ogg');
    this.load.audio('music-dungeon-2', '/assets/Audio/BackgroundTrack2.ogg');
    this.load.audio('music-dungeon-3', '/assets/Audio/BackgroundTrack3.ogg');
    this.load.audio('music-dungeon-4', '/assets/Audio/BackgroundTrack4.ogg');
    this.load.audio('music-dungeon-5', '/assets/Audio/BackgroundTrack5.ogg');
    this.load.audio('music-shop',      '/assets/Audio/Music-Shop.ogg');
    this.load.audio('music-victory',   '/assets/Audio/Victory-track.ogg');
    this.load.audio('music-lose',      '/assets/Audio/Losing-Track.ogg');

    // Audio — SFX
    this.load.audio('sfx-rare-drop',       '/assets/Audio/Rare-Item-Drop.ogg');
    this.load.audio('sfx-darkmage-attack', '/assets/Audio/Enemy-Sounds/DarkMage-Attack.ogg');
    this.load.audio('sfx-golem-hit',       '/assets/Audio/Enemy-Sounds/Golem-Hit.ogg');
    this.load.audio('sfx-golem-walk',      '/assets/Audio/Enemy-Sounds/Golem-Walk-Sound.ogg');
    this.load.audio('sfx-golem-attack',    '/assets/Audio/Enemy-Sounds/Golem-Attack.ogg');
    this.load.audio('sfx-golem-death',     '/assets/Audio/Enemy-Sounds/Golem-Death.ogg');
    this.load.audio('sfx-bat-attack',      '/assets/Audio/Enemy-Sounds/Bat-Attack.wav');
    this.load.audio('sfx-bat-death',       '/assets/Audio/Enemy-Sounds/Bat-Death.wav');
    this.load.audio('sfx-skeleton-attack', '/assets/Audio/Enemy-Sounds/Skeleton-Attack.wav');
    this.load.audio('sfx-skeleton-death',  '/assets/Audio/Enemy-Sounds/Skeleton-Death.wav');
    this.load.audio('sfx-goblin-death',    '/assets/Audio/Enemy-Sounds/Goblin-death.ogg');
    this.load.audio('sfx-slime-death',     '/assets/Audio/Enemy-Sounds/Slime-Death.wav');
    this.load.audio('sfx-warrior-attack',  '/assets/Audio/Player-Sounds/Warrior-attack.wav');
    this.load.audio('sfx-wizard-attack',   '/assets/Audio/Player-Sounds/Wizard-Attack.wav');
    this.load.audio('sfx-archer-attack',   '/assets/Audio/Player-Sounds/Archer-Attack.wav');
    this.load.audio('sfx-mushroom-attack', '/assets/Audio/Enemy-Sounds/Mushroom-Attack.wav');
    this.load.audio('sfx-mushroom-death',  '/assets/Audio/Enemy-Sounds/Mushroom-Death.wav');
    this.load.audio('sfx-mimic-death',     '/assets/Audio/Enemy-Sounds/Mimic-Death.wav');
    this.load.audio('sfx-madking-attack',  '/assets/Audio/Enemy-Sounds/Madking-Attack.wav');
    this.load.audio('sfx-madking-death',   '/assets/Audio/Enemy-Sounds/Madking-Death.wav');
  }

  create() {
    // Tell React that assets are ready. React will create/join the game session
    // and emit 'startGame' back once the server-side session exists.
    this.game.events.emit('assetsLoaded');
    this.game.events.once('startGame', () => {
      this.cameras.main.fadeOut(350, 7, 7, 13);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('GameScene');
      });
    });
  }
}
