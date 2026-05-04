using System.Collections.Concurrent;
using Heroes_Descent.Core.Entities.Heroes;
using Heroes_Descent.Core.GameState;

namespace Heroes_Descent.Application.Services;

// SessionManager is the global registry of all active dungeon sessions.
// It is registered as a Singleton in Program.cs, so one instance lives for
// the entire lifetime of the server process.
//
// All sessions are kept in a ConcurrentDictionary so they can be looked up
// safely from multiple threads (hub methods + the background AI service).
public class SessionManager
{
    // sessionId → GameSession.  The key is the 6-char code players share to join.
    private readonly ConcurrentDictionary<string, GameSession> _sessions = new();
    private readonly DungeonGenerator _generator;

    public SessionManager(DungeonGenerator generator) => _generator = generator;

    // Creates a brand-new dungeon session for the player who clicked "Create Dungeon".
    // Generates a fresh procedural dungeon, spawns the player's hero at position 0,
    // and stores the session so others can join it.
    public GameSession CreateSession(string userId, string username, string connectionId, HeroClass heroClass)
    {
        var sessionId = GenerateSessionId();
        var rooms  = _generator.Generate(floorNumber: 1);
        var session = new GameSession(sessionId, rooms);

        var hero      = HeroFactory.Create(heroClass, username);
        var (sx, sy)  = GameSession.GetSpawn(0);   // first player always spawns at centre
        session.Players.Add(new PlayerState(userId, username, connectionId, hero, sx, sy));
        session.AddLog($"» {username} descends as {heroClass}!");
        session.AddLog($"» Room 1 of {rooms.Count} — {rooms[0].Type}");

        _sessions[sessionId] = session;
        return session;
    }

    // Lets a second (or third, or fourth) player join an existing session by code.
    // Returns false if the session doesn't exist, is full, is already over,
    // or the same account tries to join twice.
    public bool TryJoinSession(
        string sessionId, string userId, string username,
        string connectionId, HeroClass heroClass,
        out GameSession? session)
    {
        session = null;
        if (!_sessions.TryGetValue(sessionId, out var s)) return false;

        lock (s.Lock)   // lock because EnemyAiService may be reading players at the same time
        {
            if (s.Players.Count >= GameSession.MaxPlayers) return false;
            if (s.IsGameOver || s.IsVictory)               return false;
            if (s.Players.Any(p => p.UserId == userId))    return false;

            var hero     = HeroFactory.Create(heroClass, username);
            var (sx, sy) = GameSession.GetSpawn(s.Players.Count); // offset spawn by join order
            s.Players.Add(new PlayerState(userId, username, connectionId, hero, sx, sy));
            s.AddLog($"» {username} joined as {heroClass}!");
        }

        session = s;
        return true;
    }

    public GameSession? GetSession(string sessionId) =>
        _sessions.TryGetValue(sessionId, out var s) ? s : null;

    // Called from GameHub.OnDisconnectedAsync when a player's WebSocket closes.
    // Removes the player from their session and deletes the session entirely
    // if it becomes empty (no point keeping an empty dungeon in memory).
    public (string? sessionId, string? username) RemoveByConnectionId(string connectionId)
    {
        foreach (var (key, session) in _sessions)
        {
            PlayerState? player;
            lock (session.Lock)
            {
                player = session.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
                if (player is null) continue;
                session.Players.Remove(player);
                session.AddLog($"» {player.Username} has left.");
                if (session.Players.Count == 0)
                    _sessions.TryRemove(key, out _);
            }
            return (key, player.Username);
        }
        return (null, null);
    }

    // Returns only sessions where the game is still going — used by EnemyAiService
    // to avoid processing sessions that have already ended.
    public IEnumerable<GameSession> GetActiveSessions() =>
        _sessions.Values.Where(s => !s.IsGameOver && !s.IsVictory);

    // Produces a random 6-character alphanumeric code such as "AB3K9Z".
    // Avoids ambiguous characters (0/O, 1/I) so it's easier to share verbally.
    private static string GenerateSessionId()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return new string(Enumerable.Range(0, 6)
            .Select(_ => chars[Random.Shared.Next(chars.Length)])
            .ToArray());
    }
}
