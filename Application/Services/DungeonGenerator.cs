using Heroes_Descent.Core.Entities.Enemies;
using Heroes_Descent.Core.GameState;

namespace Heroes_Descent.Application.Services;

// DungeonGenerator builds a list of rooms procedurally every time a new session starts.
// Each room is different: random enemy counts, types, and positions.
// The generator is stateless — it uses Random.Shared and returns a new room list each call.
public class DungeonGenerator
{
    // Entry point — call this once per session to get the full room list.
    // floorNumber scales enemy stats for future floor 2, floor 3 support.
    public List<RoomState> Generate(int floorNumber = 1)
    {
        // Pick a random room count between 5 and 8 (not including the boss room).
        int normalCount = Random.Shared.Next(5, 9);
        var rooms = new List<RoomState>();

        for (int i = 0; i < normalCount; i++)
        {
            // Every 3rd room (index 2, 5, 8…) is a treasure chest — no enemies, just gold.
            if ((i + 1) % 3 == 0)
            {
                rooms.Add(MakeChestRoom(i));
                continue;
            }

            // Rooms after index 3 have a 35% chance to be upgraded to "Elite"
            // (more enemies, harder fight, same XP reward for now).
            bool isElite = i >= 3 && Random.Shared.Next(100) < 35;
            rooms.Add(MakeRoom(i, isElite ? RoomType.Elite : RoomType.Normal, floorNumber));
        }

        // The final room always has a single boss enemy.
        rooms.Add(MakeBossRoom(normalCount, floorNumber));
        return rooms;
    }

    private static RoomState MakeRoom(int index, RoomType type, int floor)
    {
        // Elite rooms can have up to 4 enemies; normal rooms up to 3.
        int maxEnemies = type == RoomType.Elite ? 4 : 3;
        int count      = Random.Shared.Next(1, maxEnemies + 1);

        var enemies = Enumerable.Range(0, count)
            .Select(_ => SpawnEnemy(floor))
            .ToList();

        return new RoomState(index, type, enemies);
    }

    private static RoomState MakeChestRoom(int index)
    {
        int gold = Random.Shared.Next(15, 31);

        // 35% chance the chest is a Mimic in disguise.
        // Players must defeat it before they can advance, but the gold is still awarded on entry.
        if (Random.Shared.Next(100) < 35)
        {
            var (mx, my) = RandomEnemyPosition();
            return new RoomState(index, RoomType.TreasureChest, [new EnemyInstance(new Mimic(), mx, my)], gold);
        }

        return new RoomState(index, RoomType.TreasureChest, [], gold);
    }

    private static RoomState MakeBossRoom(int index, int floor)
    {
        var (bx, by) = RandomEnemyPosition();
        return new RoomState(index, RoomType.Boss,
            [new EnemyInstance(new BossEnemy(floor), bx, by)]);
    }

    // Creates one random enemy, applies floor scaling, and places it at a random position.
    private static EnemyInstance SpawnEnemy(int floor)
    {
        // Pick one of the five basic enemy types at random.
        Enemy e = Random.Shared.Next(5) switch
        {
            0 => new Skeleton(),
            1 => new Goblin(),
            2 => new Bat(),
            3 => new Slime(),
            _ => new Mushroom(),
        };

        // Floor scaling: each floor above 1 boosts HP, attack, and defence slightly.
        if (floor > 1) e.ScaleForFloor(floor - 1);

        var (ex, ey) = RandomEnemyPosition();
        return new EnemyInstance(e, ex, ey);
    }

    // Picks a spawn position that is far enough from the room centre
    // so enemies don't immediately pile onto players when a room starts.
    // Tries up to 20 times; falls back to a corner if no valid spot is found.
    private static (float x, float y) RandomEnemyPosition()
    {
        const int maxAttempts = 20;
        for (int i = 0; i < maxAttempts; i++)
        {
            float x = Random.Shared.NextSingle() * (RoomBounds.Right  - RoomBounds.Left   - 80) + RoomBounds.Left   + 40;
            float y = Random.Shared.NextSingle() * (RoomBounds.Bottom - RoomBounds.Top    - 80) + RoomBounds.Top    + 40;
            float dx = x - RoomBounds.CenterX;
            float dy = y - RoomBounds.CenterY;
            if (MathF.Sqrt(dx * dx + dy * dy) >= RoomBounds.EnemyMinSpawnDist)
                return (x, y);
        }
        return (RoomBounds.Left + 80, RoomBounds.Top + 80);
    }
}
