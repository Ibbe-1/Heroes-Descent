namespace Heroes_Descent.Application.Dtos;

public record GameStateDto(
    string SessionId,
    int CurrentRoomIndex,
    int TotalRooms,
    RoomDto CurrentRoom,
    List<PlayerDto> Players,
    List<string> Log,
    bool IsGameOver,
    bool IsVictory
);

public record RoomDto(
    string Type,
    List<EnemyDto> Enemies,
    bool IsCleared
);

public record EnemyDto(
    string Id,
    string Name,
    int Health,
    int MaxHealth,
    bool IsAlive,
    float X,
    float Y
);

public record PlayerDto(
    string UserId,
    string Username,
    string HeroClass,
    int CurrentHp,
    int MaxHp,
    bool IsAlive,
    int Resource,
    int MaxResource,
    string ResourceName,
    bool CanUseAbility,
    string AbilityName,
    int AttackCooldownMs,
    float X,
    float Y
);
