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

    // Prevents the chest from paying out twice if MoveToNextRoom is somehow
    // called while still on a chest room (e.g. a client sending a duplicate message).
    public bool ChestOpened { get; private set; }

    // True once every enemy in the room is dead. For TreasureChest rooms
    // this means the ChestGuardian has been defeated.
    public bool IsCleared => Enemies.All(e => !e.Enemy.IsAlive);

    public RoomState(int index, RoomType type, List<EnemyInstance> enemies, int chestGold = 0)
    {
        Index = index;
        Type = type;
        Enemies = enemies;
        ChestGold = chestGold;
    }

    // Called from GameHub.MoveToNextRoom when the party enters a TreasureChest room.
    public void OpenChest() => ChestOpened = true;
}
