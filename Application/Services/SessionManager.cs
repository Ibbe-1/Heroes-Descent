using System.Collections.Concurrent;
using Heroes_Descent.Core.Entities.Heroes;
using Heroes_Descent.Core.GameState;

namespace Heroes_Descent.Application.Services;

public class SessionManager
{
    private readonly ConcurrentDictionary<string, GameSession> _sessions = new();
    private readonly DungeonGenerator _generator;

    public SessionManager(DungeonGenerator generator) => _generator = generator;

    public GameSession CreateSession(string userId, string username, string connectionId, HeroClass heroClass)
    {
        var sessionId = GenerateSessionId();
        var rooms = _generator.Generate(floorNumber: 1);
        var session = new GameSession(sessionId, rooms);

        var hero = HeroFactory.Create(heroClass, username);
        var (sx, sy) = GameSession.GetSpawn(0);
        session.Players.Add(new PlayerState(userId, username, connectionId, hero, sx, sy));
        session.AddLog($"» {username} descends as {heroClass}!");
        session.AddLog($"» Room 1 of {rooms.Count} — {rooms[0].Type}");

        _sessions[sessionId] = session;
        return session;
    }

    public bool TryJoinSession(
        string sessionId, string userId, string username,
        string connectionId, HeroClass heroClass,
        out GameSession? session)
    {
        session = null;
        if (!_sessions.TryGetValue(sessionId, out var s)) return false;

        lock (s.Lock)
        {
            if (s.Players.Count >= GameSession.MaxPlayers) return false;
            if (s.IsGameOver || s.IsVictory) return false;
            if (s.Players.Any(p => p.UserId == userId)) return false;

            var hero = HeroFactory.Create(heroClass, username);
            var (sx, sy) = GameSession.GetSpawn(s.Players.Count);
            s.Players.Add(new PlayerState(userId, username, connectionId, hero, sx, sy));
            s.AddLog($"» {username} joined as {heroClass}!");
        }

        session = s;
        return true;
    }

    public GameSession? GetSession(string sessionId) =>
        _sessions.TryGetValue(sessionId, out var s) ? s : null;

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

    public IEnumerable<GameSession> GetActiveSessions() =>
        _sessions.Values.Where(s => !s.IsGameOver && !s.IsVictory);

    private static string GenerateSessionId()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return new string(Enumerable.Range(0, 6)
            .Select(_ => chars[Random.Shared.Next(chars.Length)])
            .ToArray());
    }
}
