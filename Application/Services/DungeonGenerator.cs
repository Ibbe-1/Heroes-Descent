using Heroes_Descent.Core.Entities.Enemies;
using Heroes_Descent.Core.GameState;

namespace Heroes_Descent.Application.Services;

// DungeonGenerator builds a list of rooms procedurally every time a new session starts.
// Each room is different: random enemy counts, types, and positions.
// The generator is stateless — it uses Random.Shared and returns a new room list each call.
public class DungeonGenerator
{
    // Entry point — call this once per session to get the full room list.
    // floorNumber is the prestige round (1 = first run, 2 = first prestige, etc.).
    public List<RoomState> Generate(int floorNumber = 1)
    {
        // Dungeon grows longer each prestige (up to 4 extra rooms, capped at 12 normal rooms).
        int normalCount = Random.Shared.Next(5, 9) + Math.Min(floorNumber - 1, 4);
        var rooms = new List<RoomState>();

        for (int i = 0; i < normalCount; i++)
        {
            // Every 3rd room (index 2, 5, 8…) is a treasure chest guarded by a mini-boss.
            if ((i + 1) % 3 == 0)
            {
                rooms.Add(MakeChestRoom(i, floorNumber));
                continue;
            }

            // Elite rooms appear earlier and more often at higher prestige:
            //   Prestige 1: from index 3, 50% chance
            //   Prestige 2: from index 2, 60% chance
            //   Prestige 3: from index 1, 70% chance
            //   Prestige 4+: from index 1, 75% chance (capped)
            int eliteFromIndex = Math.Max(3 - (floorNumber - 1), 1);
            int eliteChance    = Math.Min(50 + (floorNumber - 1) * 10, 75);
            bool isElite = i >= eliteFromIndex && Random.Shared.Next(100) < eliteChance;
            rooms.Add(MakeRoom(i, isElite ? RoomType.Elite : RoomType.Normal, floorNumber));
        }

        // The final room always has a single boss enemy.
        rooms.Add(MakeBossRoom(normalCount, floorNumber));
        // After defeating the boss the party exits through the hall — victory is awarded on entry.
        rooms.Add(MakeExitHallRoom(normalCount + 1));
        return rooms;
    }

    private static RoomState MakeRoom(int index, RoomType type, int floor)
    {
        // Elite rooms spawn a single Golem — a tanky MiniBoss, no regular monsters alongside it.
        // Normal rooms spawn 1-3 random enemies.
        if (type == RoomType.Elite)
        {
            var (gx, gy) = RandomEnemyPosition();
            return new RoomState(index, type, [new EnemyInstance(new GolemEnemy(floor), gx, gy)]);
        }

        int minCount = Math.Min(floor, 3);
        int maxCount = Math.Min(2 + floor, 6);
        int count    = Random.Shared.Next(minCount, maxCount + 1);
        var enemies = Enumerable.Range(0, count)
            .Select(_ => SpawnEnemy(floor))
            .ToList();

        return new RoomState(index, type, enemies);
    }

    private static RoomState MakeChestRoom(int index, int floor)
    {
        // 35% chance the encounter is a Mimic — same room, no chest reward.
        if (Random.Shared.Next(100) < 35)
        {
            var (mx, my) = RandomEnemyPosition();
            return new RoomState(index, RoomType.TreasureChest, [new EnemyInstance(new Mimic(), mx, my)]);
        }

        // Mad King guards the chest — defeat him to unlock 50 gold.
        var guardian = new ChestGuardian();
        if (floor > 1) guardian.ScaleForFloor(floor - 1);
        var (gx, gy) = RandomEnemyPosition();
        return new RoomState(index, RoomType.TreasureChest, [new EnemyInstance(guardian, gx, gy)], 50);
    }

    private static RoomState MakeBossRoom(int index, int floor)
    {
        var (bx, by) = RandomEnemyPosition();
        return new RoomState(index, RoomType.Boss,
            [new EnemyInstance(new BossEnemy(floor), bx, by)]);
    }

    private static RoomState MakeExitHallRoom(int index) =>
        new RoomState(index, RoomType.ExitHall, []);

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
