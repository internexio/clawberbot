/**
 * v5 Hard Spread — Fix the 4 bugs that caused v4's losses
 *
 * v4 went 90W-4L (96%). The 4 losses were all fixable:
 *   1. Spread fails when bots share target direction (40% away loses to 60% toward)
 *      → Hard spread: if within 155u of any ally, ONLY move away (override pursuit)
 *   2. Kiter has no ally-avoidance (clusters with teammates, dies to shared AoE)
 *      → Kiter always maintains 200u+ from nearest ally
 *   3. Low-HP bots flee into zone (2 zone deaths turned 3-1 lead into 3-5 loss)
 *      → Zone-priority retreat: when near zone edge, 80% toward center
 *   4. No endgame pursuit (bot idles while last enemy hides at 886u, loses to timeout)
 *      → Chase mode: when few enemies remain and zone is shrinking, pursue aggressively
 *   5. Bot gets stuck/idles (safeMove returns idle, bot sits at spawn for 100+ ticks)
 *      → Enhanced safeMove with 8-direction fallback
 */

if (typeof _s === 'undefined') {
  var _s = {
    target: null,
    targetScore: 999,
    cooldowns: {},
    prevPos: {},
    killsUs: 0,
    killsThem: 0,
    idleTicks: {},  // Track consecutive idle ticks per bot
  };
}

