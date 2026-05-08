namespace Heroes_Descent.Core.Entities.Enemies;

public class BossEnemy : Enemy
{
    public BossEnemy(int floorNumber = 1)
    {
        Name = "Dark Mage";
        MovementSpeed = 45f;
        MaxHealth = 220 + (floorNumber * 35);
        Health = MaxHealth;
        Attack = 28 + (floorNumber * 5);
        Defense = 8 + floorNumber;
        ExperienceReward = 220 + (floorNumber * 50);
        GoldReward = 55 + (floorNumber * 12);
    }
}
