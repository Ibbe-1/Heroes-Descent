namespace Heroes_Descent.Core.Entities.Enemies;

public class BossEnemy : Enemy
{
    public BossEnemy(int floorNumber = 1)
    {
        Name = floorNumber >= 3 ? "Dungeon Overlord" : floorNumber >= 2 ? "Ancient Colossus" : "Bone Titan";
        MovementSpeed = 40f;
        MaxHealth = 200 + (floorNumber * 40);
        Health = MaxHealth;
        Attack = 20 + (floorNumber * 4);
        Defense = 12 + (floorNumber * 2);
        ExperienceReward = 200 + (floorNumber * 50);
        GoldReward = 50 + (floorNumber * 10);
    }
}