function update(input) {
  const ATK_RANGE = 200;
  const ATK_CD = 5;
  const ABL_RANGE = 500;
  const ABL_RADIUS = 150;
  const ABL_CD = 30;
  const ZONE_BUFFER = 150;
  const HARD_SPREAD = 155;   // Hard minimum — if closer, ONLY spread
  const SOFT_SPREAD = 200;   // Soft target — blend spread into movement
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

  // ── Idle tracking ──
  if (!_s.idleTicks[input.selfId]) _s.idleTicks[input.selfId] = 0;

  // ── Match state ──
  _s.killsUs = 5 - enemies.length;
  _s.killsThem = 5 - allTeam.length;
  const behind = _s.killsThem > _s.killsUs;
  const ahead = _s.killsUs > _s.killsThem;
  // lateGame computed after zone vars are set (see below)

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

  // Enhanced safeMove with 8-direction fallback
  function safeMove(dir) {
    const mag = Math.hypot(dir.x, dir.y);
    if (mag === 0) {
      _s.idleTicks[input.selfId]++;
      return { type: 'idle' };
    }
    const nx = dir.x / mag;
    const ny = dir.y / mag;
    const dx = self.position.x + nx * SPEED;
    const dy = self.position.y + ny * SPEED;

    if (isPassable(dx, dy)) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: nx, y: ny } }; }
    // Try axis-aligned
    if (isPassable(dx, self.position.y) && Math.abs(nx) > 0.1) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: nx > 0 ? 1 : -1, y: 0 } }; }
    if (isPassable(self.position.x, dy) && Math.abs(ny) > 0.1) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: 0, y: ny > 0 ? 1 : -1 } }; }
    // Try perpendicular
    if (isPassable(self.position.x + ny * SPEED, self.position.y - nx * SPEED)) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: ny, y: -nx } }; }
    if (isPassable(self.position.x - ny * SPEED, self.position.y + nx * SPEED)) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: -ny, y: nx } }; }
    // 8-direction fallback: try all cardinal + diagonal
    const dirs = [[1,0],[0,1],[-1,0],[0,-1],[0.7,0.7],[-0.7,0.7],[0.7,-0.7],[-0.7,-0.7]];
    for (const [fx, fy] of dirs) {
      if (isPassable(self.position.x + fx * SPEED, self.position.y + fy * SPEED)) {
        _s.idleTicks[input.selfId] = 0;
        return { type: 'move', direction: { x: fx, y: fy } };
      }
    }
    _s.idleTicks[input.selfId]++;
    return { type: 'idle' };
  }

  // ── Zone ──
  const zone = input.zone;
  const zx = zone.centerX != null ? zone.centerX : (zone.center ? zone.center.x : 1024);
  const zy = zone.centerY != null ? zone.centerY : (zone.center ? zone.center.y : 1024);
  const zr = zone.radius || 1024;
  const distToCenter = Math.hypot(self.position.x - zx, self.position.y - zy);

  function zoneSmall() { return zr < 500; }

  if (distToCenter > zr) {
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }
  const nearZoneEdge = distToCenter > zr - ZONE_BUFFER;
  const lateGame = tick > 600 || zoneSmall();

  // ── Nearest enemy ──
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);

  // ── Closest ally + hard spread check ──
  const closestAlly = allies.length > 0 ? allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b) : null;
  const allyDist = closestAlly ? dist(self, closestAlly) : 9999;
  const inAoEDanger = allyDist < HARD_SPREAD;  // Within AoE blast of teammate

  // ── Team info ──
  const teamCenter = {
    x: allTeam.reduce((s, b) => s + b.position.x, 0) / allTeam.length,
    y: allTeam.reduce((s, b) => s + b.position.y, 0) / allTeam.length,
  };
  const distToTeam = Math.hypot(self.position.x - teamCenter.x, self.position.y - teamCenter.y);

  const nearbyAllies = allies.filter(a => dist(self, a) < 350).length;
  const isolated = nearbyAllies === 0 && allies.length > 0;

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

  // Re-score every 20 ticks or if target is dead/missing
  if (isLeader || !target || tick % 20 === 0) {
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
  // Fallback if target still null (shouldn't happen, but prevent crash)
  if (!target) target = nearestEnemy;

  const targetDist = dist(self, target);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  function alliesInBlast(pos) {
    return allies.filter(a =>
      Math.hypot(a.position.x - pos.x, a.position.y - pos.y) <= ABL_RADIUS
    ).length;
  }

  // ── Spread direction from closest ally ──
  function spreadDir() {
    if (!closestAlly) return { x: 0, y: 0 };
    return { x: self.position.x - closestAlly.position.x, y: self.position.y - closestAlly.position.y };
  }

  // ══════════════════════════════════════════════════
  // FIX #1: HARD SPREAD — if within AoE blast of ally, ONLY spread
  // This overrides everything except zone escape and ability firing
  // ══════════════════════════════════════════════════
  if (inAoEDanger && !isKiter) {
    // Still fire ability if we can (doesn't require movement)
    if (canAbility && targetDist <= ABL_RANGE) {
      const lead = leadPosition(target, 2);
      if (alliesInBlast(lead) === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    // Still melee if in range
    if (canAttack && targetDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: target.id };
    }
    if (canAttack && nearestDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }
    // HARD SPREAD: move purely away from closest ally
    const sd = spreadDir();
    // Bias slightly toward target so we don't just flee randomly
    return safeMove({
      x: sd.x * 0.8 + (target.position.x - self.position.x) * 0.2,
      y: sd.y * 0.8 + (target.position.y - self.position.y) * 0.2,
    });
  }

  // ══════════════════════════════════════════════════
  // KITER BOT (#4)
  // FIX #2: Ally-avoidance + pure retreat when enemies close
  // ══════════════════════════════════════════════════
  if (isKiter) {
    if (canAbility) {
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
      if (bestPos) { cd.abl = tick; return { type: 'ability', targetPosition: bestPos }; }
      if (targetDist <= ABL_RANGE) {
        const lead = leadPosition(target, 2);
        if (alliesInBlast(lead) === 0) { cd.abl = tick; return { type: 'ability', targetPosition: lead }; }
      }
    }

    // Kiter melee fallback: swing if enemy is in range and ability on CD
    if (!canAbility && canAttack && nearestDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }

    // Count nearby enemies for danger assessment
    const nearbyEnemies = enemies.filter(e => dist(self, e) < 500).length;
    const dangerThreshold = nearbyEnemies >= 2 ? 400 : 300;
    const tooCloseEnemy = nearestDist < dangerThreshold;
    const tooFarEnemy = nearestDist > 470;  // Stop closing earlier (was 500)
    const tooCloseAlly = allyDist < SOFT_SPREAD;

    if (tooCloseEnemy) {
      // FIX: Pure retreat from enemy — NO zone blend (was 60/40, now 100% away)
      let retreatDir = {
        x: self.position.x - nearestEnemy.position.x,
        y: self.position.y - nearestEnemy.position.y,
      };
      // Only add zone pull if actually near zone edge
      if (nearZoneEdge) {
        retreatDir.x = retreatDir.x * 0.5 + (zx - self.position.x) * 0.5;
        retreatDir.y = retreatDir.y * 0.5 + (zy - self.position.y) * 0.5;
      }
      // FIX: Also move away from ally if too close
      if (tooCloseAlly) {
        const sd = spreadDir();
        retreatDir.x = retreatDir.x * 0.7 + sd.x * 0.3;
        retreatDir.y = retreatDir.y * 0.7 + sd.y * 0.3;
      }
      return safeMove(retreatDir);
    }

    if (tooFarEnemy) {
      let closeDir = dirTo(self, target);
      // FIX: Stay away from allies while closing
      if (tooCloseAlly) {
        const sd = spreadDir();
        closeDir.x = closeDir.x * 0.6 + sd.x * 0.4;
        closeDir.y = closeDir.y * 0.6 + sd.y * 0.4;
      }
      return safeMove(closeDir);
    }

    // At ideal range: strafe, but maintain ally distance
    const strafeAngle = Math.atan2(
      target.position.y - self.position.y,
      target.position.x - self.position.x
    ) + Math.PI / 2;
    let strafeDir = {
      x: Math.cos(strafeAngle) * 0.6 + (zx - self.position.x) * 0.02,
      y: Math.sin(strafeAngle) * 0.6 + (zy - self.position.y) * 0.02,
    };
    if (tooCloseAlly) {
      const sd = spreadDir();
      strafeDir.x = strafeDir.x * 0.6 + sd.x * 0.4;
      strafeDir.y = strafeDir.y * 0.6 + sd.y * 0.4;
    }
    return safeMove(strafeDir);
  }

  // ══════════════════════════════════════════════════
  // ASSAULT BOTS (#0-3)
  // ══════════════════════════════════════════════════

  // ── ABILITY ──
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
    if (bestPos && bestScore >= 4) { cd.abl = tick; return { type: 'ability', targetPosition: bestPos }; }
    if (targetDist <= ABL_RANGE) {
      const lead = leadPosition(target, 2);
      if (alliesInBlast(lead) === 0) { cd.abl = tick; return { type: 'ability', targetPosition: lead }; }
    }
    if (nearestDist <= ABL_RANGE && targetDist > ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      if (alliesInBlast(lead) === 0) { cd.abl = tick; return { type: 'ability', targetPosition: lead }; }
    }
  }

  // ── FIX #3: ZONE-PRIORITY RETREAT for low HP ──
  if (criticalHP) {
    if (nearZoneEdge || distToCenter > zr - 100) {
      // Zone is the priority — move toward center (80% zone, 20% away from enemy)
      return safeMove({
        x: (zx - self.position.x) * 0.8 + (self.position.x - nearestEnemy.position.x) * 0.2,
        y: (zy - self.position.y) * 0.8 + (self.position.y - nearestEnemy.position.y) * 0.2,
      });
    }
    if (allies.length > 0) {
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
  }

  // ── MELEE ──
  if (canAttack && targetDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: target.id }; }
  if (canAttack && nearestDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: nearestEnemy.id }; }

  // ── FIX #4: ENDGAME PURSUIT — chase last enemies, don't idle ──
  if (enemies.length <= 2 && (lateGame || allies.length === 0)) {
    // Aggressive chase with zone awareness and spread
    let chaseDir = dirTo(self, nearestEnemy);
    if (nearZoneEdge) {
      chaseDir.x = chaseDir.x * 0.6 + (zx - self.position.x) * 0.4;
      chaseDir.y = chaseDir.y * 0.6 + (zy - self.position.y) * 0.4;
    }
    if (allyDist < SOFT_SPREAD) {
      const sd = spreadDir();
      chaseDir.x = chaseDir.x * 0.7 + sd.x * 0.3;
      chaseDir.y = chaseDir.y * 0.7 + sd.y * 0.3;
    }
    return safeMove(chaseDir);
  }

  // ── FIX #5: ANTI-IDLE — if stuck for 10+ ticks, force move toward zone center ──
  if (_s.idleTicks[input.selfId] >= 10) {
    _s.idleTicks[input.selfId] = 0;
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // ── MOVEMENT ──

  // Low HP: retreat toward allies with zone awareness
  if (lowHP && allies.length > 0) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    return safeMove({
      x: (nearestAlly.position.x - self.position.x) * 0.4 +
         (self.position.x - nearestEnemy.position.x) * 0.3 +
         (zx - self.position.x) * 0.3,
      y: (nearestAlly.position.y - self.position.y) * 0.4 +
         (self.position.y - nearestEnemy.position.y) * 0.3 +
         (zy - self.position.y) * 0.3,
    });
  }

  // Isolated bot: move toward allies
  if (isolated && nearestDist > ATK_RANGE) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    return safeMove({
      x: (nearestAlly.position.x - self.position.x) * 0.7 + (self.position.x - nearestEnemy.position.x) * 0.3,
      y: (nearestAlly.position.y - self.position.y) * 0.7 + (self.position.y - nearestEnemy.position.y) * 0.3,
    });
  }

  // Close to target with soft spread
  if (targetDist > ATK_RANGE) {
    let moveDir = dirTo(self, target);

    // Soft spread: blend away from ally when within 200u
    if (allyDist < SOFT_SPREAD) {
      const sd = spreadDir();
      const spreadWeight = allyDist < HARD_SPREAD ? 0.8 : 0.5;
      moveDir.x = moveDir.x * (1 - spreadWeight) + sd.x * spreadWeight;
      moveDir.y = moveDir.y * (1 - spreadWeight) + sd.y * spreadWeight;
    }

    if (behind && distToTeam > 350) {
      moveDir.x = moveDir.x * 0.6 + (teamCenter.x - self.position.x) * 0.4;
      moveDir.y = moveDir.y * 0.6 + (teamCenter.y - self.position.y) * 0.4;
    }

    if (nearZoneEdge) {
      moveDir.x = moveDir.x * 0.5 + (zx - self.position.x) * 0.5;
      moveDir.y = moveDir.y * 0.5 + (zy - self.position.y) * 0.5;
    }

    return safeMove(moveDir);
  }

  // In melee range, on cooldown: orbit + spread
  const angle = Math.atan2(target.position.y - self.position.y, target.position.x - self.position.x);
  const orbitDir = (input.botNumber % 2 === 0) ? 1.2 : -1.2;
  const toTarget = dirTo(self, target);
  const mag = Math.hypot(toTarget.x, toTarget.y) || 1;

  let orbitMove = {
    x: Math.cos(angle + orbitDir) * 0.4 + (toTarget.x / mag) * 0.6,
    y: Math.sin(angle + orbitDir) * 0.4 + (toTarget.y / mag) * 0.6,
  };

  if (allyDist < SOFT_SPREAD) {
    const sd = spreadDir();
    const spreadWeight = allyDist < HARD_SPREAD ? 0.8 : 0.4;
    orbitMove.x = orbitMove.x * (1 - spreadWeight) + sd.x * spreadWeight;
    orbitMove.y = orbitMove.y * (1 - spreadWeight) + sd.y * spreadWeight;
  }

  return safeMove(orbitMove);
}
