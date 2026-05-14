namespace Heroes_Descent.Core.Entities.Heroes;

// The Wizard is a fragile but powerful spellcaster.
// Secondary stat : Intellect — increases Fireball damage and MaxMana.
// Resource       : Mana (0–MaxMana) — spent to cast Fireball.
//                  Does not regenerate automatically; restored by items or floor rest.
public class Wizard : Hero
{
    // --- Secondary stat ---

    // Intellect increases both Fireball damage (+2 per point) and MaxMana (+5 per point).
    // Increases by 3 on each level-up, growing both combat power and sustain.
    public int Intellect { get; private set; } = 8;

    // --- Mana resource ---

    // Base mana pool before Intellect is applied.
    private const int BaseMana = 80;

    // MaxMana is computed from Intellect so it scales automatically as Intellect grows.
    // At start (Intellect 8): 80 + 8*5 = 120 mana.
    public int MaxMana => BaseMana + (Intellect * 5);
    public int CurrentMana { get; private set; }

    private const int AbilityCost = 25;   // Mana cost per Fireball cast

    public Wizard(string name)
    {
        Name = name;
        Class = HeroClass.Wizard;
        MaxHp     = 60;
        BaseAttack = 10;    // Weak physical attack — mana spells are the main damage source
        Defense   = 3;
        Speed     = 10;
        CurrentHp = MaxHp;
        CurrentMana = MaxMana;
    }

    public override string AbilityName => "Fireball";

    // Description is dynamic — shows the current damage value based on Intellect.
    public override string AbilityDescription =>
        $"Costs {AbilityCost} mana. Hurls a fireball that deals {35 + Intellect * 2} magic damage on impact with 60% splash to nearby enemies.";

    public override bool CanUseAbility() => CurrentMana >= AbilityCost;

    // Casts Fireball on all enemies.
    // Returns the magic damage value; the game engine applies it to every enemy on the floor.
    // Damage scales with Intellect: base 35 + (Intellect * 2).
    // At start (Intellect 8): 51 damage. At level 5 (Intellect 20): 75 damage.
    public override int UseAbility()
    {
        if (CurrentMana < AbilityCost) return 0;
        CurrentMana -= AbilityCost;
        return 35 + (Intellect * 2);
    }

    // Used by items, rest events, or floor transitions to restore mana.
    public void RestoreMana(int amount) =>
        CurrentMana = Math.Min(MaxMana, CurrentMana + amount);

    public override void FullRestore()
    {
        base.FullRestore();
        CurrentMana = MaxMana;
    }

    // On level-up, Wizard gains HP, Intellect (which auto-grows MaxMana), and a mana refill.
    protected override void OnLevelUp()
    {
        MaxHp    += 8;
        CurrentHp = Math.Min(CurrentHp + 8, MaxHp);
        Intellect += 3;
        // MaxMana automatically increases because it is computed from Intellect.
        // Restore some mana as a reward for leveling up.
        CurrentMana = Math.Min(CurrentMana + 15, MaxMana);
    }
}
