namespace Heroes_Descent.Core.GameState;

// A ranged projectile fired by the Dark Mage boss or the Golem Elite MiniBoss.
//
// Unlike melee attacks (which deal damage instantly), a projectile moves at a fixed
// speed across the room and only damages a player when it physically reaches them.
// Because it travels in a straight line toward where the attacker aimed when it fired,
// stepping sideways after the shot is launched will dodge it completely.
public class ActiveProjectile
{
    // Unique ID sent to the frontend so it can match sprite objects to server data
    // across state updates — the same pattern used for enemy instances.
    public Guid Id { get; } = Guid.NewGuid();

    // Current world position — updated every 100 ms tick by GameService.MoveProjectiles.
    public float X { get; set; }
    public float Y { get; set; }

    // Normalised direction vector — calculated once at fire time and never changed.
    // The projectile does NOT home in on the player; it flies in a straight line.
    // Moving out of this line after the shot is fired will dodge the damage.
    public float DirX { get; }
    public float DirY { get; }

    // How far the projectile has travelled since it was fired.
    // Used to remove it once it exceeds MaxRange.
    public float DistanceTravelled { get; set; }

    // Travel speed in pixels per second.
    // Fast enough to feel threatening, slow enough that strafing sideways dodges it.
    public const float Speed = 420f;

    // The projectile disappears after travelling this many pixels without hitting anyone.
    // Keeps it from flying off-screen if the player dodges.
    public const float MaxRange = 340f;

    // A player must be within this radius (px) of the projectile centre to be hit.
    // Generous enough to feel fair while rewarding players who move early.
    public const float HitRadius = 26f;

    // Damage applied on hit — copied from the attacker's Attack stat when fired.
    // Stored here so it stays consistent even if the stat changes mid-flight.
    public int Damage { get; }

    // Name of the attacker shown in the combat log on hit — e.g. "Dark Mage's fireball" or "Golem's projectile".
    public string AttackerName { get; }

    public ActiveProjectile(float fromX, float fromY, float toX, float toY, int damage, string attackerName = "projectile")
    {
        X            = fromX;
        Y            = fromY;
        Damage       = damage;
        AttackerName = attackerName;

        // Build the normalised direction from the attacker's position toward the
        // player's position at the moment of firing.
        // len > 0 guard prevents a divide-by-zero if the attacker is standing exactly
        // on top of a player (shouldn't happen, but defensive).
        float dx  = toX - fromX;
        float dy  = toY - fromY;
        float len = MathF.Sqrt(dx * dx + dy * dy);
        DirX = len > 0.001f ? dx / len : 0f;
        DirY = len > 0.001f ? dy / len : 1f;
    }
}
