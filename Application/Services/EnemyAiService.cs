using Heroes_Descent.API.Hubs;
using Microsoft.AspNetCore.SignalR;
using System.Diagnostics;

namespace Heroes_Descent.Application.Services;

public class EnemyAiService : BackgroundService
{
    private readonly SessionManager _sessions;
    private readonly IHubContext<GameHub> _hub;
    private readonly GameService _game;

    public EnemyAiService(SessionManager sessions, IHubContext<GameHub> hub, GameService game)
    {
        _sessions = sessions;
        _hub = hub;
        _game = game;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var sw = Stopwatch.StartNew();
        long lastTick = sw.ElapsedMilliseconds;

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(100, stoppingToken);

            long now = sw.ElapsedMilliseconds;
            float deltaMs = now - lastTick;
            lastTick = now;

            foreach (var session in _sessions.GetActiveSessions().ToList())
            {
                Application.Dtos.GameStateDto? dto = null;

                lock (session.Lock)
                {
                    if (session.IsGameOver || session.IsVictory) continue;
                    if (!session.Players.Any()) continue;

                    bool anyAliveEnemies = session.CurrentRoom.Enemies.Any(e => e.Enemy.IsAlive);

                    if (anyAliveEnemies)
                    {
                        _game.MoveEnemies(session, deltaMs);
                        var attackLog = _game.TickEnemyAttacks(session);
                        session.AddLogRange(attackLog);
                    }

                    dto = _game.BuildDto(session);
                }

                if (dto is not null)
                    await _hub.Clients.Group(session.SessionId)
                        .SendAsync("GameStateUpdate", dto, stoppingToken);
            }
        }
    }
}
