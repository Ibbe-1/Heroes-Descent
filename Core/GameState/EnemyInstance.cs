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

    public EnemyInstance(Enemy enemy, float x = 480f, float y = 320f)
    {
        Enemy = enemy;
        X     = x;
        Y     = y;
    }
}
