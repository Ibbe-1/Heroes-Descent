namespace Heroes_Descent.Application.Dtos;

// GameStateDto.cs — all the data transfer objects (DTOs) sent over SignalR.
//
// These are the shapes that get serialised to JSON and broadcast to every player
// after any game event (attack, ability use, enemy tick, room advance, etc.).
// They are plain data — no methods, no references to domain objects.
// Using C# records gives us immutable, value-based types with minimal boilerplate.
//
// The matching TypeScript interfaces live in frontend/src/types/gameTypes.ts.
// Keep both files in sync: adding a field here means adding it there too.

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
    string Type,               // "Normal", "Elite", "Boss", or "TreasureChest"
    List<EnemyDto> Enemies,
    bool IsCleared,            // true when all enemies are dead — enables advance button
    int ChestGold              // gold inside the chest; 0 for non-TreasureChest rooms
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
// Gold is the player's current coin total — earned from kills and treasure chests,
// and will be spent at the shop once that is implemented.
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
    float  Y,
    int    Gold
);
