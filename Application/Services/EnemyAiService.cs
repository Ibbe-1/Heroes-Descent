using Heroes_Descent.API.Hubs;
using Microsoft.AspNetCore.SignalR;
using System.Diagnostics;

namespace Heroes_Descent.Application.Services;

// EnemyAiService is an ASP.NET Core BackgroundService — it runs on its own thread
// for the entire lifetime of the server, completely independent of HTTP requests.
//
// Every 100 ms it loops through every active session and:
//   1. Moves each alive enemy one step toward the nearest player.
//   2. If 800 ms have passed, lets enemies attack any player within range.
//   3. Broadcasts the updated game state to all clients in the session group.
//
// This is what makes the game "soft real-time": enemies move and act on their own
// schedule rather than waiting for a player to take a turn.
public class EnemyAiService : BackgroundService
{
    private readonly SessionManager _sessions;

    // IHubContext lets a non-hub class (this background service) push messages
    // to SignalR groups — the same groups the hub uses for multiplayer sync.
    private readonly IHubContext<GameHub> _hub;

    private readonly GameService _game;

    public EnemyAiService(SessionManager sessions, IHubContext<GameHub> hub, GameService game)
    {
        _sessions = sessions;
        _hub      = hub;
        _game     = game;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Stopwatch gives us precise elapsed time for smooth movement interpolation.
        // Using DateTime.UtcNow would be less accurate due to OS timer resolution.
        var sw       = Stopwatch.StartNew();
        long lastTick = sw.ElapsedMilliseconds;

        while (!stoppingToken.IsCancellationRequested)
        {
            // Sleep 100 ms between ticks → 10 position updates per second.
            // Fast enough to look smooth, cheap enough not to flood the network.
            await Task.Delay(100, stoppingToken);

            long  now     = sw.ElapsedMilliseconds;
            float deltaMs = now - lastTick;   // actual time since last tick (may be > 100 ms)
            lastTick      = now;

            // ToList() snapshots the collection so sessions added/removed mid-loop don't crash.
            foreach (var session in _sessions.GetActiveSessions().ToList())
            {
                Application.Dtos.GameStateDto? dto = null;

                // Lock the session while we read and modify state.
                // The SignalR hub methods also lock before changing state,
                // so enemy movement and player attacks can never happen simultaneously
                // and corrupt HP values or positions.
                lock (session.Lock)
                {
                    if (session.IsGameOver || session.IsVictory) continue;
                    if (!session.Players.Any())                  continue;

                    bool anyAliveEnemies = session.CurrentRoom.Enemies.Any(e => e.Enemy.IsAlive);

                    if (anyAliveEnemies)
                    {
                        // Step 1: slide every enemy toward the nearest player.
                        // The Golem is frozen inside this call while it is charging its laser.
                        _game.MoveEnemies(session, deltaMs);

                        // Step 2: Golem laser charge — check HP thresholds, advance charge timer,
                        // and fire when the 2 s wind-up completes. Runs before regular attacks so
                        // the laser can interrupt normal melee/ranged on the tick it fires.
                        var laserLog = _game.TickGolemLaserCharge(session);
                        session.AddLogRange(laserLog);

                        // Step 3: decide whether any enemy attacks this tick and apply damage.
                        // The boss may also spawn a new fireball here (ranged shot on its own cooldown).
                        // The Golem skips normal attacks while it is charging (handled inside).
                        var attackLog = _game.TickEnemyAttacks(session);
                        session.AddLogRange(attackLog);
                    }

                    // Step 3: advance every fireball that is currently in flight.
                    // Runs even if all enemies are dead — a fireball fired in the boss's
                    // last moment should still be able to hit a player.
                    // MoveProjectiles returns a log entry if a player is hit.
                    if (session.ActiveProjectiles.Count > 0)
                    {
                        var projLog = _game.MoveProjectiles(session, deltaMs);
                        session.AddLogRange(projLog);
                    }

                    // Build the DTO inside the lock so it captures a consistent snapshot.
                    dto = _game.BuildDto(session);
                }

                // Send the snapshot to every player in this session's SignalR group.
                // We do this outside the lock because await cannot be used inside lock().
                if (dto is not null)
                    await _hub.Clients.Group(session.SessionId)
                        .SendAsync("GameStateUpdate", dto, stoppingToken);
            }
        }
    }
}
