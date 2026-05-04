namespace Heroes_Descent.Core.GameState;

public class RoomState
{
    public int Index { get; }
    public RoomType Type { get; }
    public List<EnemyInstance> Enemies { get; }
    public bool IsCleared => Enemies.All(e => !e.Enemy.IsAlive);

    public RoomState(int index, RoomType type, List<EnemyInstance> enemies)
    {
        Index = index;
        Type = type;
        Enemies = enemies;
    }
}
