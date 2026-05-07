namespace Heroes_Descent.Core.Entities.Enemies;

public class Bat : Enemy
{
    public Bat()
    {
        Name = "Bat";
        MovementSpeed = 130f;
        MaxHealth = 30;
        Health = MaxHealth;
        Attack = 8;
        Defense = 2;
        ExperienceReward = 15;
        GoldReward = 3;
    }
}
