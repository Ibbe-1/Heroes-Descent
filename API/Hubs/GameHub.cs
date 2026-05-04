using Heroes_Descent.Application.Services;
using Heroes_Descent.Core.Entities.Heroes;
using Heroes_Descent.Core.GameState;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Heroes_Descent.API.Hubs;

[Authorize]
public class GameHub : Hub
{
    private readonly SessionManager _sessions;
    private readonly GameService _game;

    public GameHub(SessionManager sessions, GameService game)
    {
        _sessions = sessions;
        _game = game;
    }

    // ── Session lifecycle ─────────────────────────────────────────────────────

    public async Task<string> CreateSession(string username, string heroClassStr)
    {
        var userId = Context.UserIdentifier!;
        var heroClass = Enum.Parse<HeroClass>(heroClassStr, ignoreCase: true);

        var session = _sessions.CreateSession(userId, username, Context.ConnectionId, heroClass);
        await Groups.AddToGroupAsync(Context.ConnectionId, session.SessionId);

        Application.Dtos.GameStateDto dto;
        lock (session.Lock) dto = _game.BuildDto(session);
        await Clients.Group(session.SessionId).SendAsync("GameStateUpdate", dto);

        return session.SessionId;
    }

    public async Task<bool> JoinSession(string sessionId, string username, string heroClassStr)
    {
        var userId = Context.UserIdentifier!;
        var heroClass = Enum.Parse<HeroClass>(heroClassStr, ignoreCase: true);

        if (!_sessions.TryJoinSession(sessionId, userId, username, Context.ConnectionId, heroClass, out var session))
            return false;

        await Groups.AddToGroupAsync(Context.ConnectionId, sessionId);

        Application.Dtos.GameStateDto dto;
        lock (session!.Lock) dto = _game.BuildDto(session);
        await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);

        return true;
    }

    // ── Position sync ─────────────────────────────────────────────────────────

    public void SendPosition(string sessionId, float x, float y)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;
        lock (session.Lock)
        {
            var player = session.Players.FirstOrDefault(p => p.UserId == userId);
            if (player is null) return;
            player.X = Math.Clamp(x, RoomBounds.Left + 16, RoomBounds.Right - 16);
            player.Y = Math.Clamp(y, RoomBounds.Top + 16, RoomBounds.Bottom - 16);
        }
        // Position is picked up by EnemyAiService in the next 100ms broadcast.
    }

    // ── Player actions ────────────────────────────────────────────────────────

    public async Task AttackNearest(string sessionId)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            if (session.IsGameOver || session.IsVictory) return;
            var (acted, log) = _game.AttackNearest(session, userId);
            if (!acted) return;
            session.AddLogRange(log);
            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    public async Task UseAbility(string sessionId)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            if (session.IsGameOver || session.IsVictory) return;
            var (acted, log) = _game.PlayerUseAbility(session, userId);
            if (!acted) return;
            session.AddLogRange(log);
            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    public async Task MoveToNextRoom(string sessionId)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            if (!session.CurrentRoom.IsCleared) return;

            if (session.CurrentRoomIndex >= session.Rooms.Count - 1)
            {
                session.IsVictory = true;
                session.AddLog("» VICTORY — the dungeon is conquered!");
            }
            else
            {
                session.CurrentRoomIndex++;
                session.LastEnemyTick = DateTime.UtcNow.AddSeconds(2);
                // Reset all player positions to spawn
                for (int i = 0; i < session.Players.Count; i++)
                {
                    var (sx, sy) = GameSession.GetSpawn(i);
                    session.Players[i].X = sx;
                    session.Players[i].Y = sy;
                }
                var room = session.CurrentRoom;
                session.AddLog($"» Room {session.CurrentRoomIndex + 1}/{session.Rooms.Count} — {room.Type}");
            }

            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // ── Disconnect cleanup ────────────────────────────────────────────────────

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var (sessionId, _) = _sessions.RemoveByConnectionId(Context.ConnectionId);
        if (sessionId is not null)
        {
            var session = _sessions.GetSession(sessionId);
            if (session is not null)
            {
                Application.Dtos.GameStateDto dto;
                lock (session.Lock) dto = _game.BuildDto(session);
                await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
            }
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, sessionId);
        }

        await base.OnDisconnectedAsync(exception);
    }
}
