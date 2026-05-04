namespace Heroes_Descent.Core.Entities.Enemies;

public abstract class Enemy
{
    public string Name { get; protected set; } = string.Empty;
    public int MaxHealth { get; protected set; }
    public int Health { get; protected set; }
    public int Attack { get; protected set; }
    public int Defense { get; protected set; }
    public int ExperienceReward { get; protected set; }

    public bool IsAlive => Health > 0;

    public virtual int TakeDamage(int incomingDamage)
    {
        int actual = Math.Max(1, incomingDamage - Defense);
        Health = Math.Max(0, Health - actual);
        return actual;
    }

    public virtual void OnDeath() { }
}
