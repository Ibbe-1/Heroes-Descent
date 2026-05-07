namespace Heroes_Descent.Core.Entities.Enemies;

public class Mushroom : Enemy
{
    public override bool ShootsProjectiles => true;
    public override float ProjectileRange  => 220f;

    public Mushroom()
    {
        Name = "Mushroom";
        MovementSpeed = 50f;
        MaxHealth = 35;
        Health = MaxHealth;
        Attack = 11;
        Defense = 3;
        ExperienceReward = 20;
        GoldReward = 4;
    }
}
