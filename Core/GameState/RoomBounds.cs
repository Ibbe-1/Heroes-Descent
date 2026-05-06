namespace Heroes_Descent.Core.GameState;

// RoomBounds defines the physical layout of every dungeon room in pixel coordinates.
// These values are shared across the server (enemy movement, attack range checks)
// and must exactly match the constants used in the Phaser scene on the frontend
// so that positions mean the same thing on both sides of the connection.
//
// The world is 1920 × 1280 px. The Phaser canvas is 960 × 640, so the camera
// follows the player around a world four times the canvas area.
// Walls are 48 px thick on every side, leaving an 1824 × 1184 playable area
// large enough to contain several chambers connected by corridors.
public static class RoomBounds
{
    // Inner room edges — enemies and players are clamped inside these
    public const float Left   = 48f;
    public const float Right  = 1872f;
    public const float Top    = 48f;
    public const float Bottom = 1232f;

    // Center of the room — used as the player spawn reference point
    public const float CenterX = (Left + Right) / 2f;    // 960
    public const float CenterY = (Top + Bottom) / 2f;    // 640

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

    // Enemies won't spawn within this radius of the room centre,
    // giving the party a safe landing zone at the start of each room.
    // Larger now because the world is 4× the previous area.
    public const float EnemyMinSpawnDist = 300f;

    // Spread-out spawn positions for up to 4 players, all in the central
    // chamber of every layout so the party always lands in a safe pocket.
    public static readonly (float x, float y)[] PlayerSpawns =
    [
        (960f, 640f),
        (910f, 640f),
        (1010f, 640f),
        (960f, 690f),
    ];
}
