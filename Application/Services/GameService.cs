using Heroes_Descent.Application.Dtos;
using Heroes_Descent.Core.Entities.Heroes;
using Heroes_Descent.Core.GameState;

namespace Heroes_Descent.Application.Services;

// GameService contains all of the game logic that runs on the server.
// It is intentionally kept free of networking or database code — those live
// in GameHub and the repositories respectively.
//
// Three main responsibilities:
//   1. Process player actions (attack nearest enemy, use class ability).
//   2. Drive enemy AI (movement every 100 ms, attacks every 800 ms).
//   3. Build the GameStateDto snapshot that gets broadcast to all clients.
public class GameService
{
    // ── Player actions ────────────────────────────────────────────────────────

    // Called when a player presses SPACE.
    // The server finds whichever alive enemy is closest to that player's
    // last known position and applies damage — provided the enemy is within
    // PlayerAttackRange (120 px) and the player isn't on attack cooldown.
    //
    // Using "attack nearest" instead of "click an enemy" works well for a
    // top-down game where the player is already running toward enemies.
    public (bool acted, List<string> log) AttackNearest(GameSession session, string userId)
    {
        var player = session.Players.FirstOrDefault(p => p.UserId == userId);
        if (player is null || !player.Hero.IsAlive) return (false, []);

        // Enforce the per-hero attack cooldown so faster heroes genuinely attack more.
        var cooldown = AttackCooldownMs(player.Hero);
        if (session.LastAttackTime.TryGetValue(userId, out var last) &&
            DateTime.UtcNow - last < TimeSpan.FromMilliseconds(cooldown))
            return (false, []);   // still on cooldown — silently reject

        var alive = session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive).ToList();
        if (!alive.Any()) return (false, []);

        // MinBy uses Dist() to find the closest enemy in one LINQ pass.
        var nearest = alive.MinBy(e => Dist(player.X, player.Y, e.X, e.Y))!;
        if (Dist(player.X, player.Y, nearest.X, nearest.Y) > RoomBounds.PlayerAttackRange)
            return (false, []);   // closest enemy is still out of reach

        session.LastAttackTime[userId] = DateTime.UtcNow;

        var raw    = player.Hero.BasicAttack();   // hero subclass rolls crits, adds Strength, etc.
        var actual = nearest.Enemy.TakeDamage(raw);
        var log    = new List<string> { $"{player.Username} hits {nearest.Enemy.Name} for {actual} dmg!" };

        if (!nearest.Enemy.IsAlive)
        {
            int gold = nearest.Enemy.GoldReward;
            player.Gold += gold;
            log.Add($"{nearest.Enemy.Name} is defeated! (+{gold}g)");
            player.Hero.GainExperience(nearest.Enemy.ExperienceReward);
            if (session.CurrentRoom.IsCleared) log.Add("Room cleared — advance when ready.");
        }

