// Entry point — bootstraps ASP.NET Core and wires up SignalR.
// Register services from Application/Infrastructure here, map the GameHub route.

using Heroes_Descent.API.Hubs;
using Heroes_Descent.Core.Interfaces;
using Heroes_Descent.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();

// AllowCredentials() is required for SignalR — do not remove.
// Update the origin if your frontend runs on a different port.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5173") // Vite default port
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

builder.Services.AddSingleton<IGameLogger, GameLogger>();
// TODO: register Application services here (e.g. builder.Services.AddScoped<IGameSessionService, GameSessionService>())

var app = builder.Build();

// Serves the built React app in production — drop the Vite build output into wwwroot/.
app.UseStaticFiles();
app.UseCors();
app.MapHub<GameHub>("/gamehub");

app.Run();
