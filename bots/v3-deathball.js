/**
 * v3 Deathball — Counter-isolation with forced convergence
 *
 * Key changes from v2-apex-predator:
 *   - Opening rally: first 20 ticks, all bots converge to team centroid
 *   - Emergency assist: detect isolated teammates under attack, redirect nearest bot
 *   - AoE alpha strike: fire ability at nearest enemy on tick 0-1
 *   - Movement prediction: lead AoE targets by estimated velocity
 *   - Friendly-fire check: don't AoE if allies in blast radius
 *   - Match state awareness: tighten formation when losing, push when winning
 *   - Better low-HP behavior: retreat toward allies, not just away from enemies
 */

// ── Shared state (persists across all 5 bots within match) ──
if (typeof _s === 'undefined') {
  var _s = {
    target: null,
    targetScore: 999,
    cooldowns: {},
    prevPos: {},       // Previous tick positions for velocity estimation
    allyHP: {},        // Track ally HP changes to detect who's under attack
    rallyDone: false,  // Whether initial convergence is complete
    killsUs: 0,
    killsThem: 0,
  };
}

function update(input) {
  const ATK_RANGE = 200;
  const ATK_CD = 5;
  const ABL_RANGE = 500;
  const ABL_RADIUS = 150;
  const ABL_CD = 30;
  const ZONE_BUFFER = 150;
  const SPREAD_DIST = 120;
  const SPEED = 12;
  const RALLY_TICKS = 18;
  const CONVERGE_DIST = 250;

  const self = input.bots.find(b => b.id === input.selfId);
  if (!self || !self.alive) return { type: 'idle' };

  const teamIds = new Set(input.teamBotIds);
  const allies = input.bots.filter(b => b.alive && teamIds.has(b.id) && b.id !== input.selfId);
  const allTeam = input.bots.filter(b => b.alive && teamIds.has(b.id));
  const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));
  const tick = input.tick;

  if (enemies.length === 0) return { type: 'idle' };

  // ── Cooldown tracking ──
  if (!_s.cooldowns[input.selfId]) {
    _s.cooldowns[input.selfId] = { atk: -999, abl: -999 };
  }
  const cd = _s.cooldowns[input.selfId];
  const canAttack = tick - cd.atk >= ATK_CD;
  const canAbility = tick - cd.abl >= ABL_CD;

  // ── Track match state ──
  _s.killsUs = 5 - enemies.length;
  _s.killsThem = 5 - allTeam.length;
  const ahead = _s.killsUs > _s.killsThem;
  const behind = _s.killsThem > _s.killsUs;

  // ── Track ally HP for emergency assist ──
  for (const a of allTeam) {
    const prev = _s.allyHP[a.id];
    if (prev !== undefined && a.health < prev) {
      // This ally took damage this tick
      _s.allyHP[a.id] = a.health;
    } else {
      _s.allyHP[a.id] = a.health;
    }
  }

  // ── Helpers ──
  function dist(a, b) {
    const ax = a.position ? a.position.x : a.x;
    const ay = a.position ? a.position.y : a.y;
    const bx = b.position ? b.position.x : b.x;
    const by = b.position ? b.position.y : b.y;
    return Math.hypot(ax - bx, ay - by);
  }
  function posOf(b) { return b.position || b; }
  function dirTo(from, to) {
    const fp = posOf(from), tp = posOf(to);
    return { x: tp.x - fp.x, y: tp.y - fp.y };
  }
  function dirAway(from, away) {
    const fp = posOf(from), ap = posOf(away);
    return { x: fp.x - ap.x, y: fp.y - ap.y };
  }

  // ── Velocity estimation ──
  function getVelocity(bot) {
    const prev = _s.prevPos[bot.id];
    if (!prev) return { x: 0, y: 0 };
    return { x: bot.position.x - prev.x, y: bot.position.y - prev.y };
  }
  function leadPosition(bot, ticks) {
    const v = getVelocity(bot);
    return {
      x: bot.position.x + v.x * ticks,
      y: bot.position.y + v.y * ticks,
    };
  }

  // Store positions for next tick
  for (const b of input.bots) {
    if (b.alive) _s.prevPos[b.id] = { x: b.position.x, y: b.position.y };
  }

  // ── Terrain-aware movement ──
  function isPassable(x, y) {
    const t = input.tiles;
    if (!t) return true;
    const tx = Math.floor(x / t.tileSize);
    const ty = Math.floor(y / t.tileSize);
    if (tx < 0 || tx >= t.width || ty < 0 || ty >= t.height) return false;
    return t.passable[ty * t.width + tx];
  }

  function safeMove(dir, say) {
    const mag = Math.hypot(dir.x, dir.y);
    if (mag === 0) return { type: 'idle' };
    const nx = dir.x / mag;
    const ny = dir.y / mag;
    const dx = self.position.x + nx * SPEED;
    const dy = self.position.y + ny * SPEED;

    const action = (d) => {
      const r = { type: 'move', direction: d };
      if (say) r.say = say;
      return r;
    };

    if (isPassable(dx, dy)) return action({ x: nx, y: ny });
    if (isPassable(dx, self.position.y) && Math.abs(nx) > 0.1)
      return action({ x: nx > 0 ? 1 : -1, y: 0 });
    if (isPassable(self.position.x, dy) && Math.abs(ny) > 0.1)
      return action({ x: 0, y: ny > 0 ? 1 : -1 });
    if (isPassable(self.position.x + ny * SPEED, self.position.y - nx * SPEED))
      return action({ x: ny, y: -nx });
    if (isPassable(self.position.x - ny * SPEED, self.position.y + nx * SPEED))
      return action({ x: -ny, y: nx });
    return { type: 'idle' };
  }

  // ── Zone awareness ──
  const zone = input.zone;
  const zx = zone.centerX != null ? zone.centerX : (zone.center ? zone.center.x : 1024);
  const zy = zone.centerY != null ? zone.centerY : (zone.center ? zone.center.y : 1024);
  const zr = zone.radius || 1024;
  const distToCenter = Math.hypot(self.position.x - zx, self.position.y - zy);

  // Emergency: get back in zone
  if (distToCenter > zr) {
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }
  const nearZoneEdge = distToCenter > zr - ZONE_BUFFER;

  // ── Team centroid ──
  const teamCenter = {
    x: allTeam.reduce((s, b) => s + b.position.x, 0) / allTeam.length,
    y: allTeam.reduce((s, b) => s + b.position.y, 0) / allTeam.length,
  };
  const distToTeam = Math.hypot(self.position.x - teamCenter.x, self.position.y - teamCenter.y);

  // ── Nearest enemy ──
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);

  // ── PHASE 1: Opening Rally (counter isolation) ──
  // First N ticks: converge to team centroid. Fire AoE at nearest enemy if in range.
  if (tick < RALLY_TICKS && !_s.rallyDone) {
    // AoE alpha strike during rally — fire at nearest enemy if in range
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      // Check friendly fire
      const alliesInBlast = allies.filter(a =>
        Math.hypot(a.position.x - lead.x, a.position.y - lead.y) <= ABL_RADIUS
      ).length;
      if (alliesInBlast === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }

    // Converge toward team centroid (biased toward zone center)
    const rallyX = teamCenter.x * 0.7 + zx * 0.3;
    const rallyY = teamCenter.y * 0.7 + zy * 0.3;

    if (distToTeam > CONVERGE_DIST) {
      return safeMove({ x: rallyX - self.position.x, y: rallyY - self.position.y });
    }

    // If we're already converged, melee anything in range
    if (canAttack && nearestDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }

    // Keep moving toward rally
    return safeMove({ x: rallyX - self.position.x, y: rallyY - self.position.y });
  }

  // Mark rally as done (won't re-trigger)
  if (tick >= RALLY_TICKS) _s.rallyDone = true;

  // ── Emergency assist: find isolated allies under attack ──
  let assistTarget = null;
  for (const ally of allies) {
    // Ally is "isolated" if no other ally within 300u and HP dropping
    const allyAlliesNearby = allies.filter(a =>
      a.id !== ally.id && dist(a, ally) < 300
    ).length;
    const iAmNearby = dist(self, ally) < 300;
    const allyIsolated = allyAlliesNearby === 0 && !iAmNearby;

    if (allyIsolated && ally.health < 60) {
      // Find enemy attacking this ally (nearest enemy to them)
      const enemyOnAlly = enemies.reduce((a, b) => dist(a, ally) < dist(b, ally) ? a : b);
      if (dist(enemyOnAlly, ally) < ATK_RANGE + 50) {
        assistTarget = ally;
        break;
      }
    }
  }

  // ── Target selection (leader-locked with emergency override) ──
  function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 400).length + 1;
    const nearEdge = Math.hypot(e.position.x - zx, e.position.y - zy) > zr - 100;
    const lowHP = e.health <= 30 ? -40 : 0; // Prioritize kills
    return e.health + lowHP - alliesNear * 25 + d * 0.03 - (nearEdge ? 30 : 0);
  }

  const aliveTeamIds = [input.selfId, ...allies.map(a => a.id)].sort();
  const isLeader = aliveTeamIds[0] === input.selfId;

  let target = null;
  if (_s.target) {
    target = enemies.find(e => e.id === _s.target);
  }

  if (isLeader || !target) {
    const scored = enemies.map(e => ({ enemy: e, score: scoreEnemy(e) }));
    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];

    const currentScore = target ? scoreEnemy(target) : 999;
    if (!target || best.score < currentScore - 15) {
      target = best.enemy;
      _s.target = target.id;
      _s.targetScore = best.score;
    }
  }

  // Emergency assist override: if I'm nearest to an isolated ally, go help
  if (assistTarget) {
    const myDistToAlly = dist(self, assistTarget);
    const otherDists = allies.filter(a => a.id !== assistTarget.id).map(a => dist(a, assistTarget));
    const iAmNearest = otherDists.every(d => myDistToAlly <= d + 50);

    if (iAmNearest) {
      // Redirect to the enemy attacking our ally
      const threatEnemy = enemies.reduce((a, b) => dist(a, assistTarget) < dist(b, assistTarget) ? a : b);
      target = threatEnemy;
    }
  }

  const targetDist = dist(self, target);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  // ── ABILITY: fire aggressively with movement prediction ──
  if (canAbility) {
    // Find best AoE target (maximize enemies hit, minimize ally hits)
    let bestPos = null;
    let bestScore = -999;

    for (const e of enemies) {
      const d = Math.hypot(e.position.x - self.position.x, e.position.y - self.position.y);
      if (d > ABL_RANGE) continue;

      const lead = leadPosition(e, 2);
      const enemyHits = enemies.filter(e2 =>
        Math.hypot(e2.position.x - lead.x, e2.position.y - lead.y) <= ABL_RADIUS
      ).length;
      const allyHits = allies.filter(a =>
        Math.hypot(a.position.x - lead.x, a.position.y - lead.y) <= ABL_RADIUS
      ).length;

      const score = enemyHits * 2 - allyHits * 3; // Penalize friendly fire heavily
      if (score > bestScore && enemyHits > 0 && allyHits === 0) {
        bestScore = score;
        bestPos = lead;
      }
    }

    // Fire on clusters (2+) always (if no friendly fire)
    if (bestPos && bestScore >= 4) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: bestPos };
    }

    // Fire on focus target if in range (with lead)
    if (targetDist <= ABL_RANGE) {
      const lead = leadPosition(target, 2);
      const allyHits = allies.filter(a =>
        Math.hypot(a.position.x - lead.x, a.position.y - lead.y) <= ABL_RADIUS
      ).length;
      if (allyHits === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }

    // Fire on nearest enemy if target too far
    if (nearestDist <= ABL_RANGE && targetDist > ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      const allyHits = allies.filter(a =>
        Math.hypot(a.position.x - lead.x, a.position.y - lead.y) <= ABL_RADIUS
      ).length;
      if (allyHits === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
  }

  // ── CRITICAL HP: flee toward allies ──
  if (criticalHP && allies.length > 0) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    const fleeDir = {
      x: (nearestAlly.position.x - self.position.x) * 0.6 + (self.position.x - nearestEnemy.position.x) * 0.4,
      y: (nearestAlly.position.y - self.position.y) * 0.6 + (self.position.y - nearestEnemy.position.y) * 0.4,
    };
    return safeMove(fleeDir);
  }

  // ── MELEE: attack target if in range ──
  if (canAttack && targetDist <= ATK_RANGE) {
    cd.atk = tick;
    return { type: 'attack', targetId: target.id };
  }

  // Attack nearest if target is far away
  if (canAttack && nearestDist <= ATK_RANGE && targetDist > ATK_RANGE * 2) {
    cd.atk = tick;
    return { type: 'attack', targetId: nearestEnemy.id };
  }

  // ── MOVEMENT ──
  const tooCloseAlly = allies.find(a => dist(self, a) < SPREAD_DIST);

  // Low HP: retreat toward allies
  if (lowHP && allies.length > 0) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    const retreatDir = {
      x: (nearestAlly.position.x - self.position.x) * 0.5 +
         (self.position.x - nearestEnemy.position.x) * 0.3 +
         (zx - self.position.x) * 0.2,
      y: (nearestAlly.position.y - self.position.y) * 0.5 +
         (self.position.y - nearestEnemy.position.y) * 0.3 +
         (zy - self.position.y) * 0.2,
    };
    return safeMove(retreatDir);
  }

  // When behind: tighter formation, move as group
  const cohesionWeight = behind ? 0.4 : 0.15;

  // ALL bots close to melee (no more passive support at range)
  if (targetDist > ATK_RANGE) {
    let moveDir = dirTo(self, target);
    // Cohesion: blend toward team center
    if (distToTeam > 200) {
      moveDir.x = moveDir.x * (1 - cohesionWeight) + (teamCenter.x - self.position.x) * cohesionWeight;
      moveDir.y = moveDir.y * (1 - cohesionWeight) + (teamCenter.y - self.position.y) * cohesionWeight;
    }
    // Anti-clump
    if (tooCloseAlly) {
      const spread = dirAway(self, tooCloseAlly);
      moveDir.x = moveDir.x * 0.7 + spread.x * 0.3;
      moveDir.y = moveDir.y * 0.7 + spread.y * 0.3;
    }
    // Zone pull
    if (nearZoneEdge) {
      moveDir.x = moveDir.x * 0.5 + (zx - self.position.x) * 0.5;
      moveDir.y = moveDir.y * 0.5 + (zy - self.position.y) * 0.5;
    }
    return safeMove(moveDir);
  }

  // In melee range, on cooldown: orbit to dodge while staying close
  const angle = Math.atan2(target.position.y - self.position.y, target.position.x - self.position.x);
  const orbitOffset = (input.botNumber % 2 === 0) ? 1.2 : -1.2;
  const toTarget = dirTo(self, target);
  const mag = Math.hypot(toTarget.x, toTarget.y) || 1;
  return safeMove({
    x: Math.cos(angle + orbitOffset) * 0.4 + (toTarget.x / mag) * 0.6,
    y: Math.sin(angle + orbitOffset) * 0.4 + (toTarget.y / mag) * 0.6,
  });
}