        return (true, log);
    }

    // Called when a player presses Q.
    // Each hero class has a completely different ability, so we switch on the
    // concrete type and call the appropriate logic.
    public (bool acted, List<string> log) PlayerUseAbility(GameSession session, string userId)
    {
        var player = session.Players.FirstOrDefault(p => p.UserId == userId);
        if (player is null || !player.Hero.IsAlive)   return (false, []);
        if (!player.Hero.CanUseAbility())              return (false, []);

        var alive = session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive).ToList();
        var log   = new List<string>();

        if (player.Hero is Warrior warrior)
        {
            // Warrior: sets the IsBlocking flag. The next enemy hit that lands
            // on this warrior is halved, then the flag is cleared (TickEnemyAttacks).
            warrior.UseAbility();
            log.Add($"{player.Username} raises Shield Block — next hit halved!");
        }
        else if (player.Hero is Wizard wizard)
        {
            // Wizard: Fireball hits EVERY alive enemy in the room for the same damage.
            // UseAbility() deducts mana and returns the magic damage value.
            int dmg = wizard.UseAbility();
            int wizardGold = 0;
            foreach (var e in alive)
            {
                var actual = e.Enemy.TakeDamage(dmg);
                log.Add($"Fireball scorches {e.Enemy.Name} for {actual} magic dmg!");
                if (!e.Enemy.IsAlive)
                {
                    log.Add($"{e.Enemy.Name} is incinerated!");
                    player.Hero.GainExperience(e.Enemy.ExperienceReward);
                    wizardGold += e.Enemy.GoldReward;
                }
            }
            if (wizardGold > 0)
            {
                player.Gold += wizardGold;
                log.Add($"{player.Username} looted {wizardGold} gold!");
            }
            if (session.CurrentRoom.IsCleared && alive.Count > 0)
                log.Add("Room cleared — advance when ready.");
        }
        else if (player.Hero is Archer archer)
        {
            // Archer: Multi-Shot fires at 2 random enemies.
            // UseAbility() spends Energy and returns how many targets to hit.
            int targetCount = archer.UseAbility();
            var targets = alive.OrderBy(_ => Random.Shared.Next()).Take(targetCount).ToList();
            int archerGold = 0;
            foreach (var e in targets)
            {
                var raw    = archer.BasicAttack();            // rolls for crit internally
                bool isCrit = raw == archer.BaseAttack * 2;  // detect crit by comparing to base
                var actual  = e.Enemy.TakeDamage(raw);
                log.Add($"Arrow pierces {e.Enemy.Name} for {actual} dmg{(isCrit ? " [CRIT!]" : "")}");
                if (!e.Enemy.IsAlive)
                {
                    log.Add($"{e.Enemy.Name} is defeated!");
                    player.Hero.GainExperience(e.Enemy.ExperienceReward);
                    archerGold += e.Enemy.GoldReward;
                }
            }
            if (archerGold > 0)
            {
                player.Gold += archerGold;
                log.Add($"{player.Username} looted {archerGold} gold!");
            }
            if (session.CurrentRoom.IsCleared)
                log.Add("Room cleared — advance when ready.");
        }

        return (log.Count > 0, log);
    }

    // ── Enemy AI ──────────────────────────────────────────────────────────────

    // Moves every alive enemy one step toward the nearest alive player.
    // Called every 100 ms by EnemyAiService; deltaMs is the actual elapsed time
    // so movement stays consistent even if ticks are slightly uneven.
    public void MoveEnemies(GameSession session, float deltaMs)
    {
        var alivePlayers = session.Players.Where(p => p.Hero.IsAlive).ToList();
        if (!alivePlayers.Any()) return;

        float dt          = deltaMs / 1000f;   // convert ms → seconds for speed formula
        const float pad   = 20f;               // keep enemies away from the very edge of walls

        foreach (var inst in session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive))
        {
            // Find the player this enemy should chase.
            var target = alivePlayers.MinBy(p => Dist(p.X, p.Y, inst.X, inst.Y))!;
            float dx   = target.X - inst.X;
            float dy   = target.Y - inst.Y;
            float dist = MathF.Sqrt(dx * dx + dy * dy);

            // Stop moving once the enemy is practically on top of the player
            // to avoid jitter when they're already in melee range.
            if (dist < 30f) continue;

            // Normalise the direction vector (dx/dist, dy/dist) so diagonal
            // movement isn't faster than cardinal movement, then scale by speed.
            float speed = inst.Enemy.MovementSpeed * dt;
            inst.X = Math.Clamp(inst.X + (dx / dist) * speed, RoomBounds.Left  + pad, RoomBounds.Right  - pad);
            inst.Y = Math.Clamp(inst.Y + (dy / dist) * speed, RoomBounds.Top   + pad, RoomBounds.Bottom - pad);
        }
    }

    // Handles enemy attacks — called every tick by EnemyAiService, but internally
    // only fires every 800 ms (checked via session.LastEnemyTick).
    // Only enemies within EnemyAttackRange (80 px) of a player deal damage,
    // which rewards players who keep their distance.
    public List<string> TickEnemyAttacks(GameSession session)
    {
        if (DateTime.UtcNow - session.LastEnemyTick < TimeSpan.FromMilliseconds(800))
            return [];   // 800 ms hasn't elapsed yet

        session.LastEnemyTick = DateTime.UtcNow;

        // Tick passive resource regeneration for the Archer class.
        foreach (var p in session.Players)
            if (p.Hero is Archer a) a.TryRegenEnergy();

        var alive = session.Players.Where(p => p.Hero.IsAlive).ToList();
        if (!alive.Any()) return [];

        var log = new List<string>();

        foreach (var inst in session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive))
        {
            // Only attack players within range — kiting is a valid strategy.
            var target = alive
                .Where(p => Dist(p.X, p.Y, inst.X, inst.Y) <= RoomBounds.EnemyAttackRange)
                .MinBy(p => Dist(p.X, p.Y, inst.X, inst.Y));

            if (target is null) continue;

            int rawDmg = inst.Enemy.Attack;

            // If the warrior activated Shield Block since the last tick, halve this hit.
            if (target.Hero is Warrior w && w.IsBlocking)
            {
                rawDmg /= 2;
                w.ClearBlock();
                log.Add($"{target.Username} blocks! Hit reduced to {rawDmg}.");
            }

            var actual = target.Hero.TakeDamage(rawDmg);
            log.Add($"{inst.Enemy.Name} strikes {target.Username} for {actual} dmg!");

            if (!target.Hero.IsAlive)
            {
                log.Add($"{target.Username} has fallen!");
                alive.Remove(target);   // don't keep attacking a corpse this tick
                if (!alive.Any())
                {
                    session.IsGameOver = true;
                    log.Add("The party has been wiped out...");
                    break;
                }
            }
        }

        return log;
    }

    // ── DTO builder ───────────────────────────────────────────────────────────

    // Converts the live session state into a serialisation-friendly DTO.
    // Called inside lock(session.Lock) so the snapshot is always consistent.
    // The resulting object is broadcast to every client in the session group.
    public GameStateDto BuildDto(GameSession session)
    {
        var room = session.CurrentRoom;

        var roomDto = new RoomDto(
            room.Type.ToString(),
            room.Enemies.Select(e => new EnemyDto(
                e.Id.ToString(),
                e.Enemy.Name,
                e.Enemy.Health,
                e.Enemy.MaxHealth,
                e.Enemy.IsAlive,
                e.X, e.Y           // position so the Phaser scene can place the sprite
            )).ToList(),
            room.IsCleared
        );

        var players = session.Players.Select(p =>
        {
            var (res, maxRes, resName) = ResourceInfo(p.Hero);
            return new PlayerDto(
                p.UserId, p.Username, p.Hero.Class.ToString(),
                p.Hero.CurrentHp, p.Hero.MaxHp, p.Hero.IsAlive,
                res, maxRes, resName,
                p.Hero.CanUseAbility(), p.Hero.AbilityName,
                AttackCooldownMs(p.Hero),
                p.X, p.Y,
                p.Gold
            );
        }).ToList();

        return new GameStateDto(
            session.SessionId,
            session.CurrentRoomIndex,
            session.Rooms.Count,
            roomDto, players,
            session.RecentLog.TakeLast(15).ToList(),
            session.IsGameOver,
            session.IsVictory
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Cooldown formula: faster heroes attack more often.
    // Warrior (Speed 7) → 2 300 ms, Wizard (Speed 10) → 2 000 ms, Archer (Speed 14) → 1 600 ms.
    public static int AttackCooldownMs(Hero hero) =>
        Math.Max(800, 3000 - hero.Speed * 100);

    // Euclidean distance between two 2D points.
    private static float Dist(float x1, float y1, float x2, float y2)
    {
        float dx = x2 - x1, dy = y2 - y1;
        return MathF.Sqrt(dx * dx + dy * dy);
    }

    // Returns the resource bar values for any hero class under a common interface,
    // so BuildDto doesn't need to know which concrete hero it's looking at.
    private static (int res, int max, string name) ResourceInfo(Hero hero) => hero switch
    {
        Warrior w => (w.CurrentRage,   w.MaxRage,   "Rage"),
        Wizard  w => (w.CurrentMana,   w.MaxMana,   "Mana"),
        Archer  a => (a.CurrentEnergy, a.MaxEnergy, "Energy"),
        _         => (0, 0, ""),
    };
}
