namespace Heroes_Descent.Core.Interfaces;

public interface IGameLogger
{
    void Info(string message);
    void Warning(string message);
    void Error(string message, Exception? ex = null);
}
