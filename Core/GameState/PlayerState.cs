using Heroes_Descent.Core.Entities.Heroes;

namespace Heroes_Descent.Core.GameState;

// PlayerState holds everything the server needs to know about one connected player
// while a dungeon run is active. It is NOT a database entity — it only exists
// in memory for the lifetime of the session.
public class PlayerState
{
    // The ASP.NET Identity user ID (a GUID string).
    // Used to match hub messages to the correct player.
    public string UserId { get; }

    public string Username { get; }

    // The SignalR connection ID for this player's websocket.
    // Changes if the player reconnects, so it has a public setter.
    public string ConnectionId { get; set; }

    // The hero instance — holds current HP, resource, level, etc.
    // All combat methods (TakeDamage, BasicAttack, UseAbility) live on Hero.
    public Hero Hero { get; }

    // 2D position inside the room, in the same pixel coordinate space
    // that Phaser uses on the frontend (origin = top-left of canvas).
    // Updated whenever the client sends a SendPosition hub message.
    public float X { get; set; }
    public float Y { get; set; }

    // Accumulated gold coins for this run — earned from enemy kills and treasure chests.
    public int Gold { get; set; } = 0;

    // Per-run combat statistics reset to zero at session start.
    public int DamageDealt { get; set; } = 0;
    public int KillCount   { get; set; } = 0;
    public int DeathCount  { get; set; } = 0;

    public PlayerState(string userId, string username, string connectionId, Hero hero,
        float x = 480f, float y = 320f)
    {
        UserId       = userId;
        Username     = username;
        ConnectionId = connectionId;
        Hero         = hero;
        X            = x;
        Y            = y;
    }
}
