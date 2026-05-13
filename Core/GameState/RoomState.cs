namespace Heroes_Descent.Core.GameState;

public class RoomState
{
    public int Index { get; }
    public RoomType Type { get; }
    public List<EnemyInstance> Enemies { get; }

    // Amount of gold this chest awards. Decided at dungeon generation time so
    // the payout is fixed per run — players can't retry a chest for a better roll.
    // Zero for non-TreasureChest rooms.
    public int ChestGold { get; }

    // userId of whichever player currently has the chest loot window open.
    // Null when nobody is interacting. Ensures only one player at a time can browse the chest.
    public string? ChestOpenerId { get; private set; }

    // Players who have already claimed their gold. Each player gets one claim.
    private readonly HashSet<string> _claimers = [];

    // True once every enemy in the room is dead. For TreasureChest rooms
    // this means the guardian has been defeated.
    public bool IsCleared => Enemies.All(e => !e.Enemy.IsAlive);

    public RoomState(int index, RoomType type, List<EnemyInstance> enemies, int chestGold = 0)
    {
        Index = index;
        Type = type;
        Enemies = enemies;
        ChestGold = chestGold;
    }

    // Attempts to lock the chest for this player.
    // Fails if the room isn't a cleared TreasureChest, someone else holds the lock, or this player already claimed.
    public bool TryLockChest(string userId)
    {
        if (Type != RoomType.TreasureChest || !IsCleared) return false;
        if (ChestGold == 0) return false;   // Mimic room — no chest to open
        if (ChestOpenerId is not null) return false;
        if (_claimers.Contains(userId)) return false;
        ChestOpenerId = userId;
        return true;
    }

    // Releases the lock without paying out — only the current holder can do this.
    public bool ReleaseChest(string userId)
    {
        if (ChestOpenerId != userId) return false;
        ChestOpenerId = null;
        return true;
    }

    // Marks this player as having claimed their gold and releases the lock.
    public bool MarkClaimed(string userId)
    {
        if (ChestOpenerId != userId) return false;
        _claimers.Add(userId);
        ChestOpenerId = null;
        return true;
    }

    public bool HasClaimed(string userId) => _claimers.Contains(userId);
}
