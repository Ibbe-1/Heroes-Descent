using Heroes_Descent.Core.Entities.Enemies;
using Heroes_Descent.Core.GameState;

namespace Heroes_Descent.Application.Services;

public class DungeonGenerator
{
    public List<RoomState> Generate(int floorNumber = 1)
    {
        int normalCount = Random.Shared.Next(5, 9);
        var rooms = new List<RoomState>();

        for (int i = 0; i < normalCount; i++)
        {
            bool isElite = i >= 3 && Random.Shared.Next(100) < 35;
            rooms.Add(MakeRoom(i, isElite ? RoomType.Elite : RoomType.Normal, floorNumber));
        }

        rooms.Add(MakeBossRoom(normalCount, floorNumber));
        return rooms;
    }

    private static RoomState MakeRoom(int index, RoomType type, int floor)
    {
        int maxEnemies = type == RoomType.Elite ? 4 : 3;
        int count = Random.Shared.Next(1, maxEnemies + 1);
        var enemies = Enumerable.Range(0, count)
            .Select(_ => SpawnEnemy(floor))
            .ToList();
        return new RoomState(index, type, enemies);
    }

    private static RoomState MakeBossRoom(int index, int floor)
    {
        var (bx, by) = RandomEnemyPosition();
        return new RoomState(index, RoomType.Boss,
            [new EnemyInstance(new BossEnemy(floor), bx, by)]);
    }

    private static EnemyInstance SpawnEnemy(int floor)
    {
        Enemy e = Random.Shared.Next(3) switch
        {
            0 => new Skeleton(),
            1 => new Goblin(),
            _ => new Spider(),
        };

        if (floor > 1) e.ScaleForFloor(floor - 1);

        var (ex, ey) = RandomEnemyPosition();
        return new EnemyInstance(e, ex, ey);
    }

    private static (float x, float y) RandomEnemyPosition()
    {
        const int maxAttempts = 20;
        for (int i = 0; i < maxAttempts; i++)
        {
            float x = Random.Shared.NextSingle() * (RoomBounds.Right - RoomBounds.Left - 80) + RoomBounds.Left + 40;
            float y = Random.Shared.NextSingle() * (RoomBounds.Bottom - RoomBounds.Top - 80) + RoomBounds.Top + 40;
            float dx = x - RoomBounds.CenterX;
            float dy = y - RoomBounds.CenterY;
            if (MathF.Sqrt(dx * dx + dy * dy) >= RoomBounds.EnemyMinSpawnDist)
                return (x, y);
        }
        // Fallback: place in a corner
        return (RoomBounds.Left + 80, RoomBounds.Top + 80);
    }
}
