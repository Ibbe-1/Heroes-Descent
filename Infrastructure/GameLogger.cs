using Heroes_Descent.Core.Interfaces;

namespace Heroes_Descent.Infrastructure;

public class GameLogger : IGameLogger
{
    private readonly ILogger<GameLogger> _logger;

    public GameLogger(ILogger<GameLogger> logger)
    {
        _logger = logger;
    }

    public void Info(string message) => _logger.LogInformation(message);
    public void Warning(string message) => _logger.LogWarning(message);
    public void Error(string message, Exception? ex = null) => _logger.LogError(ex, message);
}
