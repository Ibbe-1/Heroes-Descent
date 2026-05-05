namespace Heroes_Descent.Core.Entities.Enemies;

public class Goblin : Enemy
{
    public Goblin()
    {
        Name = "Goblin";
        MovementSpeed = 100f;
        MaxHealth = 40;
        Health = MaxHealth;
        Attack = 10;
        Defense = 3;
        ExperienceReward = 20;
        GoldReward = 5;
    }
}
