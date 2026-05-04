namespace Heroes_Descent.Core.GameState;

public static class RoomBounds
{
    public const float Left   = 48f;
    public const float Right  = 912f;
    public const float Top    = 48f;
    public const float Bottom = 592f;
    public const float CenterX = (Left + Right) / 2f;    // 480
    public const float CenterY = (Top + Bottom) / 2f;    // 320

    public const float PlayerAttackRange = 120f;
    public const float EnemyAttackRange  = 80f;
    public const float EnemyMinSpawnDist = 200f;

    public static readonly (float x, float y)[] PlayerSpawns =
    [
        (480f, 320f),
        (430f, 320f),
        (530f, 320f),
        (480f, 370f),
    ];
}
