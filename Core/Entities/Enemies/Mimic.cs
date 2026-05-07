namespace Heroes_Descent.Core.Entities.Enemies;

public class Mimic : Enemy
{
    public Mimic()
    {
        Name = "Mimic";
        MovementSpeed = 90f;
        MaxHealth = 120;
        Health = MaxHealth;
        Attack = 15;
        Defense = 6;
        ExperienceReward = 60;
        GoldReward = 25;
    }
}
