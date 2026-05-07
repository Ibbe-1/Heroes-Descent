namespace Heroes_Descent.Core.GameState;

// Represents one ranged projectile fired by the Dark Mage boss in a single AI tick.
// Stored on GameSession.PendingProjectiles, cleared each tick, included in the broadcast DTO
// so the frontend can animate the fireball travelling from the boss to the target.
public record struct ProjectileEvent(float FromX, float FromY, float ToX, float ToY);
