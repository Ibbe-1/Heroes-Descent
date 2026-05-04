namespace Heroes_Descent.Core.Entities.Enemies;

public class Goblin : Enemy
{
    public int GoldStealAmount { get; } = 5;

    public Goblin()
    {
        Name = "Goblin";
        MaxHealth = 40;
        Health = MaxHealth;
        Attack = 10;
        Defense = 3;
        ExperienceReward = 20;
    }
}
