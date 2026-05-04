// FriendsController.cs
// Handles the friends/party list for each player.
// All endpoints require a valid JWT (the [Authorize] attribute on the class).
//
// Endpoints:
//   GET  /api/friends          — returns the current player's friend list
//   POST /api/friends          — adds a friend by username
//   DELETE /api/friends/{username} — removes a friend

using Heroes_Descent.Core.Entities;
using Heroes_Descent.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace Heroes_Descent.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize] // every endpoint here requires a valid JWT token
public class FriendsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly UserManager<ApplicationUser> _userManager;

    public FriendsController(AppDbContext context, UserManager<ApplicationUser> userManager)
    {
        _context = context;
        _userManager = userManager;
    }

    // Helper — reads the logged-in user's ID from the JWT "sub" claim.
    private string CurrentUserId =>
        User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    // GET /api/friends
    // Returns the list of friends the current player has added.
    // Online status is always false for now — it will be set by the SignalR
    // presence system once that is wired up in GameHub.cs.
    [HttpGet]
    public async Task<IActionResult> GetFriends()
    {
        var friends = await _context.Friendships
            .Where(f => f.UserId == CurrentUserId)
            .Include(f => f.Friend)
            .Select(f => new FriendDto(f.Friend.UserName!, false))
            .ToListAsync();

        return Ok(friends);
    }

    // POST /api/friends
    // Adds a friend by username. The body should be { "username": "somePlayer" }.
    // Returns 400 with a plain-text error if the user doesn't exist,
    // if you try to add yourself, or if they're already in your list.
    [HttpPost]
    public async Task<IActionResult> AddFriend(AddFriendRequest request)
    {
        // Look up by username (case-insensitive via Identity's normalised column)
        var friend = await _userManager.FindByNameAsync(request.Username);
        if (friend == null)
            return BadRequest("No hero found with that username.");

        if (friend.Id == CurrentUserId)
            return BadRequest("You can't add yourself.");

        var alreadyFriends = await _context.Friendships
            .AnyAsync(f => f.UserId == CurrentUserId && f.FriendId == friend.Id);
        if (alreadyFriends)
            return BadRequest("Already in your party.");

        _context.Friendships.Add(new Friendship
        {
            UserId   = CurrentUserId,
            FriendId = friend.Id,
        });
        await _context.SaveChangesAsync();

        return Ok();
    }

    // DELETE /api/friends/{username}
    // Removes a friend from the current player's list.
    // Returns 404 if the friendship doesn't exist.
    [HttpDelete("{username}")]
    public async Task<IActionResult> RemoveFriend(string username)
    {
        var friend = await _userManager.FindByNameAsync(username);
        if (friend == null)
            return NotFound("User not found.");

        var friendship = await _context.Friendships
            .FirstOrDefaultAsync(f => f.UserId == CurrentUserId && f.FriendId == friend.Id);
        if (friendship == null)
            return NotFound("This hero is not in your party.");

        _context.Friendships.Remove(friendship);
        await _context.SaveChangesAsync();

        return Ok();
    }
}

// Request/response shapes used by the controller above.
public record AddFriendRequest(string Username);
public record FriendDto(string Username, bool Online);
