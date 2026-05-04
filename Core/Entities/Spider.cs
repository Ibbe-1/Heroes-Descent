namespace HeroesDescent.Core.Entities;

public class Spider : Enemy
{
    public bool PoisonOnHit { get; } = true;

    public Spider()
    {
        Name = "Spider";
        MaxHealth = 30;
        Health = MaxHealth;
        Attack = 8;
        Defense = 2;
        ExperienceReward = 15;
    }
}
