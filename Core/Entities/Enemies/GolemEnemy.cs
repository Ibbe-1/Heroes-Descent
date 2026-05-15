using Heroes_Descent.Core.GameState;

namespace Heroes_Descent.Core.Entities.Enemies;

// Golem is a tanky Elite MiniBoss that can appear in Elite rooms.
// It has high HP and very high defence but deals less damage than the Dark Mage boss,
// so fights are wars of attrition rather than spike-damage races.
//
// Like the Dark Mage it is a hybrid melee / ranged attacker:
//   ≤ GolemMeleeRange px  → smashes with its stone fist (global 800 ms tick)
//   GolemMeleeRange–GolemRangedMax px → launches a glowing arm projectile (per-instance 2 000 ms cooldown)
//   > GolemRangedMax px   → chases the nearest player, no attacks
public class GolemEnemy : Enemy
{
    // Stores the base defence value so BeginLaserCharge / EndLaserCharge can
    // temporarily raise and then restore it without drifting across multiple charges.
    private int _baseDefense;

    public GolemEnemy(int floorNumber = 1)
    {
        Name          = "Golem";
        MovementSpeed = 40f;                          // slow and relentless
        float mult    = MathF.Pow(1.4f, floorNumber - 1);
        MaxHealth     = (int)(210 * mult);
        Health        = MaxHealth;
        Attack        = (int)(21  * mult);
        Defense       = (int)(16  * mult);
        ExperienceReward = 150 + (floorNumber * 30);
        GoldReward       = 40  + (floorNumber * 8);
    }

    // Called when laser charge begins — raises defence so players can't burst the Golem
    // down during the wind-up window (it is frozen and vulnerable to focus-fire otherwise).
    public void BeginLaserCharge()
    {
        _baseDefense = Defense;
        Defense     += RoomBounds.GolemLaserDefenseBonus;
    }

    // Called when the laser fires or is cancelled — restores pre-charge defence.
    public void EndLaserCharge()
    {
        Defense = _baseDefense;
    }
}
