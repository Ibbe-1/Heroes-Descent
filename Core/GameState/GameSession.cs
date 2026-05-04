using System.Collections.Concurrent;

namespace Heroes_Descent.Core.GameState;

public class GameSession
{
    public readonly object Lock = new();

    public string SessionId { get; }
    public List<PlayerState> Players { get; } = [];
    public List<RoomState> Rooms { get; }
    public int CurrentRoomIndex { get; set; } = 0;
    public bool IsGameOver { get; set; } = false;
    public bool IsVictory { get; set; } = false;
    public List<string> RecentLog { get; } = [];

    public ConcurrentDictionary<string, DateTime> LastAttackTime { get; } = new();
    public DateTime LastEnemyTick { get; set; } = DateTime.UtcNow;

    public const int MaxPlayers = 4;

    public RoomState CurrentRoom => Rooms[CurrentRoomIndex];

    public static (float x, float y) GetSpawn(int playerIndex) =>
        RoomBounds.PlayerSpawns[Math.Min(playerIndex, RoomBounds.PlayerSpawns.Length - 1)];

    public GameSession(string sessionId, List<RoomState> rooms)
    {
        SessionId = sessionId;
        Rooms = rooms;
    }

    public void AddLog(string message)
    {
        RecentLog.Add(message);
        if (RecentLog.Count > 25) RecentLog.RemoveAt(0);
    }

    public void AddLogRange(IEnumerable<string> messages)
    {
        foreach (var m in messages) AddLog(m);
    }
}
