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
