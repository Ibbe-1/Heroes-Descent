namespace Heroes_Descent.Core.Entities.Enemies;

public class Slime : Enemy
{
    public Slime()
    {
        Name = "Slime";
        MovementSpeed = 80f;
        MaxHealth = 45;
        Health = MaxHealth;
        Attack = 9;
        Defense = 2;
        ExperienceReward = 18;
        GoldReward = 4;
    }
}
