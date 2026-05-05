namespace Heroes_Descent.Core.Entities.Enemies;

// ChestGuardian is the mini-boss that spawns in every TreasureChest room.
// It is tougher than a regular enemy but weaker than the floor boss, giving
// the chest reward a meaningful cost without blocking progress for long.
// Stats scale with floor via ScaleForFloor, same as other enemies.
public class ChestGuardian : Enemy
{
    public ChestGuardian()
    {
        Name = "Chest Guardian";
        MovementSpeed = 55f;
        MaxHealth = 100;
        Health = MaxHealth;
        Attack = 15;
        Defense = 7;
        ExperienceReward = 55;
        GoldReward = 12;  // drops its own coins on top of the chest reward
    }
}
