namespace Heroes_Descent.Core.Entities.Enemies;

public class Spider : Enemy
{
    public bool PoisonOnHit { get; } = true;

    public Spider()
    {
        Name = "Spider";
        MovementSpeed = 120f;
        MaxHealth = 30;
        Health = MaxHealth;
        Attack = 8;
        Defense = 2;
        ExperienceReward = 15;
        GoldReward = 3;
    }
}
