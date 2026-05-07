namespace Heroes_Descent.Core.GameState;

// RoomBounds defines the physical layout of every dungeon room in pixel coordinates.
// These values are shared across the server (enemy movement, attack range checks)
// and must exactly match the constants used in the Phaser scene on the frontend
// so that positions mean the same thing on both sides of the connection.
//
// The game canvas is 960 × 640 px.
// Walls are 48 px thick on every side, leaving an 864 × 544 playable area.
public static class RoomBounds
{
    // Inner room edges — enemies and players are clamped inside these
    public const float Left   = 48f;
    public const float Right  = 912f;
    public const float Top    = 48f;
    public const float Bottom = 592f;

    // Center of the room — used as the player spawn reference point
    public const float CenterX = (Left + Right) / 2f;    // 480
    public const float CenterY = (Top + Bottom) / 2f;    // 320

    // Warrior melee cone range
    public const float PlayerAttackRange    = 120f;  // kept for AttackNearest compat
    public const float WarriorAttackRange   = 120f;
    public const float WarriorConeHalfAngle = MathF.PI / 4f;  // ±45° = 90° total cone

    // Archer arrow range and hit-box radius (how close ray must pass to enemy centre)
    public const float ArcherAttackRange = 600f;
    public const float ArcherHitRadius   = 16f;

    // Wizard bolt range and hit-box radius (larger — easier to land but slower)
    public const float WizardAttackRange  = 800f;
    public const float WizardHitRadius    = 28f;
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

    // Enemies won't spawn within this radius of the room centre,
    // giving the party a safe landing zone at the start of each room
    public const float EnemyMinSpawnDist = 200f;

    // Spread-out spawn positions for up to 4 players.
    // Player 0 spawns at the centre; the rest step slightly to the sides.
    // The server resets players to these positions on every room transition.
    public static readonly (float x, float y)[] PlayerSpawns =
    [
        (480f, 320f),
        (430f, 320f),
        (530f, 320f),
        (480f, 370f),
    ];
}
