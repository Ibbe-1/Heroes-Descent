// Friendship.cs
// Represents a one-directional "friend added" relationship between two players.
// When user A adds user B, one Friendship row is created (UserId=A, FriendId=B).
// This means you can add someone without them adding you back — no request/accept
// flow yet. A bidirectional system can be built later when needed.

namespace Heroes_Descent.Core.Entities;

public class Friendship
{
    public int Id { get; set; }

    // The player who did the adding
    public string UserId { get; set; } = string.Empty;
    public ApplicationUser User { get; set; } = null!;

    // The player who was added
    public string FriendId { get; set; } = string.Empty;
    public ApplicationUser Friend { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
