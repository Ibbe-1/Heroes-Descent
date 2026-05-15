namespace Heroes_Descent.Core.Entities.Enemies;

public abstract class Enemy
{
    public string Name { get; protected set; } = string.Empty;
    public int MaxHealth { get; protected set; }
    public int Health { get; protected set; }
    public int Attack { get; protected set; }
    public int Defense { get; protected set; }
    public int ExperienceReward { get; protected set; }
    // Gold dropped when this enemy is killed. Kept separate from XP so the
    // shop can price items independently of how much combat experience they grant.
    public int GoldReward { get; protected set; }
    public float MovementSpeed { get; protected set; } = 70f;

    // Ranged enemies stop and shoot instead of closing to melee distance.
    public virtual bool ShootsProjectiles => false;
    // Attack range used instead of EnemyAttackRange when ShootsProjectiles is true.
    public virtual float ProjectileRange => 0f;

    public bool IsAlive => Health > 0;

    public virtual int TakeDamage(int incomingDamage)
    {
        int actual = Math.Max(1, incomingDamage - Defense);
        Health = Math.Max(0, Health - actual);
        return actual;
    }

    public virtual void OnDeath() { }

    public void ScaleForFloor(int floorBonus)
    {
        float mult = MathF.Pow(1.4f, floorBonus);
        MaxHealth = (int)(MaxHealth * mult);
        Health    = MaxHealth;
        Attack    = Math.Max(Attack + 1, (int)(Attack * mult));
        Defense   = (int)(Defense * mult);
        ExperienceReward += floorBonus * 10;
        GoldReward       += floorBonus * 2;
    }
}
