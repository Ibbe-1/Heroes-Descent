using Heroes_Descent.Application.Dtos;
using Heroes_Descent.Core.Entities.Heroes;
using Heroes_Descent.Core.GameState;

namespace Heroes_Descent.Application.Services;

public class GameService
{
    // ── Player actions ────────────────────────────────────────────────────────

    public (bool acted, List<string> log) AttackNearest(GameSession session, string userId)
    {
        var player = session.Players.FirstOrDefault(p => p.UserId == userId);
        if (player is null || !player.Hero.IsAlive) return (false, []);

        var cooldown = AttackCooldownMs(player.Hero);
        if (session.LastAttackTime.TryGetValue(userId, out var last) &&
            DateTime.UtcNow - last < TimeSpan.FromMilliseconds(cooldown))
            return (false, []);

        var alive = session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive).ToList();
        if (!alive.Any()) return (false, []);

        var nearest = alive.MinBy(e => Dist(player.X, player.Y, e.X, e.Y))!;
        if (Dist(player.X, player.Y, nearest.X, nearest.Y) > RoomBounds.PlayerAttackRange)
            return (false, []);

        session.LastAttackTime[userId] = DateTime.UtcNow;

        var raw = player.Hero.BasicAttack();
        var actual = nearest.Enemy.TakeDamage(raw);
        var log = new List<string> { $"{player.Username} hits {nearest.Enemy.Name} for {actual} dmg!" };

        if (!nearest.Enemy.IsAlive)
        {
            log.Add($"{nearest.Enemy.Name} is defeated!");
            player.Hero.GainExperience(nearest.Enemy.ExperienceReward);
            if (session.CurrentRoom.IsCleared) log.Add("Room cleared — advance when ready.");
        }

        return (true, log);
    }

    public (bool acted, List<string> log) PlayerUseAbility(GameSession session, string userId)
    {
        var player = session.Players.FirstOrDefault(p => p.UserId == userId);
        if (player is null || !player.Hero.IsAlive) return (false, []);
        if (!player.Hero.CanUseAbility()) return (false, []);

        var alive = session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive).ToList();
        var log = new List<string>();

        if (player.Hero is Warrior warrior)
        {
            warrior.UseAbility();
            log.Add($"{player.Username} raises Shield Block — next hit halved!");
        }
        else if (player.Hero is Wizard wizard)
        {
            int dmg = wizard.UseAbility();
            foreach (var e in alive)
            {
                var actual = e.Enemy.TakeDamage(dmg);
                log.Add($"Fireball scorches {e.Enemy.Name} for {actual} magic dmg!");
                if (!e.Enemy.IsAlive)
                {
                    log.Add($"{e.Enemy.Name} is incinerated!");
                    player.Hero.GainExperience(e.Enemy.ExperienceReward);
                }
            }
            if (session.CurrentRoom.IsCleared && alive.Count > 0)
                log.Add("Room cleared — advance when ready.");
        }
        else if (player.Hero is Archer archer)
        {
            int targetCount = archer.UseAbility();
            var targets = alive.OrderBy(_ => Random.Shared.Next()).Take(targetCount).ToList();
            foreach (var e in targets)
            {
                var raw = archer.BasicAttack();
                bool isCrit = raw == archer.BaseAttack * 2;
                var actual = e.Enemy.TakeDamage(raw);
                log.Add($"Arrow pierces {e.Enemy.Name} for {actual} dmg{(isCrit ? " [CRIT!]" : "")}");
                if (!e.Enemy.IsAlive)
                {
                    log.Add($"{e.Enemy.Name} is defeated!");
                    player.Hero.GainExperience(e.Enemy.ExperienceReward);
                }
            }
            if (session.CurrentRoom.IsCleared)
                log.Add("Room cleared — advance when ready.");
        }

        return (log.Count > 0, log);
    }

    // ── Enemy AI ──────────────────────────────────────────────────────────────

    public void MoveEnemies(GameSession session, float deltaMs)
    {
        var alivePlayers = session.Players.Where(p => p.Hero.IsAlive).ToList();
        if (!alivePlayers.Any()) return;

        float dt = deltaMs / 1000f;
        const float pad = 20f;

        foreach (var inst in session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive))
        {
            var target = alivePlayers.MinBy(p => Dist(p.X, p.Y, inst.X, inst.Y))!;
            float dx = target.X - inst.X;
            float dy = target.Y - inst.Y;
            float dist = MathF.Sqrt(dx * dx + dy * dy);

            if (dist < 30f) continue;

            float speed = inst.Enemy.MovementSpeed * dt;
            inst.X = Math.Clamp(inst.X + (dx / dist) * speed, RoomBounds.Left + pad, RoomBounds.Right - pad);
            inst.Y = Math.Clamp(inst.Y + (dy / dist) * speed, RoomBounds.Top + pad, RoomBounds.Bottom - pad);
        }
    }

    public List<string> TickEnemyAttacks(GameSession session)
    {
        if (DateTime.UtcNow - session.LastEnemyTick < TimeSpan.FromMilliseconds(800))
            return [];

        session.LastEnemyTick = DateTime.UtcNow;

        foreach (var p in session.Players)
            if (p.Hero is Archer a) a.TryRegenEnergy();

        var alive = session.Players.Where(p => p.Hero.IsAlive).ToList();
        if (!alive.Any()) return [];

        var log = new List<string>();

        foreach (var inst in session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive))
        {
            var target = alive
                .Where(p => Dist(p.X, p.Y, inst.X, inst.Y) <= RoomBounds.EnemyAttackRange)
                .MinBy(p => Dist(p.X, p.Y, inst.X, inst.Y));

            if (target is null) continue;

            int rawDmg = inst.Enemy.Attack;
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
                alive.Remove(target);
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
                e.X,
                e.Y
            )).ToList(),
            room.IsCleared
        );

        var players = session.Players.Select(p =>
        {
            var (res, maxRes, resName) = ResourceInfo(p.Hero);
            return new PlayerDto(
                p.UserId,
                p.Username,
                p.Hero.Class.ToString(),
                p.Hero.CurrentHp,
                p.Hero.MaxHp,
                p.Hero.IsAlive,
                res, maxRes, resName,
                p.Hero.CanUseAbility(),
                p.Hero.AbilityName,
                AttackCooldownMs(p.Hero),
                p.X,
                p.Y
            );
        }).ToList();

        return new GameStateDto(
            session.SessionId,
            session.CurrentRoomIndex,
            session.Rooms.Count,
            roomDto,
            players,
            session.RecentLog.TakeLast(15).ToList(),
            session.IsGameOver,
            session.IsVictory
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    public static int AttackCooldownMs(Hero hero) =>
        Math.Max(800, 3000 - hero.Speed * 100);

    private static float Dist(float x1, float y1, float x2, float y2)
    {
        float dx = x2 - x1, dy = y2 - y1;
        return MathF.Sqrt(dx * dx + dy * dy);
    }

    private static (int res, int max, string name) ResourceInfo(Hero hero) => hero switch
    {
        Warrior w => (w.CurrentRage,   w.MaxRage,    "Rage"),
        Wizard  w => (w.CurrentMana,   w.MaxMana,    "Mana"),
        Archer  a => (a.CurrentEnergy, a.MaxEnergy,  "Energy"),
        _         => (0, 0, ""),
    };
}
