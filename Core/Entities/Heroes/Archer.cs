namespace Heroes_Descent.Core.Entities.Heroes;

// The Archer is a fast, high-risk attacker with strong crit potential.
// Secondary stat : Dexterity — increases CritChance and Speed.
// Resource       : Energy (0–100) — regenerates passively at 10 per 2 seconds.
//                  Multi-Shot costs 30 Energy.
public class Archer : Hero
{
    private readonly Random _rng = new();

    // --- Secondary stat ---

    // Dexterity drives both crit chance and speed.
    // Increases by 3 on each level-up.
    public int Dexterity { get; private set; } = 12;

    // Crit chance is computed from Dexterity so it scales automatically.
    // Formula: 15% base + Dexterity, capped at 60%.
    // At start (Dexterity 12): 27% crit. Cap reached at Dexterity 45.
    public int CritChance => Math.Min(15 + Dexterity, 60);

    // --- Energy resource ---

    public int MaxEnergy { get; } = 100;
    public int CurrentEnergy { get; private set; }

    private const int AbilityCost        = 30;   // Energy cost per Multi-Shot
    private const int EnergyRegenAmount  = 10;   // Energy gained per regen tick
    private static readonly TimeSpan EnergyRegenInterval = TimeSpan.FromSeconds(2);

    // Tracks when energy was last regenerated.
    // TryRegenEnergy() compares DateTime.UtcNow against this timestamp.
    private DateTime _lastEnergyRegen = DateTime.UtcNow;

    public Archer(string name)
    {
        Name = name;
        Class = HeroClass.Archer;
        MaxHp     = 85;
        BaseAttack = 18;
        Defense   = 6;
        Speed     = 10 + (Dexterity / 3);   // 14 at start (Dexterity 12)
        CurrentHp = MaxHp;
        CurrentEnergy = MaxEnergy / 2;       // Start at 50 so Multi-Shot is usable immediately
    }

    public override string AbilityName => "Multi-Shot";
    public override string AbilityDescription =>
        $"Costs {AbilityCost} Energy. Fires at 2 different enemies for full attack damage each.";

    // Must be called by the game loop every tick.
    // Adds 10 Energy every 2 seconds until the Energy bar is full.
    // If nobody calls this method, Energy will never regenerate.
    public void TryRegenEnergy()
    {
        if (CurrentEnergy >= MaxEnergy) return;
        if (DateTime.UtcNow - _lastEnergyRegen < EnergyRegenInterval) return;

        CurrentEnergy = Math.Min(MaxEnergy, CurrentEnergy + EnergyRegenAmount);
        _lastEnergyRegen = DateTime.UtcNow;
    }

    // Overrides the base BasicAttack to roll for a critical hit.
    // Crits deal double damage. Crit chance scales with Dexterity.
    public override int BasicAttack()
    {
        bool isCrit = _rng.Next(100) < CritChance;
        return isCrit ? BaseAttack * 2 : BaseAttack;
    }

    public override bool CanUseAbility() => CurrentEnergy >= AbilityCost;

    // Fires arrows at 2 separate enemies.
    // Returns 2 (the target count); the game engine picks 2 enemies and
    // calls BasicAttack() against each one, so each arrow can independently crit.
    public override int UseAbility()
    {
        if (CurrentEnergy < AbilityCost) return 0;
        CurrentEnergy -= AbilityCost;
        return 2;
    }

    // On level-up, Archer gains HP, BaseAttack, and Dexterity.
    // Speed is recalculated after Dexterity grows so it reflects the new value.
    protected override void OnLevelUp()
    {
        MaxHp      += 10;
        CurrentHp   = Math.Min(CurrentHp + 10, MaxHp);
        BaseAttack += 4;
        Dexterity  += 3;
        Speed       = 10 + (Dexterity / 3);   // Recalculate speed with updated Dexterity
    }
}
