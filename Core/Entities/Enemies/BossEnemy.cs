namespace Heroes_Descent.Core.Entities.Enemies;

public class BossEnemy : Enemy
{
    public BossEnemy(int floorNumber = 1)
    {
        Name = "Dark Mage";
        MovementSpeed = 45f;
        float mult = MathF.Pow(1.4f, floorNumber - 1);
        MaxHealth = (int)(255 * mult);
        Health    = MaxHealth;
        Attack    = (int)(33  * mult);
        Defense   = (int)(9   * mult);
        ExperienceReward = 220 + (floorNumber * 50);
        GoldReward = 55 + (floorNumber * 12);
    }
}
