namespace Heroes_Descent.Core.Entities.Enemies;

public class Skeleton : Enemy
{
    public Skeleton()
    {
        Name = "Skeleton";
        MovementSpeed = 60f;
        MaxHealth = 50;
        Health = MaxHealth;
        Attack = 12;
        Defense = 5;
        ExperienceReward = 25;
        GoldReward = 4;
    }

    public override int TakeDamage(int incomingDamage)
    {
        int reducedDamage = (int)(incomingDamage * 0.75);
        return base.TakeDamage(reducedDamage);
    }
}
