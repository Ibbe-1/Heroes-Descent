// Hubs: SignalR hubs go here.
// GameHub is the real-time connection point between server and all connected players.
// Clients call hub methods to send actions (move, attack); server broadcasts state updates back.

namespace Heroes_Descent.API.Hubs;

public class GameHub : Microsoft.AspNetCore.SignalR.Hub
{
    // TODO: add methods like OnPlayerMove, OnPlayerAttack, etc.
}
