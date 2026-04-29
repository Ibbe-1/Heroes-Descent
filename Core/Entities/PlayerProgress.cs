namespace Heroes_Descent.Core.Entities;

public class PlayerProgress
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public int Level { get; set; } = 1;
    public int Experience { get; set; } = 0;
    public int GamesPlayed { get; set; } = 0;
    public int TotalKills { get; set; } = 0;
    // TODO: add more stats as the game develops

    public ApplicationUser User { get; set; } = null!;
}
