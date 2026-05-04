// AppDbContext.cs
// The Entity Framework database context — all tables are registered here.
// The app auto-migrates on startup (see Program.cs), so teammates don't need
// to run any extra commands after pulling new changes.

using Heroes_Descent.Core.Entities;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Heroes_Descent.Infrastructure.Data;

public class AppDbContext : IdentityDbContext<ApplicationUser>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<PlayerProgress> PlayerProgress => Set<PlayerProgress>();
    public DbSet<Friendship> Friendships => Set<Friendship>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder); // must call base — sets up Identity tables

        // Friendship has two FK columns that both point to ApplicationUser.
        // We configure them explicitly so EF doesn't get confused trying to
        // infer which navigation property maps to which foreign key.
        builder.Entity<Friendship>()
            .HasOne(f => f.User)
            .WithMany()
            .HasForeignKey(f => f.UserId)
            .OnDelete(DeleteBehavior.Restrict); // prevent cascade deletes

        builder.Entity<Friendship>()
            .HasOne(f => f.Friend)
            .WithMany()
            .HasForeignKey(f => f.FriendId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
