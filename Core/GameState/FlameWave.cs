namespace Heroes_Descent.Core.GameState;

// A flame wave conjured by the Dark Mage boss — a wall of fire that sweeps
// across the room from one edge to the other.
//
// Horizontal waves (DirX ≠ 0, DirY = 0): three parallel vertical bands sweep left or right.
// Vertical waves  (DirX = 0, DirY ≠ 0): three parallel horizontal bands sweep up or down.
// Cross-fire      (mixed volleys): two horizontal + two vertical at once.
//
// HalfHeight is always the half-extent *perpendicular* to the direction of travel,
// so it doubles as "halfWidth" for vertical waves on the frontend.
// A player hit by a wave takes fire damage exactly once; the HitPlayerIds set
// prevents the wave from dealing damage again as it continues through them.
public class FlameWave
{
    public Guid Id { get; } = Guid.NewGuid();

    // Leading-edge position — both X and Y are mutable so the server can move
    // horizontal waves on the X axis and vertical waves on the Y axis each tick.
    public float X { get; set; }
    public float Y { get; set; }

    // +1/-1 for horizontal travel; 0 for vertical waves.
    public float DirX { get; }

    // +1/-1 for vertical travel; 0 for horizontal waves.
    public float DirY { get; }

    // Half the extent of the damage band *perpendicular* to the direction of travel.
    // For horizontal waves: half the vertical height of the strip.
    // For vertical waves  : half the horizontal width of the strip.
    public float HalfHeight { get; }

    public int Damage { get; }

    // Slower than regular projectiles so players have time to step into a gap.
    public const float Speed = 200f;

    // Prevents the wave from hitting the same player more than once per pass.
    public HashSet<string> HitPlayerIds { get; } = [];

    public FlameWave(float x, float y, float dirX, float dirY, float halfHeight, int damage)
    {
        X          = x;
        Y          = y;
        DirX       = dirX;
        DirY       = dirY;
        HalfHeight = halfHeight;
        Damage     = damage;
    }
}
