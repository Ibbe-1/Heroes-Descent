namespace HeroesDescent.Core.Entities;

public abstract class Enemy
{
    public string Name { get; protected set; } = string.Empty;
    public int Health { get; protected set; }
    public int MaxHealth { get; protected set; }
    public int Attack { get; protected set; }
    public int Defense { get; protected set; }
    public int ExperienceReward { get; protected set; }

    public bool IsAlive => Health > 0;

    public virtual int TakeDamage(int incomingDamage)
    {
        int damage = Math.Max(0, incomingDamage - Defense);
        Health = Math.Max(0, Health - damage);
        return damage;
    }

    public virtual void OnDeath() { }
}
