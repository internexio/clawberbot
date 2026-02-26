/**
 * v4 Spread Strike — Counter AoE clustering + immediate combat
 *
 * Lessons from v3 losses (5 losses in 50 games):
 *   - Rally phase killed us: bots didn't fight for 18 ticks while enemies attacked
 *   - Tight clustering (119u) made us AoE targets: SpaceDust quad-hit abilities
 *   - No reserve bot: top opponents keep one bot at range for endgame
 *   - Enemies melee at tick 1, we started at tick 18
 *
 * v4 changes:
 *   - NO rally phase — fight immediately, converge between attacks
 *   - Spread to 170u+ (outside 150u AoE blast radius)
 *   - Bot #4 is a dedicated kiter: ability-only, stays at 350-450u
 *   - All bots attack on tick 0 if anything is in range
 *   - Isolated bots fight back while retreating toward allies
 *   - Movement prediction for AoE
 *   - Friendly-fire protection
 */

if (typeof _s === 'undefined') {
  var _s = {
    target: null,
    targetScore: 999,
    cooldowns: {},
    prevPos: {},
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
  const SAFE_SPREAD = 170;  // Outside AoE blast radius
  const SPEED = 12;

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

  // ── Match state ──
  _s.killsUs = 5 - enemies.length;
  _s.killsThem = 5 - allTeam.length;
  const behind = _s.killsThem > _s.killsUs;

  // ── Helpers ──
  function dist(a, b) {
    const ax = a.position ? a.position.x : a.x;
    const ay = a.position ? a.position.y : a.y;
    const bx = b.position ? b.position.x : b.x;
    const by = b.position ? b.position.y : b.y;
    return Math.hypot(ax - bx, ay - by);
  }
  function dirTo(from, to) {
    const fx = from.position ? from.position.x : from.x;
    const fy = from.position ? from.position.y : from.y;
    const tx = to.position ? to.position.x : to.x;
    const ty = to.position ? to.position.y : to.y;
    return { x: tx - fx, y: ty - fy };
  }

  // ── Velocity estimation ──
  function getVelocity(bot) {
    const prev = _s.prevPos[bot.id];
    if (!prev) return { x: 0, y: 0 };
    return { x: bot.position.x - prev.x, y: bot.position.y - prev.y };
  }
  function leadPosition(bot, ticks) {
    const v = getVelocity(bot);
    return { x: bot.position.x + v.x * ticks, y: bot.position.y + v.y * ticks };
  }

  // Store positions
  for (const b of input.bots) {
    if (b.alive) _s.prevPos[b.id] = { x: b.position.x, y: b.position.y };
  }

  // ── Terrain ──
  function isPassable(x, y) {
    const t = input.tiles;
    if (!t) return true;
    const tx = Math.floor(x / t.tileSize);
    const ty = Math.floor(y / t.tileSize);
    if (tx < 0 || tx >= t.width || ty < 0 || ty >= t.height) return false;
    return t.passable[ty * t.width + tx];
  }

  function safeMove(dir) {
    const mag = Math.hypot(dir.x, dir.y);
    if (mag === 0) return { type: 'idle' };
    const nx = dir.x / mag;
    const ny = dir.y / mag;
    const dx = self.position.x + nx * SPEED;
    const dy = self.position.y + ny * SPEED;
    if (isPassable(dx, dy)) return { type: 'move', direction: { x: nx, y: ny } };
    if (isPassable(dx, self.position.y) && Math.abs(nx) > 0.1)
      return { type: 'move', direction: { x: nx > 0 ? 1 : -1, y: 0 } };
    if (isPassable(self.position.x, dy) && Math.abs(ny) > 0.1)
      return { type: 'move', direction: { x: 0, y: ny > 0 ? 1 : -1 } };
    if (isPassable(self.position.x + ny * SPEED, self.position.y - nx * SPEED))
      return { type: 'move', direction: { x: ny, y: -nx } };
    if (isPassable(self.position.x - ny * SPEED, self.position.y + nx * SPEED))
      return { type: 'move', direction: { x: -ny, y: nx } };
    return { type: 'idle' };
  }

  // ── Zone ──
  const zone = input.zone;
  const zx = zone.centerX != null ? zone.centerX : (zone.center ? zone.center.x : 1024);
  const zy = zone.centerY != null ? zone.centerY : (zone.center ? zone.center.y : 1024);
  const zr = zone.radius || 1024;
  const distToCenter = Math.hypot(self.position.x - zx, self.position.y - zy);

  if (distToCenter > zr) {
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }
  const nearZoneEdge = distToCenter > zr - ZONE_BUFFER;

  // ── Nearest enemy ──
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);

  // ── Team info ──
  const teamCenter = {
    x: allTeam.reduce((s, b) => s + b.position.x, 0) / allTeam.length,
    y: allTeam.reduce((s, b) => s + b.position.y, 0) / allTeam.length,
  };
  const distToTeam = Math.hypot(self.position.x - teamCenter.x, self.position.y - teamCenter.y);

  // Am I isolated? (no allies within 350u)
  const nearbyAllies = allies.filter(a => dist(self, a) < 350).length;
  const isolated = nearbyAllies === 0 && allies.length > 0;

  // ── Is this the KITER bot? (bot #4) ──
  const isKiter = input.botNumber === 4;

  // ── Target selection ──
  function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 400).length + 1;
    const nearEdge = Math.hypot(e.position.x - zx, e.position.y - zy) > zr - 100;
    const lowHP = e.health <= 30 ? -50 : 0;
    return e.health + lowHP - alliesNear * 25 + d * 0.03 - (nearEdge ? 30 : 0);
  }

  const aliveTeamIds = [input.selfId, ...allies.map(a => a.id)].sort();
  const isLeader = aliveTeamIds[0] === input.selfId;

  let target = null;
  if (_s.target) target = enemies.find(e => e.id === _s.target);

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

  const targetDist = dist(self, target);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  // ── Friendly-fire check helper ──
  function alliesInBlast(pos) {
    return allies.filter(a =>
      Math.hypot(a.position.x - pos.x, a.position.y - pos.y) <= ABL_RADIUS
    ).length;
  }

  // ══════════════════════════════════════════════════
  // KITER BOT (#4): Stay at 350-450u, ability only
  // ══════════════════════════════════════════════════
  if (isKiter) {
    // Fire ability if available
    if (canAbility) {
      // Best multi-hit target
      let bestPos = null;
      let bestHits = 0;
      for (const e of enemies) {
        const d = Math.hypot(e.position.x - self.position.x, e.position.y - self.position.y);
        if (d > ABL_RANGE) continue;
        const lead = leadPosition(e, 2);
        const hits = enemies.filter(e2 =>
          Math.hypot(e2.position.x - lead.x, e2.position.y - lead.y) <= ABL_RADIUS
        ).length;
        if (hits > bestHits && alliesInBlast(lead) === 0) {
          bestHits = hits;
          bestPos = lead;
        }
      }
      if (bestPos) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: bestPos };
      }
      // Single target fallback
      if (targetDist <= ABL_RANGE) {
        const lead = leadPosition(target, 2);
        if (alliesInBlast(lead) === 0) {
          cd.abl = tick;
          return { type: 'ability', targetPosition: lead };
        }
      }
    }

    // Kiter positioning: stay at 350-450u from nearest enemy
    const idealDist = 400;
    const tooClose = nearestDist < 300;
    const tooFar = nearestDist > ABL_RANGE;

    if (tooClose) {
      // Retreat away from enemy, toward zone center
      const away = {
        x: (self.position.x - nearestEnemy.position.x) * 0.6 + (zx - self.position.x) * 0.4,
        y: (self.position.y - nearestEnemy.position.y) * 0.6 + (zy - self.position.y) * 0.4,
      };
      return safeMove(away);
    }
    if (tooFar) {
      // Close in toward target but not too aggressively
      return safeMove(dirTo(self, target));
    }

    // At ideal range: strafe
    const strafeAngle = Math.atan2(
      target.position.y - self.position.y,
      target.position.x - self.position.x
    ) + Math.PI / 2;
    const strafeDir = {
      x: Math.cos(strafeAngle) * 0.6 + (zx - self.position.x) * 0.02,
      y: Math.sin(strafeAngle) * 0.6 + (zy - self.position.y) * 0.02,
    };
    return safeMove(strafeDir);
  }

  // ══════════════════════════════════════════════════
  // ASSAULT BOTS (#0-3): Fight immediately, smart spacing
  // ══════════════════════════════════════════════════

  // ── ABILITY: always highest priority (after zone) ──
  if (canAbility) {
    let bestPos = null;
    let bestScore = -999;

    for (const e of enemies) {
      const d = Math.hypot(e.position.x - self.position.x, e.position.y - self.position.y);
      if (d > ABL_RANGE) continue;
      const lead = leadPosition(e, 2);
      const enemyHits = enemies.filter(e2 =>
        Math.hypot(e2.position.x - lead.x, e2.position.y - lead.y) <= ABL_RADIUS
      ).length;
      const friendlyHits = alliesInBlast(lead);
      const score = enemyHits * 2 - friendlyHits * 3;
      if (score > bestScore && enemyHits > 0 && friendlyHits === 0) {
        bestScore = score;
        bestPos = lead;
      }
    }

    // Multi-hit
    if (bestPos && bestScore >= 4) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: bestPos };
    }

    // Single target on focus target
    if (targetDist <= ABL_RANGE) {
      const lead = leadPosition(target, 2);
      if (alliesInBlast(lead) === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }

    // Fallback: nearest enemy
    if (nearestDist <= ABL_RANGE && targetDist > ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      if (alliesInBlast(lead) === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
  }

  // ── CRITICAL HP: flee toward nearest ally ──
  if (criticalHP && allies.length > 0) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    return safeMove({
      x: (nearestAlly.position.x - self.position.x) * 0.6 + (self.position.x - nearestEnemy.position.x) * 0.4,
      y: (nearestAlly.position.y - self.position.y) * 0.6 + (self.position.y - nearestEnemy.position.y) * 0.4,
    });
  }

  // ── MELEE: attack immediately if in range ──
  if (canAttack && targetDist <= ATK_RANGE) {
    cd.atk = tick;
    return { type: 'attack', targetId: target.id };
  }
  if (canAttack && nearestDist <= ATK_RANGE) {
    cd.atk = tick;
    return { type: 'attack', targetId: nearestEnemy.id };
  }

  // ── MOVEMENT ──

  // Low HP: retreat toward allies while kiting
  if (lowHP && allies.length > 0) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    return safeMove({
      x: (nearestAlly.position.x - self.position.x) * 0.5 +
         (self.position.x - nearestEnemy.position.x) * 0.3 +
         (zx - self.position.x) * 0.2,
      y: (nearestAlly.position.y - self.position.y) * 0.5 +
         (self.position.y - nearestEnemy.position.y) * 0.3 +
         (zy - self.position.y) * 0.2,
    });
  }

  // Isolated bot: fight back but move toward allies
  if (isolated && nearestDist > ATK_RANGE) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    // If enemy is between us and allies, go around; otherwise go to ally
    const toAlly = dirTo(self, nearestAlly);
    const toEnemy = dirTo(self, nearestEnemy);
    // Blend: primarily toward ally, slightly away from enemy
    return safeMove({
      x: toAlly.x * 0.7 + (self.position.x - nearestEnemy.position.x) * 0.3,
      y: toAlly.y * 0.7 + (self.position.y - nearestEnemy.position.y) * 0.3,
    });
  }

  // Find closest ally for spread check
  const closestAlly = allies.length > 0 ? allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b) : null;
  const tooClose = closestAlly && dist(self, closestAlly) < SAFE_SPREAD;

  // Close to target
  if (targetDist > ATK_RANGE) {
    let moveDir = dirTo(self, target);

    // Anti-clump: spread from closest ally (stay outside AoE radius)
    if (tooClose) {
      const away = {
        x: self.position.x - closestAlly.position.x,
        y: self.position.y - closestAlly.position.y,
      };
      moveDir.x = moveDir.x * 0.6 + away.x * 0.4;
      moveDir.y = moveDir.y * 0.6 + away.y * 0.4;
    }

    // Cohesion when behind: don't scatter too far
    if (behind && distToTeam > 350) {
      moveDir.x = moveDir.x * 0.6 + (teamCenter.x - self.position.x) * 0.4;
      moveDir.y = moveDir.y * 0.6 + (teamCenter.y - self.position.y) * 0.4;
    }

    // Zone pull
    if (nearZoneEdge) {
      moveDir.x = moveDir.x * 0.5 + (zx - self.position.x) * 0.5;
      moveDir.y = moveDir.y * 0.5 + (zy - self.position.y) * 0.5;
    }

    return safeMove(moveDir);
  }

  // In melee range, on cooldown: orbit + maintain spread
  const angle = Math.atan2(target.position.y - self.position.y, target.position.x - self.position.x);
  const orbitDir = (input.botNumber % 2 === 0) ? 1.2 : -1.2;
  const toTarget = dirTo(self, target);
  const mag = Math.hypot(toTarget.x, toTarget.y) || 1;

  let orbitMove = {
    x: Math.cos(angle + orbitDir) * 0.4 + (toTarget.x / mag) * 0.6,
    y: Math.sin(angle + orbitDir) * 0.4 + (toTarget.y / mag) * 0.6,
  };

  // Even while orbiting, spread from closest ally
  if (tooClose) {
    const away = {
      x: self.position.x - closestAlly.position.x,
      y: self.position.y - closestAlly.position.y,
    };
    orbitMove.x = orbitMove.x * 0.6 + away.x * 0.4;
    orbitMove.y = orbitMove.y * 0.6 + away.y * 0.4;
  }

  return safeMove(orbitMove);
}
