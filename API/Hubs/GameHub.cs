// GameHub.cs — the SignalR hub that handles all real-time communication between
// the server and connected players.
//
// Every player action (attack, ability, move room) arrives here as a hub method call.
// After resolving the action through GameService, the hub broadcasts an updated
// GameStateDto to the entire session group so every client stays in sync.
//
// New hub methods should follow the same pattern:
//   1. Fetch the session (return early if missing).
//   2. Acquire session.Lock before touching any mutable state.
//   3. Delegate logic to GameService and collect log lines.
//   4. Build the DTO inside the lock, then broadcast outside it.

using Heroes_Descent.Application.Services;
using Heroes_Descent.Core.Entities.Heroes;
using Heroes_Descent.Core.GameState;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Heroes_Descent.API.Hubs;

// GameHub is the real-time multiplayer connection point.
// It uses SignalR — a library that keeps a persistent WebSocket open between
// the browser and the server so messages can flow both ways instantly.
//
// How it works:
//   - The frontend calls hub methods (e.g. AttackNearest) to send player actions.
//   - The hub calls Clients.Group(...).SendAsync("GameStateUpdate", dto) to push
//     the updated game state to every player in that session simultaneously.
//   - Players are grouped by session ID so they only receive updates for their own game.
//
// [Authorize] means the client must include a valid JWT token when connecting —
// unauthenticated connections are rejected before any method is reached.
[Authorize]
public class GameHub : Hub
{
    private readonly SessionManager _sessions;
    private readonly GameService _game;

    public GameHub(SessionManager sessions, GameService game)
    {
        _sessions = sessions;
        _game     = game;
    }

    // ── Session lifecycle ─────────────────────────────────────────────────────

    // Called when a player clicks "Create Dungeon".
    // Generates a new dungeon, spawns the hero, and returns the 6-char session code
    // that the player can share so friends can join.
    public async Task<string> CreateSession(string username, string heroClassStr)
    {
        var userId    = Context.UserIdentifier!;   // comes from the JWT "sub" claim
        var heroClass = Enum.Parse<HeroClass>(heroClassStr, ignoreCase: true);

        var session = _sessions.CreateSession(userId, username, Context.ConnectionId, heroClass);

        // Add this connection to a SignalR group named after the session ID.
        // Every future Clients.Group(sessionId).SendAsync(...) call will reach
        // all connections in that group — i.e. all players in the session.
        await Groups.AddToGroupAsync(Context.ConnectionId, session.SessionId);

        Application.Dtos.GameStateDto dto;
        lock (session.Lock) dto = _game.BuildDto(session);
        await Clients.Group(session.SessionId).SendAsync("GameStateUpdate", dto);

        return session.SessionId;   // sent back to the caller as the join code
    }

    // Called when a player types a session code and clicks "Join".
    // Returns false if the code is wrong, the session is full, or the game is already over.
    public async Task<bool> JoinSession(string sessionId, string username, string heroClassStr)
    {
        var userId    = Context.UserIdentifier!;
        var heroClass = Enum.Parse<HeroClass>(heroClassStr, ignoreCase: true);

        if (!_sessions.TryJoinSession(sessionId, userId, username, Context.ConnectionId, heroClass, out var session))
            return false;

        await Groups.AddToGroupAsync(Context.ConnectionId, sessionId);

        Application.Dtos.GameStateDto dto;
        lock (session!.Lock) dto = _game.BuildDto(session);

        // Broadcast to the whole group so existing players see the new arrival.
        await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);

