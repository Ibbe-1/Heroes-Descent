using System.Collections.Concurrent;

namespace Heroes_Descent.Core.GameState;

// GameSession is the single source of truth for one active dungeon run.
// It lives entirely in server memory — nothing here is saved to the database.
// Up to 4 players share one session; they all see the same rooms and enemies.
//
// Thread safety: the EnemyAiService (background thread) and the SignalR hub
// (one thread per player message) can both touch session state at the same time.
// Every caller must take Lock before reading or writing mutable fields.
public class GameSession
{
    // All state mutations must happen inside  lock(session.Lock) { ... }
    // so the background AI service and hub methods don't corrupt each other.
    public readonly object Lock = new();

    public string SessionId { get; }

    // The players currently in this session. Modified only while holding Lock.
    public List<PlayerState> Players { get; } = [];

    // All rooms in this dungeon run, generated once at session creation.
    public List<RoomState> Rooms { get; }

    // Which room the party is in right now. Advances when the room is cleared.
    public int CurrentRoomIndex { get; set; } = 0;

    public bool IsGameOver { get; set; } = false;
    public bool IsVictory  { get; set; } = false;

    // Rolling log of recent events (max 25 lines).
    // Sent to all clients on every state broadcast so they can display it.
    public List<string> RecentLog { get; } = [];

    // Tracks when each player last landed a basic attack.
    // Used to enforce per-hero attack cooldowns without a turn queue.
    // ConcurrentDictionary because it's read without the session lock in BuildDto.
    public ConcurrentDictionary<string, DateTime> LastAttackTime { get; } = new();

    // Tracks when enemies last attacked.
    // The AI service checks this and only fires enemy attacks every ~800 ms.
    public DateTime LastEnemyTick { get; set; } = DateTime.UtcNow;

    // Flame waves currently sweeping across the room — fired by the Dark Mage boss.
    // Three are active at once during a volley; each is removed when it exits the room.
    public List<FlameWave> ActiveFlameWaves { get; } = [];

    // Fireballs currently in flight across the room.
    // Each entry is created when the boss fires and removed when the fireball
    // either hits a player or travels beyond MaxRange.
    // Positions are updated every 100 ms tick by GameService.MoveProjectiles.
    public List<ActiveProjectile> ActiveProjectiles { get; } = [];

    public const int MaxPlayers = 4;

    // Shortcut so callers don't have to index into the Rooms list every time.
    public RoomState CurrentRoom => Rooms[CurrentRoomIndex];

    // Returns the spawn (x, y) for the Nth player joining.
    // Clamps to the last entry if more than 4 players somehow join.
    public static (float x, float y) GetSpawn(int playerIndex) =>
        RoomBounds.PlayerSpawns[Math.Min(playerIndex, RoomBounds.PlayerSpawns.Length - 1)];

    public GameSession(string sessionId, List<RoomState> rooms)
    {
        SessionId = sessionId;
        Rooms = rooms;
    }

    // Adds one line to the combat log and trims the oldest entry if over 25.
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
