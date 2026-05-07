using Heroes_Descent.Application.Dtos;
using Heroes_Descent.Core.Entities.Enemies;
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
    public (bool acted, List<string> log) PlayerUseAbility(GameSession session, string userId, float dirX = 0f, float dirY = 0f)
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
            // Wizard: Fireball is a directional skillshot. It ray-casts to the first enemy
            // it hits for full damage, then splashes 60% to enemies within WizardSplashRadius.
            float len = MathF.Sqrt(dirX * dirX + dirY * dirY);
            if (len < 0.001f) { dirX = 0f; dirY = -1f; }
            else { dirX /= len; dirY /= len; }

            int dmg = wizard.UseAbility();  // deduct mana regardless of hit/miss

            var primary = FindRayTarget(alive, player.X, player.Y, dirX, dirY,
                RoomBounds.WizardAttackRange, RoomBounds.WizardHitRadius);

            if (primary is null)
            {
                log.Add("Fireball fizzles — nothing in range!");
            }
            else
            {
                int wizardGold = 0;
                var actual = primary.Enemy.TakeDamage(dmg);
                log.Add($"Fireball strikes {primary.Enemy.Name} for {actual} magic dmg!");
                if (!primary.Enemy.IsAlive)
                {
                    log.Add($"{primary.Enemy.Name} is incinerated!");
                    player.Hero.GainExperience(primary.Enemy.ExperienceReward);
                    wizardGold += primary.Enemy.GoldReward;
                }

                int splashDmg = (int)(dmg * 0.6f);
                foreach (var e in alive.Where(e => e != primary && e.Enemy.IsAlive))
                {
                    if (Dist(primary.X, primary.Y, e.X, e.Y) > RoomBounds.WizardSplashRadius) continue;
                    var splashActual = e.Enemy.TakeDamage(splashDmg);
                    log.Add($"Splash burns {e.Enemy.Name} for {splashActual} magic dmg!");
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
                if (session.CurrentRoom.IsCleared)
                    log.Add("Room cleared — advance when ready.");
            }
        }
        else if (player.Hero is Archer archer)
        {
            // Archer: Multi-Shot fires 3 arrows in a ±15° spread from the aim direction.
            // Each arrow is an independent ray-cast, so a single arrow can crit.
            int arrowCount = archer.UseAbility();

            float len = MathF.Sqrt(dirX * dirX + dirY * dirY);
            if (len < 0.001f) { dirX = 0f; dirY = -1f; }  // default: aim up
            else { dirX /= len; dirY /= len; }

            float centerAngle = MathF.Atan2(dirY, dirX);
            float spread      = MathF.PI / 12f;  // 15° between arrows

            int archerGold = 0;
            var hitEnemies = new HashSet<EnemyInstance>();

            for (int i = 0; i < arrowCount; i++)
            {
                float angle = centerAngle + (i - 1) * spread;  // –15°, 0°, +15°
                float rdx   = MathF.Cos(angle);
                float rdy   = MathF.Sin(angle);

                var target = FindRayTarget(alive, player.X, player.Y, rdx, rdy,
                    RoomBounds.ArcherAttackRange, RoomBounds.ArcherHitRadius);

                if (target is null || hitEnemies.Contains(target)) continue;
                hitEnemies.Add(target);

                var raw    = archer.BasicAttack();
                bool isCrit = raw == archer.BaseAttack * 2;
                var actual  = target.Enemy.TakeDamage(raw);
                log.Add($"Arrow pierces {target.Enemy.Name} for {actual} dmg{(isCrit ? " [CRIT!]" : "")}");
                if (!target.Enemy.IsAlive)
                {
                    log.Add($"{target.Enemy.Name} is defeated!");
                    player.Hero.GainExperience(target.Enemy.ExperienceReward);
                    archerGold += target.Enemy.GoldReward;
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

    // Called when a player presses SPACE with their mouse cursor aimed in a direction.
    // dirX/dirY is a normalised direction vector sent by the client.
    //
    // Warrior — 90° melee cone: hits the closest enemy within WarriorAttackRange
    //           that falls inside the ±45° arc around the aimed direction.
    // Archer  — ray skillshot: the arrow travels in (dirX, dirY) and hits the first
    //           enemy whose centre is within ArcherHitRadius of the ray, up to 600 px.
    // Wizard  — ray skillshot: same as Archer but wider hit-box (28 px) and longer
    //           range (800 px). Slower projectile on the client side.
    //
    // Cooldown is applied even on a miss so rapid-clicking doesn't bypass it.
    public (bool acted, List<string> log) AttackDirectional(GameSession session, string userId, float dirX, float dirY)
    {
        var player = session.Players.FirstOrDefault(p => p.UserId == userId);
        if (player is null || !player.Hero.IsAlive) return (false, []);

        var cooldown = AttackCooldownMs(player.Hero);
        if (session.LastAttackTime.TryGetValue(userId, out var last) &&
            DateTime.UtcNow - last < TimeSpan.FromMilliseconds(cooldown))
            return (false, []);

        float len = MathF.Sqrt(dirX * dirX + dirY * dirY);
        if (len < 0.001f) return (false, []);
        dirX /= len;
        dirY /= len;

        // Apply cooldown immediately so even a miss consumes the attack window.
        session.LastAttackTime[userId] = DateTime.UtcNow;

        var alive = session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive).ToList();

        EnemyInstance? target;
        if (player.Hero is Warrior)
        {
            target = FindConeTarget(alive, player.X, player.Y, dirX, dirY,
                RoomBounds.WarriorAttackRange, RoomBounds.WarriorConeHalfAngle);
        }
        else
        {
            float range     = player.Hero is Archer ? RoomBounds.ArcherAttackRange : RoomBounds.WizardAttackRange;
            float hitRadius = player.Hero is Archer ? RoomBounds.ArcherHitRadius   : RoomBounds.WizardHitRadius;
            target = FindRayTarget(alive, player.X, player.Y, dirX, dirY, range, hitRadius);
        }

        if (target is null) return (false, []);   // missed — cooldown already applied above

        var log    = new List<string>();
        var raw    = player.Hero.BasicAttack();
        var actual = target.Enemy.TakeDamage(raw);
        log.Add($"{player.Username} hits {target.Enemy.Name} for {actual} dmg!");

        if (!target.Enemy.IsAlive)
        {
            log.Add($"{target.Enemy.Name} is defeated!");
            player.Hero.GainExperience(target.Enemy.ExperienceReward);
            if (session.CurrentRoom.IsCleared) log.Add("Room cleared — advance when ready.");
        }

        return (true, log);
    }

    // Returns the closest enemy inside a cone (halfAngle radians either side of the aim direction).
    private static EnemyInstance? FindConeTarget(
        List<EnemyInstance> alive, float px, float py, float dirX, float dirY,
        float range, float halfAngle)
    {
        EnemyInstance? best = null;
        float bestDist = float.MaxValue;
        float cosHalf  = MathF.Cos(halfAngle);

        foreach (var e in alive)
        {
            float dist = Dist(px, py, e.X, e.Y);
            if (dist > range || dist >= bestDist) continue;

            if (dist < 0.1f) { best = e; bestDist = dist; continue; }  // standing on enemy

            float ex  = (e.X - px) / dist;
            float ey  = (e.Y - py) / dist;
            float dot = ex * dirX + ey * dirY;   // cos(angle between aim and enemy direction)
            if (dot >= cosHalf)
            {
                best = e;
                bestDist = dist;
            }
        }
        return best;
    }

    // Returns the first enemy hit by a ray cast from (px,py) in direction (dirX,dirY).
    // "Hit" means the enemy centre is within hitRadius pixels of the ray, within range px.
    private static EnemyInstance? FindRayTarget(
        List<EnemyInstance> alive, float px, float py, float dirX, float dirY,
        float range, float hitRadius)
    {
        EnemyInstance? best = null;
        float bestT = float.MaxValue;

        foreach (var e in alive)
        {
            float ex = e.X - px;
            float ey = e.Y - py;
            float t  = ex * dirX + ey * dirY;           // projection of enemy onto ray
            if (t < 0 || t > range) continue;           // behind player or beyond range

            float cx   = px + dirX * t;
            float cy   = py + dirY * t;
            float perp = Dist(cx, cy, e.X, e.Y);        // perpendicular distance from ray to centre
            if (perp > hitRadius) continue;

            if (t < bestT) { bestT = t; best = e; }
        }
        return best;
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

            // Golem freezes in place during laser charge — it is winding up, not chasing.
            if (inst.Enemy is GolemEnemy && inst.GolemIsCharging) continue;

            // Boss/Golem stop at their melee stop distance; ranged enemies stop at shoot range; others at 30 px.
            float stopDist = inst.Enemy is BossEnemy  ? RoomBounds.BossStopDistance
                           : inst.Enemy is GolemEnemy ? RoomBounds.GolemStopDistance
                           : inst.Enemy.ShootsProjectiles ? inst.Enemy.ProjectileRange - 30f
                           : 30f;
            if (dist < stopDist) continue;

            // Normalise the direction vector (dx/dist, dy/dist) so diagonal
            // movement isn't faster than cardinal movement, then scale by speed.
            float speed = inst.Enemy.MovementSpeed * dt;
            inst.X = Math.Clamp(inst.X + (dx / dist) * speed, RoomBounds.Left  + pad, RoomBounds.Right  - pad);
            inst.Y = Math.Clamp(inst.Y + (dy / dist) * speed, RoomBounds.Top   + pad, RoomBounds.Bottom - pad);
        }
    }

    // Handles enemy attacks — called every 100 ms by EnemyAiService.
    //
    // Regular enemies use a shared 800 ms global tick.
    // The Dark Mage boss uses a hybrid model:
    //   • Melee  (≤ BossMeleeRange px)  — fires on the global 800 ms tick.
    //   • Ranged (BossMeleeRange–BossRangedMax px) — fires on its own 1 400 ms cooldown.
    //   • Chase  (> BossRangedMax px)   — no attack; boss just closes the gap.
    public List<string> TickEnemyAttacks(GameSession session)
    {
        var now = DateTime.UtcNow;

        bool globalReady = now - session.LastEnemyTick >= TimeSpan.FromMilliseconds(800);

        // Allow the method to run outside the global tick if the boss or Golem has a
        // ranged shot ready — melee and ranged attacks run on independent cooldowns.
        bool bossRangedReady = session.CurrentRoom.Enemies.Any(e =>
            e.Enemy is BossEnemy && e.Enemy.IsAlive &&
            (now - e.LastRangedAttackTime).TotalMilliseconds >= RoomBounds.BossRangedCooldownMs);

        // Same check for the Golem — its 2 000 ms cooldown is tracked per-instance.
        bool golemRangedReady = session.CurrentRoom.Enemies.Any(e =>
            e.Enemy is GolemEnemy && e.Enemy.IsAlive &&
            (now - e.LastRangedAttackTime).TotalMilliseconds >= RoomBounds.GolemRangedCooldownMs);

        if (!globalReady && !bossRangedReady && !golemRangedReady) return [];

        if (globalReady)
        {
            session.LastEnemyTick = now;
            foreach (var p in session.Players)
                if (p.Hero is Archer a) a.TryRegenEnergy();
        }

        var alive = session.Players.Where(p => p.Hero.IsAlive).ToList();
        if (!alive.Any()) return [];

        var log = new List<string>();

        foreach (var inst in session.CurrentRoom.Enemies.Where(e => e.Enemy.IsAlive))
        {
            var target = alive.MinBy(p => Dist(p.X, p.Y, inst.X, inst.Y));
            if (target is null) continue;

            float dist = Dist(target.X, target.Y, inst.X, inst.Y);

            if (inst.Enemy is BossEnemy)
            {
                if (dist <= RoomBounds.BossMeleeRange && globalReady)
                {
                    // Player is right next to the boss — apply melee damage instantly.
                    log.AddRange(ApplyHit(inst.Enemy.Attack, inst.Enemy.Name, target, session, alive));
                }
                else if (dist > RoomBounds.BossMeleeRange && dist <= RoomBounds.BossRangedMax &&
                         (now - inst.LastRangedAttackTime).TotalMilliseconds >= RoomBounds.BossRangedCooldownMs)
                {
                    // Player is at mid range — launch a fireball that travels toward where
                    // the player is standing RIGHT NOW. Moving after the shot is fired dodges it.
                    inst.LastRangedAttackTime = now;
                    session.ActiveProjectiles.Add(
                        new ActiveProjectile(inst.X, inst.Y, target.X, target.Y, inst.Enemy.Attack, "Dark Mage's fireball"));
                    log.Add($"Dark Mage fires a fireball at {target.Username}!");
                }
                // else: player is beyond BossRangedMax — boss chases, no attack.
            }
            else if (inst.Enemy is GolemEnemy)
            {
                // Golem is charging its laser — suppress all normal attacks during wind-up.
                // Damage will come from TickGolemLaserCharge instead.
                if (inst.GolemIsCharging) { /* winding up — no normal attacks */ }
                else if (dist <= RoomBounds.GolemMeleeRange && globalReady)
                {
                    // Player is in melee range — stone-fist smash on the global 800 ms tick.
                    log.AddRange(ApplyHit(inst.Enemy.Attack, inst.Enemy.Name, target, session, alive));
                }
                else if (dist > RoomBounds.GolemMeleeRange && dist <= RoomBounds.GolemRangedMax &&
                         (now - inst.LastRangedAttackTime).TotalMilliseconds >= RoomBounds.GolemRangedCooldownMs)
                {
                    // Player is at mid range — hurl a glowing arm projectile toward the player's
                    // current position. Moving out of the way after it is fired will dodge the hit.
                    inst.LastRangedAttackTime = now;
                    session.ActiveProjectiles.Add(
                        new ActiveProjectile(inst.X, inst.Y, target.X, target.Y, inst.Enemy.Attack, "Golem's projectile"));
                    log.Add($"Golem hurls a projectile at {target.Username}!");
                }
                // else: player is beyond GolemRangedMax — Golem chases, no attack.
            }
            else if (globalReady)
            {
                // Regular enemies — unchanged instant melee/ranged damage.
                float atkRange = inst.Enemy.ShootsProjectiles && inst.Enemy.ProjectileRange > 0f
                    ? inst.Enemy.ProjectileRange
                    : RoomBounds.EnemyAttackRange;
                if (dist > atkRange) continue;
                log.AddRange(ApplyHit(inst.Enemy.Attack, inst.Enemy.Name, target, session, alive));
            }

            if (session.IsGameOver) break;
        }

        return log;
    }

    // Handles the Golem's laser charge ability.
    //
    // Called every 100 ms tick alongside MoveEnemies and TickEnemyAttacks.
    // Three HP thresholds (75 %, 50 %, 25 %) each trigger one laser charge:
    //   1. Golem freezes and gains GolemLaserDefenseBonus defence for 2 s.
    //   2. After 2 s the laser fires — all alive players take heavy damage.
    //   3. Defence returns to its pre-charge value.
    //
    // The method also clears the GolemLaserFiredTime flag once the
    // GolemLaserFiringVisualMs window has elapsed so the frontend stops
    // showing the beam animation.
    public List<string> TickGolemLaserCharge(GameSession session)
    {
        var log = new List<string>();
        var now = DateTime.UtcNow;

        foreach (var inst in session.CurrentRoom.Enemies
            .Where(e => e.Enemy is GolemEnemy && e.Enemy.IsAlive))
        {
            var golem = (GolemEnemy)inst.Enemy;

            // ── Clear the firing visual window once it has expired ──────────────
            if (inst.GolemLaserFiredTime.HasValue &&
                (now - inst.GolemLaserFiredTime.Value).TotalMilliseconds >= RoomBounds.GolemLaserFiringVisualMs)
            {
                inst.GolemLaserFiredTime = null;
            }

            // ── Check HP thresholds — start a new charge if one is crossed ──────
            if (!inst.GolemIsCharging)
            {
                float hpPct = (float)golem.Health / golem.MaxHealth * 100f;
                // Thresholds in descending order so 75 % fires before 50 % if both
                // happen simultaneously (e.g. a large burst of damage).
                foreach (int threshold in new[] { 75, 50, 25 })
                {
                    if (hpPct <= threshold && !inst.GolemLaserThresholdsUsed.Contains(threshold))
                    {
                        inst.GolemLaserThresholdsUsed.Add(threshold);
                        inst.GolemChargeStartTime = now;
                        golem.BeginLaserCharge();   // raises defence for the wind-up window

                        // Lock in the beam direction toward the nearest alive player.
                        // Direction stays fixed for the whole 2 s wind-up — moving out of
                        // the corridor before the shot fires will avoid the damage.
                        var nearest = session.Players
                            .Where(p => p.Hero.IsAlive)
                            .MinBy(p => Dist(p.X, p.Y, inst.X, inst.Y));
                        if (nearest is not null)
                        {
                            float ldx = nearest.X - inst.X;
                            float ldy = nearest.Y - inst.Y;
                            float llen = MathF.Sqrt(ldx * ldx + ldy * ldy);
                            inst.GolemLaserDirX = llen > 0.001f ? ldx / llen : 1f;
                            inst.GolemLaserDirY = llen > 0.001f ? ldy / llen : 0f;
                        }

                        log.Add($"Golem begins charging its laser ({threshold}% HP threshold)!");
                        break;  // only one threshold per tick — next tick handles the next one
                    }
                }
            }

            // ── If charging, fire when the full charge duration has elapsed ──────
            if (inst.GolemIsCharging && inst.GolemChargeStartTime.HasValue)
            {
                double elapsed = (now - inst.GolemChargeStartTime.Value).TotalMilliseconds;
                if (elapsed >= RoomBounds.GolemChargeDurationMs)
                {
                    // ── Laser fires — damage only players inside the beam corridor ──────
                    inst.GolemChargeStartTime = null;  // no longer charging
                    inst.GolemLaserFiredTime  = now;   // start the beam visual window
                    golem.EndLaserCharge();            // restore pre-charge defence

                    int laserDmg = (int)(golem.Attack * RoomBounds.GolemLaserDamageMultiplier);
                    var alive    = session.Players.Where(p => p.Hero.IsAlive).ToList();
                    log.Add("Golem unleashes its laser beam!");

                    // Only players inside the beam corridor are hit.
                    // The corridor is defined by:
                    //   • In front of the Golem (dot product > 0 with LaserDir)
                    //   • Within GolemLaserRange px along the beam axis
                    //   • Within ±GolemLaserWidth px perpendicular to the beam axis
                    // Backing out of the line or sidestepping > 80 px avoids all damage.
                    foreach (var player in alive.ToList())
                    {
                        float pdx  = player.X - inst.X;
                        float pdy  = player.Y - inst.Y;
                        float dot  = pdx * inst.GolemLaserDirX + pdy * inst.GolemLaserDirY;

                        // Player is behind the Golem or too far away → not hit.
                        if (dot < 0f || dot > RoomBounds.GolemLaserRange) continue;

                        // Perpendicular distance from the beam centre line.
                        float perpX = pdx - inst.GolemLaserDirX * dot;
                        float perpY = pdy - inst.GolemLaserDirY * dot;
                        float perp  = MathF.Sqrt(perpX * perpX + perpY * perpY);

                        // Player sidestepped out of the corridor → not hit.
                        if (perp > RoomBounds.GolemLaserWidth) continue;

                        log.AddRange(ApplyHit(laserDmg, "Golem's laser", player, session, alive));
                        if (session.IsGameOver) break;
                    }
                }
            }
        }

        return log;
    }

    // Moves every active fireball one step forward and checks whether it has hit
    // a player or exceeded its maximum range.
    //
    // Called every 100 ms tick — the same rate as MoveEnemies — so projectile
    // positions are always current when BuildDto snapshots them for the broadcast.
    public List<string> MoveProjectiles(GameSession session, float deltaMs)
    {
        if (session.ActiveProjectiles.Count == 0) return [];

        var log          = new List<string>();
        float dt         = deltaMs / 1000f;  // convert ms → seconds for distance formula
        var alivePlayers = session.Players.Where(p => p.Hero.IsAlive).ToList();

        // Iterate over a snapshot so we can safely remove entries mid-loop.
        foreach (var proj in session.ActiveProjectiles.ToList())
        {
            // Move the fireball forward along its fixed direction vector.
            // Speed * dt gives the distance to travel this tick in pixels.
            float step = ActiveProjectile.Speed * dt;
            proj.X += proj.DirX * step;
            proj.Y += proj.DirY * step;
            proj.DistanceTravelled += step;

            // Remove the fireball if it has left the room area or exceeded max range.
            // This prevents it from flying forever if everyone sidesteps it.
            bool outOfBounds = proj.X < RoomBounds.Left  || proj.X > RoomBounds.Right
                            || proj.Y < RoomBounds.Top   || proj.Y > RoomBounds.Bottom;
            if (outOfBounds || proj.DistanceTravelled >= ActiveProjectile.MaxRange)
            {
                session.ActiveProjectiles.Remove(proj);
                continue;
            }

            // Check every alive player — first one within HitRadius takes the damage.
            bool hitSomeone = false;
            foreach (var player in alivePlayers)
            {
                float dx   = player.X - proj.X;
                float dy   = player.Y - proj.Y;
                float dist = MathF.Sqrt(dx * dx + dy * dy);

                if (dist > ActiveProjectile.HitRadius) continue;  // missed this player

                // Hit! Apply damage and remove the fireball — it can only hit once.
                // The attacker name covers both boss fireball and Golem arm projectile.
                log.AddRange(ApplyHit(proj.Damage, proj.AttackerName, player, session, alivePlayers));
                session.ActiveProjectiles.Remove(proj);
                hitSomeone = true;
                break;
            }

            if (hitSomeone && session.IsGameOver) break;
        }

        return log;
    }

    // Applies raw damage from any source to a target player.
    // Handles the Warrior's Shield Block (halves the hit and clears the flag).
    // Removes dead players from the alive list and sets IsGameOver if the party wipes.
    private static List<string> ApplyHit(
        int rawDmg, string attackerName, PlayerState target, GameSession session, List<PlayerState> alive)
    {
        var log = new List<string>();

        // Warrior Shield Block halves the incoming damage — works against fireballs too.
        if (target.Hero is Warrior w && w.IsBlocking)
        {
            rawDmg /= 2;
            w.ClearBlock();
            log.Add($"{target.Username} blocks! Hit reduced to {rawDmg}.");
        }

        var actual = target.Hero.TakeDamage(rawDmg);
        log.Add($"{attackerName} hits {target.Username} for {actual} dmg!");

        if (!target.Hero.IsAlive)
        {
            log.Add($"{target.Username} has fallen!");
            alive.Remove(target);  // don't hit a corpse again this tick
            if (!alive.Any())
            {
                session.IsGameOver = true;
                log.Add("The party has been wiped out...");
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

        var now = DateTime.UtcNow;
        var roomDto = new RoomDto(
            room.Type.ToString(),
            room.Enemies.Select(e =>
            {
                // Calculate charge progress (0–1) so the frontend can render the charge bar.
                float chargePercent = 0f;
                bool  isLaserFiring = false;
                float laserDirX = 0f, laserDirY = 0f;
                if (e.Enemy is GolemEnemy)
                {
                    if (e.GolemIsCharging && e.GolemChargeStartTime.HasValue)
                        chargePercent = Math.Clamp(
                            (float)(now - e.GolemChargeStartTime.Value).TotalMilliseconds
                            / RoomBounds.GolemChargeDurationMs, 0f, 1f);

                    if (e.GolemLaserFiredTime.HasValue &&
                        (now - e.GolemLaserFiredTime.Value).TotalMilliseconds < RoomBounds.GolemLaserFiringVisualMs)
                        isLaserFiring = true;

                    // Always include the aim direction so the frontend can rotate the beam sprite.
                    laserDirX = e.GolemLaserDirX;
                    laserDirY = e.GolemLaserDirY;
                }
                return new EnemyDto(
                    e.Id.ToString(), e.Enemy.Name,
                    e.Enemy.Health, e.Enemy.MaxHealth, e.Enemy.IsAlive,
                    e.X, e.Y,
                    chargePercent, isLaserFiring,
                    laserDirX, laserDirY
                );
            }).ToList(),
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

        // Snapshot all in-flight projectile positions so the frontend can place sprites accurately.
        var activeProjectiles = session.ActiveProjectiles
            .Select(p => new ActiveProjectileDto(p.Id.ToString(), p.X, p.Y))
            .ToList();

        return new GameStateDto(
            session.SessionId,
            session.CurrentRoomIndex,
            session.Rooms.Count,
            roomDto, players,
            session.RecentLog.TakeLast(15).ToList(),
            session.IsGameOver,
            session.IsVictory,
            activeProjectiles
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
