using Heroes_Descent.Core.Entities.Enemies;

namespace Heroes_Descent.Core.GameState;

// EnemyInstance wraps an Enemy entity with the runtime state needed for 2D gameplay.
// The Enemy class (Core/Entities/Enemies/) defines stats and combat logic.
// EnemyInstance adds a unique ID (so the frontend can track individual enemies)
// and a live position that the server updates every 100 ms as enemies chase players.
public class EnemyInstance
{
    // Unique identifier for this enemy in the current room.
    // Sent to the frontend as a string; the Phaser scene uses it to match
    // sprite objects to server data across state updates.
    public Guid Id { get; } = Guid.NewGuid();

    // The underlying enemy (Skeleton, Goblin, Spider, or BossEnemy).
    // All HP and combat logic is delegated to this object.
    public Enemy Enemy { get; }

    // World position in the same pixel space as the Phaser canvas.
    // Set by DungeonGenerator at spawn; updated each tick by GameService.MoveEnemies.
    public float X { get; set; }
    public float Y { get; set; }

    // Tracks when the boss last fired a ranged shot — separate from the global
    // LastEnemyTick so melee and ranged attacks run on independent cooldowns.
    public DateTime LastRangedAttackTime { get; set; } = DateTime.MinValue;

    // ── Golem laser charge state ──────────────────────────────────────────────
    // Only meaningful when Enemy is GolemEnemy; ignored for all other types.

    // Records which HP percentage thresholds (75, 50, 25) have already triggered
    // a laser charge. Each threshold fires at most once per Golem encounter.
    public HashSet<int> GolemLaserThresholdsUsed { get; } = [];

    // Set to the current time when the Golem starts charging; null when idle or after firing.
    public DateTime? GolemChargeStartTime { get; set; } = null;

    // Set to the current time when the laser fires; cleared after GolemLaserFiringVisualMs.
    // The frontend reads this window to play the beam animation.
    public DateTime? GolemLaserFiredTime { get; set; } = null;

    // True while the Golem is winding up its laser shot.
    public bool GolemIsCharging => GolemChargeStartTime.HasValue;

    // Normalised direction the laser will travel — set toward the nearest player at
    // the moment the charge begins and kept fixed until the shot fires.
    // The frontend rotates the beam sprite using atan2(LaserDirY, LaserDirX).
    public float GolemLaserDirX { get; set; } = 1f;
    public float GolemLaserDirY { get; set; } = 0f;

    public EnemyInstance(Enemy enemy, float x = 480f, float y = 320f)
    {
        Enemy = enemy;
        X     = x;
        Y     = y;
    }
}
