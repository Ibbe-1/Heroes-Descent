using Heroes_Descent.Core.Entities.Enemies;

namespace Heroes_Descent.Core.GameState;

public class EnemyInstance
{
    public Guid Id { get; } = Guid.NewGuid();
    public Enemy Enemy { get; }
    public float X { get; set; }
    public float Y { get; set; }

    public EnemyInstance(Enemy enemy, float x = 480f, float y = 320f)
    {
        Enemy = enemy;
        X = x;
        Y = y;
    }
}
