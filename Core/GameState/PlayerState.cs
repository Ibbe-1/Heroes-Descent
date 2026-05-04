using Heroes_Descent.Core.Entities.Heroes;

namespace Heroes_Descent.Core.GameState;

public class PlayerState
{
    public string UserId { get; }
    public string Username { get; }
    public string ConnectionId { get; set; }
    public Hero Hero { get; }

    public float X { get; set; }
    public float Y { get; set; }

    public PlayerState(string userId, string username, string connectionId, Hero hero, float x = 480f, float y = 320f)
    {
        UserId = userId;
        Username = username;
        ConnectionId = connectionId;
        Hero = hero;
        X = x;
        Y = y;
    }
}
