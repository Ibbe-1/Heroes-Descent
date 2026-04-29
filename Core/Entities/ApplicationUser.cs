using Microsoft.AspNetCore.Identity;

namespace Heroes_Descent.Core.Entities;

public class ApplicationUser : IdentityUser
{
    // Add game-specific user fields here (e.g. display name, avatar)
    public PlayerProgress? Progress { get; set; }
}
