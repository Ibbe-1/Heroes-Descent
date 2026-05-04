namespace Heroes_Descent.Application.Dtos;

// DTOs (Data Transfer Objects) are the shapes that get serialised to JSON
// and sent over SignalR to every player in the session on every state update.
// They are plain data — no methods, no references to domain objects.
// Using C# records gives us immutable, value-based types with minimal boilerplate.

// The root object broadcast to all clients after any game event.
// Contains everything the frontend needs to render one frame of the game.
public record GameStateDto(
    string SessionId,
    int    CurrentRoomIndex,   // 0-based index into the room list
    int    TotalRooms,
    RoomDto CurrentRoom,
    List<PlayerDto> Players,
    List<string> Log,          // last 15 combat log lines
    bool IsGameOver,
    bool IsVictory
);

// Describes the room the party is currently in.
public record RoomDto(
    string Type,               // "Normal", "Elite", or "Boss"
    List<EnemyDto> Enemies,
    bool IsCleared             // true when every enemy is dead — enables advance button
);

// One enemy in the current room.
// X and Y are pixel coordinates in the same space the Phaser scene uses,
// so the frontend can place the enemy sprite exactly where the server says it is.
public record EnemyDto(
    string Id,          // Guid as string — matched to sprites in the Phaser scene
    string Name,
    int    Health,
    int    MaxHealth,
    bool   IsAlive,
    float  X,           // server-authoritative position
    float  Y
);

// One player in the session.
// Resource / MaxResource / ResourceName cover all three hero classes:
//   Warrior → Rage, Wizard → Mana, Archer → Energy.
// AttackCooldownMs tells the frontend how long to disable the attack button locally.
// X and Y let other clients render this player's sprite at the right position.
public record PlayerDto(
    string UserId,
    string Username,
    string HeroClass,
    int    CurrentHp,
    int    MaxHp,
    bool   IsAlive,
    int    Resource,
    int    MaxResource,
    string ResourceName,
    bool   CanUseAbility,
    string AbilityName,
    int    AttackCooldownMs,
    float  X,
    float  Y
);
