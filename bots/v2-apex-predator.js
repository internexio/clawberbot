/**
 * v2 Apex Predator — High-performance coordinated combat
 *
 * Key improvements over v1:
 *   - Per-bot cooldown tracking (attack 5 ticks, ability 30 ticks)
 *   - ALL bots use ability aggressively (even on single targets)
 *   - Melee between ability cooldowns (no idle ticks)
 *   - Terrain-aware movement (avoid obstacles)
 *   - Bot 0 locks focus target (prevents flicker)
 *   - Anti-AoE spreading
 *   - Kiting on low HP
 */

// ── Shared state (persists across all 5 bots within match) ──
if (typeof _s === 'undefined') {
  var _s = {
    target: null,         // Current focus target ID (set by leader only)
    targetScore: 999,     // Score of current target for comparison
    cooldowns: {},        // Per-bot: { atk: tick, abl: tick }
  };
}

function update(input) {
  const ATK_RANGE = 200;
  const ATK_CD = 5;
  const ABL_RANGE = 500;
  const ABL_RADIUS = 150;
  const ABL_CD = 30;
  const ZONE_BUFFER = 150;
  const SPREAD_DIST = 160;
  const SPEED = 12;

  const self = input.bots.find(b => b.id === input.selfId);
  if (!self || !self.alive) return { type: 'idle' };

  const teamIds = new Set(input.teamBotIds);
  const allies = input.bots.filter(b => b.alive && teamIds.has(b.id) && b.id !== input.selfId);
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

  // ── Helpers ──
  function dist(a, b) {
    return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  }
  function dirTo(from, to) {
    return { x: to.position.x - from.position.x, y: to.position.y - from.position.y };
  }
  function dirAway(from, away) {
    return { x: from.position.x - away.position.x, y: from.position.y - away.position.y };
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

  // ── Zone awareness ──
  const zone = input.zone;
  const zx = zone.centerX != null ? zone.centerX : (zone.center ? zone.center.x : 1024);
  const zy = zone.centerY != null ? zone.centerY : (zone.center ? zone.center.y : 1024);
  const zr = zone.radius || 1024;
  const distToCenter = Math.hypot(self.position.x - zx, self.position.y - zy);

  if (distToCenter > zr) {
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }
  const nearZoneEdge = distToCenter > zr - ZONE_BUFFER;

  // ── Target selection (leader-locked) ──
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);

  // Score enemies for focus fire
  function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 400).length + 1;
    const nearEdge = Math.hypot(e.position.x - zx, e.position.y - zy) > zr - 100;
    return e.health - alliesNear * 25 + d * 0.03 - (nearEdge ? 30 : 0);
  }

  // Only the lowest-numbered alive bot sets the shared target
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

    // Switch if: no target, target dead, or significantly better option
    const currentScore = target ? scoreEnemy(target) : 999;
    if (!target || best.score < currentScore - 15) {
      target = best.enemy;
      _s.target = target.id;
      _s.targetScore = best.score;
    }
  }

  const targetDist = dist(self, target);
  const nearestDist = dist(self, nearestEnemy);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  // ── ABILITY: fire aggressively (highest priority after zone) ──
  // hbfreed-opus fires 17 abilities per match vs our 2. Every bot should use ability.
  if (canAbility) {
    // Find best AoE target (maximize enemies hit)
    let bestPos = null;
    let bestCount = 0;
    for (const e of enemies) {
      const d = Math.hypot(e.position.x - self.position.x, e.position.y - self.position.y);
      if (d > ABL_RANGE) continue;
      const hits = enemies.filter(e2 =>
        Math.hypot(e2.position.x - e.position.x, e2.position.y - e.position.y) <= ABL_RADIUS
      ).length;
      if (hits > bestCount) {
        bestCount = hits;
        bestPos = { x: e.position.x, y: e.position.y };
      }
    }

    // Fire on clusters (2+) always
    if (bestPos && bestCount >= 2) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: bestPos };
    }

    // Fire on single target if in ability range
    // ALL bots fire ability — don't reserve it for support only
    if (targetDist <= ABL_RANGE) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: { x: target.position.x, y: target.position.y } };
    }

    // Fire on nearest enemy if target too far but nearest is in range
    if (nearestDist <= ABL_RANGE && targetDist > ABL_RANGE) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: { x: nearestEnemy.position.x, y: nearestEnemy.position.y } };
    }
  }

  // ── CRITICAL HP: ability was already checked above, now flee ──
  if (criticalHP) {
    const fleeDir = {
      x: (zx - self.position.x) * 0.6 + (self.position.x - nearestEnemy.position.x) * 0.4,
      y: (zy - self.position.y) * 0.6 + (self.position.y - nearestEnemy.position.y) * 0.4,
    };
    return safeMove(fleeDir);
  }

  // ── MELEE: attack target if in range ──
  if (canAttack && targetDist <= ATK_RANGE) {
    cd.atk = tick;
    return { type: 'attack', targetId: target.id };
  }

  // Attack nearest ONLY if target is far away (>2x melee range)
  if (canAttack && nearestDist <= ATK_RANGE && targetDist > ATK_RANGE * 2) {
    cd.atk = tick;
    return { type: 'attack', targetId: nearestEnemy.id };
  }

  // ── MOVEMENT ──
  const tooCloseAlly = allies.find(a => dist(self, a) < SPREAD_DIST);

  // Low HP kiting
  if (lowHP && nearestDist < 200) {
    const retreatDir = {
      x: (self.position.x - nearestEnemy.position.x) * 0.7 + (zx - self.position.x) * 0.3,
      y: (self.position.y - nearestEnemy.position.y) * 0.7 + (zy - self.position.y) * 0.3,
    };
    return safeMove(retreatDir);
  }

  // BOTS 0-2: ASSAULT — close to melee range
  if (input.botNumber <= 2) {
    if (targetDist > ATK_RANGE) {
      let moveDir = dirTo(self, target);
      if (tooCloseAlly) {
        const spread = dirAway(self, tooCloseAlly);
        moveDir.x = moveDir.x * 0.7 + spread.x * 0.3;
        moveDir.y = moveDir.y * 0.7 + spread.y * 0.3;
      }
      if (nearZoneEdge) {
        moveDir.x = moveDir.x * 0.5 + (zx - self.position.x) * 0.5;
        moveDir.y = moveDir.y * 0.5 + (zy - self.position.y) * 0.5;
      }
      return safeMove(moveDir);
    }
    // In range, on cooldown: orbit to stay in range and dodge
    const angle = Math.atan2(target.position.y - self.position.y, target.position.x - self.position.x);
    const orbitOffset = input.botNumber === 0 ? 1.2 : input.botNumber === 1 ? -1.2 : Math.PI;
    const toTarget = dirTo(self, target);
    const mag = Math.hypot(toTarget.x, toTarget.y) || 1;
    return safeMove({
      x: Math.cos(angle + orbitOffset) * 0.4 + (toTarget.x / mag) * 0.6,
      y: Math.sin(angle + orbitOffset) * 0.4 + (toTarget.y / mag) * 0.6,
    });
  }

  // BOTS 3-4: RANGED SUPPORT — ability range, melee if close
  const idealRange = 350;

  // If in melee range and can attack, DO attack (don't waste ticks)
  if (canAttack && nearestDist <= ATK_RANGE) {
    cd.atk = tick;
    return { type: 'attack', targetId: nearestEnemy.id };
  }

  if (targetDist > ABL_RANGE) {
    let moveDir = dirTo(self, target);
    if (nearZoneEdge) {
      moveDir.x = moveDir.x * 0.5 + (zx - self.position.x) * 0.5;
      moveDir.y = moveDir.y * 0.5 + (zy - self.position.y) * 0.5;
    }
    return safeMove(moveDir);
  }

  if (targetDist < idealRange - 50 && nearestDist < ATK_RANGE + 50) {
    // Too close, kite back
    return safeMove(dirAway(self, nearestEnemy));
  }

  // Strafe at ideal range
  const strafeAngle = Math.atan2(target.position.y - self.position.y, target.position.x - self.position.x)
    + (input.botNumber === 3 ? Math.PI / 2 : -Math.PI / 2);
  return safeMove({ x: Math.cos(strafeAngle), y: Math.sin(strafeAngle) });
}
