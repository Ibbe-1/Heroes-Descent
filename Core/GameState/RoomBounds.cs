namespace Heroes_Descent.Core.GameState;

// RoomBounds defines the world-space playable area shared by server and frontend.
//
// Viewport  : 960 × 640 px (Phaser canvas).
// World size : REGION_W × REGION_H = 1280 × 900 px (MapRegionManager window, 1:1 scale).
// Camera scrolls: 320 px horizontal, 260 px vertical per room.
// All 12 sliding-window regions share these bounds — enemies stay inside every window.
public static class RoomBounds
{
    // Playable edges — 32 px inset from the 1280 × 900 region window.
    public const float Left   = 32f;
    public const float Right  = 1248f;
    public const float Top    = 32f;
    public const float Bottom = 868f;

    // Center of the playable area — player and enemy spawn reference.
    public const float CenterX = (Left + Right) / 2f;    // 640
    public const float CenterY = (Top + Bottom) / 2f;    // 450

    // Warrior melee cone range
    public const float PlayerAttackRange    = 150f;  // kept for AttackNearest compat
    public const float WarriorAttackRange   = 150f;
    public const float WarriorConeHalfAngle = MathF.PI / 4f;  // ±45° = 90° total cone

    // Archer arrow range and hit-box radius (how close ray must pass to enemy centre)
    public const float ArcherAttackRange = 600f;
    public const float ArcherHitRadius   = 32f;

    // Wizard bolt range and hit-box radius (larger — easier to land but slower)
    public const float WizardAttackRange  = 800f;
    public const float WizardHitRadius    = 52f;
    // Radius around the fireball's primary impact point that receives splash damage
    public const float WizardSplashRadius = 80f;

    // How close an enemy must be to a player before it can deal damage
    public const float EnemyAttackRange  = 80f;

    // Dark Mage boss combat ranges
    // ≤ BossMeleeRange        → melee attack (global 800 ms tick)
    // BossMeleeRange–BossRangedMax → ranged fireball (per-boss 1 400 ms cooldown)
    // > BossRangedMax         → chase only, no attacks
    public const float BossMeleeRange       = 80f;
    public const float BossRangedMax        = 320f;
    public const float BossRangedCooldownMs = 1400f;
    public const float BossStopDistance     = 70f;

    // Golem Elite MiniBoss combat ranges
    // ≤ GolemMeleeRange       → stone-fist melee (global 800 ms tick)
    // GolemMeleeRange–GolemRangedMax → glowing arm projectile (per-instance 2 000 ms cooldown)
    // > GolemRangedMax        → chase only, no attacks
    public const float GolemMeleeRange       = 90f;   // wider reach than boss — big stone arm
    public const float GolemRangedMax        = 400f;  // arm-projectile range (wider gap = more chances to fire)
    public const float GolemRangedCooldownMs = 2000f; // slower rate of fire — compensated by high HP
    public const float GolemStopDistance     = 80f;   // stops chasing when this close

    // Golem laser charge thresholds and timing
    // The Golem charges its laser once each time HP crosses 75 %, 50 %, and 25 %.
    // During the 2 s wind-up it freezes in place and gains bonus defence;
    // when it fires the laser it damages ALL alive players and defence resets.
    public const float GolemChargeDurationMs    = 2000f; // 2 s charge before the laser fires
    public const int   GolemLaserDefenseBonus   = 15;    // extra defence during wind-up
    public const float GolemLaserFiringVisualMs = 700f;  // how long isLaserFiring stays true after the shot
    public const float GolemLaserDamageMultiplier = 2.5f; // laser hits harder than a normal attack
    // Beam corridor — only players inside this ray get damaged.
    // The direction is locked toward the nearest player when the charge begins,
    // so backing out of the corridor (> GolemLaserRange px away, or moving sideways
    // more than GolemLaserWidth px off the beam line) avoids all damage.
    public const float GolemLaserRange = 500f; // maximum beam length in pixels
    public const float GolemLaserWidth = 80f;  // half-width of the hit corridor (±80 px off center)

    // Enemies won't spawn within this radius of the room centre,
    // giving the party a safe landing zone at the start of each room
    public const float EnemyMinSpawnDist = 200f;

    // Spread-out spawn positions for up to 4 players.
    // Player 0 spawns at the centre; the rest step slightly to the sides.
    // The server resets players to these positions on every room transition.
    public static readonly (float x, float y)[] PlayerSpawns =
    [
        (640f,  450f),
        (580f,  450f),
        (700f,  450f),
        (640f,  510f),
    ];
}
