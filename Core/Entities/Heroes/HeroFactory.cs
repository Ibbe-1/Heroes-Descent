namespace Heroes_Descent.Core.Entities.Heroes;

public static class HeroFactory
{
    public static Hero Create(HeroClass heroClass, string username) => heroClass switch
    {
        HeroClass.Warrior => new Warrior(username),
        HeroClass.Wizard  => new Wizard(username),
        HeroClass.Archer  => new Archer(username),
        _                 => throw new ArgumentOutOfRangeException(nameof(heroClass)),
    };
}