        return true;
    }

    // ── Position sync ─────────────────────────────────────────────────────────

    // Called by the frontend every ~50 ms with the player's current position.
    // The server just stores it — no broadcast here.
    // The EnemyAiService picks up the latest positions each 100 ms tick and
    // includes them in the next GameStateUpdate broadcast.
    // This design avoids a broadcast storm if many players are moving at once.
    public void SendPosition(string sessionId, float x, float y)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;
        lock (session.Lock)
        {
            var player = session.Players.FirstOrDefault(p => p.UserId == userId);
            if (player is null) return;

            // Clamp to room bounds on the server so a cheating client can't
            // teleport outside the room walls.
            player.X = Math.Clamp(x, RoomBounds.Left + 16, RoomBounds.Right  - 16);
            player.Y = Math.Clamp(y, RoomBounds.Top  + 16, RoomBounds.Bottom - 16);
        }
    }

    // ── Player actions ────────────────────────────────────────────────────────

    // Called when the player presses SPACE with a mouse-aimed direction.
    // dirX/dirY is a normalised direction vector from the client.
    // Warrior: cone melee hit. Archer/Wizard: ray-cast skillshot.
    public async Task AttackDirectional(string sessionId, float dirX, float dirY)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            if (session.IsGameOver || session.IsVictory) return;
            var (acted, log) = _game.AttackDirectional(session, userId, dirX, dirY);
            if (!acted) return;
            session.AddLogRange(log);
            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // Called when the player presses SPACE.
    // The server resolves the attack (finds nearest enemy, checks range and cooldown)
    // and immediately broadcasts the result to the whole session so every player
    // sees the damage number and updated enemy health.
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
            if (!acted) return;   // on cooldown or out of range — nothing to broadcast
            session.AddLogRange(log);
            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // Called when the player presses Q.
    // dirX/dirY is the normalised aim direction — used by the Archer's Multi-Shot;
    // ignored by Warrior and Wizard whose abilities are non-directional.
    public async Task UseAbility(string sessionId, float dirX = 0f, float dirY = 0f)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            if (session.IsGameOver || session.IsVictory) return;
            var (acted, log) = _game.PlayerUseAbility(session, userId, dirX, dirY);
            if (!acted) return;
            session.AddLogRange(log);
            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // Called when the player clicks "Next Room" (only enabled once the room is cleared).
    // Advances the room index, resets player spawn positions, and gives a 2-second grace
    // period before enemies start attacking again (so players can orient themselves).
    public async Task MoveToNextRoom(string sessionId)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            if (!session.CurrentRoom.IsCleared) return;

            session.CurrentRoomIndex++;
            session.ActiveFlameWaves.Clear();   // discard any waves still in flight

            // Teleport all players back to their spawn positions for the new room.
            for (int i = 0; i < session.Players.Count; i++)
            {
                var (sx, sy) = GameSession.GetSpawn(i);
                session.Players[i].X = sx;
                session.Players[i].Y = sy;
            }

            var room = session.CurrentRoom;

            if (room.Type == RoomType.ExitHall)
            {
                // Entering the Exit Hall after defeating the boss — victory is achieved.
                session.IsVictory = true;
                session.AddLog("» VICTORY — the dungeon is conquered!");
            }
            else
            {
                // Delay first enemy attack by 2 seconds so players aren't instantly hit.
                session.LastEnemyTick = DateTime.UtcNow.AddSeconds(2);

                session.AddLog($"» Room {session.CurrentRoomIndex + 1}/{session.Rooms.Count} — {room.Type}");
            }

            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // ── Prestige ──────────────────────────────────────────────────────────────

    // Called when a player clicks "Delve Deeper" after a victory.
    // Resets the session into the next prestige run with scaled enemies
    // and broadcasts the fresh state to every player in the group.
    public async Task DelveDeeper(string sessionId)
    {
        var session = _sessions.TryDelveDeeper(sessionId);
        if (session is null) return;

        Application.Dtos.GameStateDto dto;
        lock (session.Lock) dto = _game.BuildDto(session);
        await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // ── Chest interaction ─────────────────────────────────────────────────────

    // Called when a player clicks the treasure chest sprite.
    // Locks the chest for this player so the loot window opens only for them.
    public async Task InteractChest(string sessionId)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            var (acted, log) = _game.TryInteractChest(session, userId);
            if (!acted) return;
            session.AddLogRange(log);
            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // Called when the player clicks the gold item in the loot window.
    // Awards the gold to the player and closes their loot window.
    public async Task ClaimChest(string sessionId)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            var (acted, log) = _game.TryClaimChest(session, userId);
            if (!acted) return;
            session.AddLogRange(log);
            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // Called when the player clicks Close without claiming the gold.
    // Releases the chest lock so another player can open it.
    public async Task CloseChest(string sessionId)
    {
        var session = _sessions.GetSession(sessionId);
        if (session is null) return;

        var userId = Context.UserIdentifier!;

        Application.Dtos.GameStateDto? dto = null;
        lock (session.Lock)
        {
            var (acted, log) = _game.TryCloseChest(session, userId);
            if (!acted) return;
            session.AddLogRange(log);
            dto = _game.BuildDto(session);
        }

        if (dto is not null)
            await Clients.Group(sessionId).SendAsync("GameStateUpdate", dto);
    }

    // ── Disconnect cleanup ────────────────────────────────────────────────────

    // Fired automatically by SignalR when a player's browser tab closes,
    // loses connection, or the player navigates away.
    // We remove them from the session and notify the remaining players.
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
