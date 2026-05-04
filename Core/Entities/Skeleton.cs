namespace HeroesDescent.Core.Entities;

public class Skeleton : Enemy
{
    public Skeleton()
    {
        Name = "Skeleton";
        MaxHealth = 50;
        Health = MaxHealth;
        Attack = 12;
        Defense = 5;
        ExperienceReward = 25;
    }

    public override int TakeDamage(int incomingDamage)
    {
        // Skeletons resist physical damage
        int reducedDamage = (int)(incomingDamage * 0.75);
        return base.TakeDamage(reducedDamage);
    }
}
