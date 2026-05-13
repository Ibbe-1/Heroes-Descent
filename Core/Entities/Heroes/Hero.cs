namespace Heroes_Descent.Core.Entities.Heroes;

// Abstract base class shared by all three heroes.
// Contains stats and logic that every hero has in common:
// HP, basic attack, damage, healing, leveling, and experience.
// Subclasses (Warrior, Wizard, Archer) extend this with their
// own secondary stats, resources, and abilities.
public abstract class Hero
{
    public string Name { get; set; } = string.Empty;
    public HeroClass Class { get; protected set; }

    public int MaxHp { get; protected set; }
    public int CurrentHp { get; protected set; }
    public int BaseAttack { get; protected set; }
    public int Defense { get; protected set; }

    // Determines turn order in combat — higher Speed acts first.
    // Archer has the highest base Speed, Warrior the lowest.
    public int Speed { get; protected set; }

    public int Level { get; private set; } = 1;
    public int Experience { get; private set; } = 0;

    public bool IsAlive => CurrentHp > 0;

    // Applies incoming damage reduced by Defense, minimum 1.
    // Also triggers OnDamageTaken() so subclasses can react
    // (e.g. Warrior gains Rage when hit).
    public int TakeDamage(int rawDamage)
    {
        int actual = Math.Max(1, rawDamage - Defense);
        CurrentHp = Math.Max(0, CurrentHp - actual);
        OnDamageTaken(actual);
        return actual;
    }

    // Hook called after damage is applied. Override in subclasses
    // to add resource generation or other on-hit effects.
    protected virtual void OnDamageTaken(int damageTaken) { }

    // Restores HP without exceeding MaxHp.
    public void Heal(int amount) =>
        CurrentHp = Math.Min(MaxHp, CurrentHp + amount);

    // Base attack used by the game engine each turn.
    // Virtual so subclasses can override with bonus damage or
    // side effects (Warrior adds Strength, Archer rolls crits).
    public virtual int BasicAttack() => BaseAttack;

    // Returns true when the hero has enough resources to use their ability.
    // Override in subclasses that gate abilities on Rage or Energy.
    public virtual bool CanUseAbility() => true;

    // The name and description of this hero's special ability.
    public abstract string AbilityName { get; }
    public abstract string AbilityDescription { get; }

    // Executes the hero's special ability.
    // Returns a numeric value whose meaning depends on the hero:
    //   Warrior  → 0 (sets IsUntargetable, game engine skips all incoming hits for 5 s)
    //   Wizard   → magic damage dealt to all enemies
    //   Archer   → number of targets hit (game engine applies BasicAttack to each)
    public abstract int UseAbility();

    // Awards XP and triggers a level-up if the threshold is reached.
    public void GainExperience(int xp)
    {
        Experience += xp;
        if (Experience >= ExperienceToNextLevel())
        {
            Experience -= ExperienceToNextLevel();
            Level++;
            OnLevelUp();
        }
    }

    // Called when a level-up occurs. Each subclass decides which stats grow.
    protected abstract void OnLevelUp();

    // XP needed scales linearly with the current level.
    private int ExperienceToNextLevel() => Level * 100;
}
