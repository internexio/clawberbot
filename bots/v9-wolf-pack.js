/**
 * v9 Wolf Pack — Rally fix + endgame pursuit convergence
 *
 * v8 went 96W-4L (96%), first ever WIN vs hbfreed-opus.
 * Two remaining issues identified from replay analysis:
 *
 * FIX 1: Rally fight-back threshold
 *   - v8 rally refused melee unless enemy within 106u
 *   - Velocity-Comet kited at 200-300u, hitting us while we couldn't fight back
 *   - Pairs of bots (1 ally within 300u) never met the >=2 threshold
 *   - Fix: fight back if enemy within melee range OR if taking damage (HP < 100)
 *   - Fix: lower pack threshold to 1 ally within 300u (pairs can fight)
 *
 * FIX 2: Endgame pursuit convergence
 *   - 5v1 throw: bots chased independently, 3 bots 900u+ behind
 *   - Lone enemy picked off our isolated chasers one by one
 *   - Fix: stragglers (>400u from enemy, 2+ allies closer) converge to the fight
 */

if (typeof _s === 'undefined') {
  var _s = {
    target: null,
    targetScore: 999,
    cooldowns: {},
    prevPos: {},
    killsUs: 0,
    killsThem: 0,
    idleTicks: {},
    enemyPairs: [],
    pairTick: -1,
  };
}

function update(input) {
  const ATK_RANGE = 200;
  const ATK_CD = 5;
  const ABL_RANGE = 500;
  const ABL_RADIUS = 150;
  const ABL_CD = 30;
  const ZONE_BUFFER = 180;
  const HARD_SPREAD = 80;     // was 155 — tighter pack
  const SOFT_SPREAD = 120;    // was 200 — tighter pack
  const SPEED = 12;
  const CONVERGE_RADIUS = 250; // bots farther than this from centroid converge

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

  function safeMove(dir) {
    const mag = Math.hypot(dir.x, dir.y);
    if (mag === 0) { _s.idleTicks[input.selfId]++; return { type: 'idle' }; }
    const nx = dir.x / mag;
    const ny = dir.y / mag;
    const dx = self.position.x + nx * SPEED;
    const dy = self.position.y + ny * SPEED;

    if (isPassable(dx, dy)) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: nx, y: ny } }; }
    if (isPassable(dx, self.position.y) && Math.abs(nx) > 0.1) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: nx > 0 ? 1 : -1, y: 0 } }; }
    if (isPassable(self.position.x, dy) && Math.abs(ny) > 0.1) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: 0, y: ny > 0 ? 1 : -1 } }; }
    if (isPassable(self.position.x + ny * SPEED, self.position.y - nx * SPEED)) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: ny, y: -nx } }; }
    if (isPassable(self.position.x - ny * SPEED, self.position.y + nx * SPEED)) { _s.idleTicks[input.selfId] = 0; return { type: 'move', direction: { x: -ny, y: nx } }; }
    const dirs = [[1,0],[0,1],[-1,0],[0,-1],[0.71,0.71],[-0.71,0.71],[0.71,-0.71],[-0.71,-0.71]];
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

  // HARD ZONE: if outside, immediately return
  if (distToCenter > zr) {
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }
  const nearZoneEdge = distToCenter > zr - ZONE_BUFFER;
  const lateGame = tick > 600 || zoneSmall();

  // ── Nearest enemy (needed for zone-edge ability fire) ──
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  function alliesInBlast(pos) {
    return allies.filter(a =>
      Math.hypot(a.position.x - pos.x, a.position.y - pos.y) <= ABL_RADIUS
    ).length;
  }

  // ── HARD ZONE RULE: within 50u of edge, fire ability if possible then retreat ──
  if (distToCenter > zr - 50) {
    if (canAbility && !criticalHP && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      if (alliesInBlast(lead) === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // ── Closest ally + hard spread check ──
  const closestAlly = allies.length > 0 ? allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b) : null;
  const allyDist = closestAlly ? dist(self, closestAlly) : 9999;
  const inAoEDanger = allyDist < HARD_SPREAD;

  // ── Team info ──
  const teamCenter = {
    x: allTeam.reduce((s, b) => s + b.position.x, 0) / allTeam.length,
    y: allTeam.reduce((s, b) => s + b.position.y, 0) / allTeam.length,
  };
  const distToTeam = Math.hypot(self.position.x - teamCenter.x, self.position.y - teamCenter.y);

  const nearbyAllies300 = allies.filter(a => dist(self, a) < 300).length;
  const nearbyAllies = allies.filter(a => dist(self, a) < 350).length;
  const isolated = nearbyAllies === 0 && allies.length > 0;
  const packFormed = nearbyAllies300 >= 1; // 2+ bots within 300u (self + 1 ally = pair can fight)
  const beingAttacked = self.health < 100; // proxy: if we've taken damage, we're under fire

  // ══════════════════════════════════════════════════
  // RALLY PHASE — converge before engaging
  // If no ally within 300u, rush zone center.
  // Fight back if being attacked (HP < 100) or enemy in melee range.
  // Fire abilities opportunistically while converging (500u range).
  // ══════════════════════════════════════════════════
  if (!packFormed && allies.length > 0 && allTeam.length >= 4) {
    // Fire ability while converging — 500u range means we can shoot while running
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      if (alliesInBlast(lead) === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    // Fight back if being attacked or enemy in melee range — don't be a punching bag
    if (canAttack && nearestDist <= ATK_RANGE && beingAttacked) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }
    // Melee if enemy literally on top (can't escape at same speed)
    if (canAttack && nearestDist <= ATK_RANGE * 0.53) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }
    // Rush toward zone center (rally point) — heavy convergence, slight centroid bias
    const rallyDir = {
      x: (zx - self.position.x) * 0.79 + (teamCenter.x - self.position.x) * 0.21,
      y: (zy - self.position.y) * 0.79 + (teamCenter.y - self.position.y) * 0.21,
    };
    return safeMove(rallyDir);
  }

  function spreadDir() {
    if (!closestAlly) return { x: 0, y: 0 };
    return { x: self.position.x - closestAlly.position.x, y: self.position.y - closestAlly.position.y };
  }

  // ══════════════════════════════════════════════════
  // PAIR DETECTION — find enemy pairs <300u apart
  // ══════════════════════════════════════════════════
  if (tick !== _s.pairTick) {
    _s.enemyPairs = [];
    const paired = new Set();
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        const d = dist(enemies[i], enemies[j]);
        if (d < 300 && !paired.has(enemies[i].id) && !paired.has(enemies[j].id)) {
          _s.enemyPairs.push({
            a: enemies[i],
            b: enemies[j],
            dist: d,
            midpoint: {
              x: (enemies[i].position.x + enemies[j].position.x) / 2,
              y: (enemies[i].position.y + enemies[j].position.y) / 2,
            }
          });
          paired.add(enemies[i].id);
          paired.add(enemies[j].id);
        }
      }
    }
    _s.pairTick = tick;
  }

  // ══════════════════════════════════════════════════
  // HP-WEIGHTED TARGET SELECTION — finish wounded first
  // ══════════════════════════════════════════════════
  function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 400).length + 1;
    const nearEdge = Math.hypot(e.position.x - zx, e.position.y - zy) > zr - 100;
    // HP-weighted: clean formula — (100-health) is the priority, no self-cancellation
    const hpPriority = d < 300 ? (100 - e.health) * 3 : (100 - e.health) * 1;
    // Distance penalty: hard cap at 400u to prevent cross-map chasing
    const distPenalty = d > 400 ? 200 : d * 0.1;
    // Pair bonus for AoE splash value
    const inPair = _s.enemyPairs.some(p => p.a.id === e.id || p.b.id === e.id);
    const pairBonus = inPair ? 20 : 0;
    // Lower score = higher priority
    return -hpPriority - alliesNear * 25 + distPenalty - (nearEdge ? 30 : 0) - pairBonus;
  }

  const aliveTeamIds = [input.selfId, ...allies.map(a => a.id)].sort();
  const isLeader = aliveTeamIds[0] === input.selfId;

  let target = null;
  if (_s.target) target = enemies.find(e => e.id === _s.target);

  // Re-evaluate every 10 ticks (was 20 — faster reaction to wounded enemies)
  if (isLeader || !target || tick % 10 === 0) {
    const scored = enemies.map(e => ({ enemy: e, score: scoreEnemy(e) }));
    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];
    const currentScore = target ? scoreEnemy(target) : 999;
    if (!target || best.score < currentScore - 10) {
      target = best.enemy;
      _s.target = target.id;
      _s.targetScore = best.score;
    }
  }
  if (!target) target = nearestEnemy;

  const targetDist = dist(self, target);

  // ══════════════════════════════════════════════════
  // ABILITY-FIRST — fire ability ASAP, with pair targeting
  // ══════════════════════════════════════════════════
  if (canAbility && !criticalHP) {
    let bestPos = null;
    let bestScore = -999;

    // Check pair midpoints first — highest value AoE targets
    for (const pair of _s.enemyPairs) {
      const mid = pair.midpoint;
      const d = Math.hypot(mid.x - self.position.x, mid.y - self.position.y);
      if (d > ABL_RANGE) continue;
      const hitsE = enemies.filter(e =>
        Math.hypot(e.position.x - mid.x, e.position.y - mid.y) <= ABL_RADIUS
      ).length;
      const hitsA = alliesInBlast(mid);
      const score = hitsE * 3 - hitsA * 5;
      if (score > bestScore && hitsE >= 2 && hitsA === 0) {
        bestScore = score;
        bestPos = mid;
      }
    }

    // Then check individual enemies
    for (const e of enemies) {
      const d = Math.hypot(e.position.x - self.position.x, e.position.y - self.position.y);
      if (d > ABL_RANGE) continue;
      const lead = leadPosition(e, 2);
      const hitsE = enemies.filter(e2 =>
        Math.hypot(e2.position.x - lead.x, e2.position.y - lead.y) <= ABL_RADIUS
      ).length;
      const hitsA = alliesInBlast(lead);
      const score = hitsE * 3 - hitsA * 5;
      if (score > bestScore && hitsE > 0 && hitsA === 0) {
        bestScore = score;
        bestPos = lead;
      }
    }

    if (bestPos && bestScore >= 1) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: bestPos };
    }
    // Fallback: fire at focus target if in range
    if (targetDist <= ABL_RANGE) {
      const lead = leadPosition(target, 2);
      if (alliesInBlast(lead) === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    // Fallback: fire at nearest enemy
    if (nearestDist <= ABL_RANGE && targetDist > ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      if (alliesInBlast(lead) === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
  }

  // ══════════════════════════════════════════════════
  // SOFT SPREAD — if too close to ally, bias away while still fighting
  // (much less aggressive than v6's hard spread block)
  // ══════════════════════════════════════════════════
  if (inAoEDanger) {
    if (canAttack && targetDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: target.id };
    }
    if (canAttack && nearestDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }
    const sd = spreadDir();
    return safeMove({
      x: sd.x * 0.53 + (target.position.x - self.position.x) * 0.47,
      y: sd.y * 0.53 + (target.position.y - self.position.y) * 0.47,
    });
  }

  // ══════════════════════════════════════════════════
  // ALL 5 BOTS: MELEE ASSAULT (no kiter)
  // ══════════════════════════════════════════════════

  // ── ZONE-PRIORITY RETREAT for low HP ──
  if (criticalHP) {
    if (nearZoneEdge || distToCenter > zr - 100) {
      return safeMove({
        x: (zx - self.position.x) * 0.83 + (self.position.x - nearestEnemy.position.x) * 0.17,
        y: (zy - self.position.y) * 0.83 + (self.position.y - nearestEnemy.position.y) * 0.17,
      });
    }
    if (allies.length > 0) {
      const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
      return safeMove({
        x: (nearestAlly.position.x - self.position.x) * 0.47 +
           (self.position.x - nearestEnemy.position.x) * 0.31 +
           (zx - self.position.x) * 0.22,
        y: (nearestAlly.position.y - self.position.y) * 0.47 +
           (self.position.y - nearestEnemy.position.y) * 0.31 +
           (zy - self.position.y) * 0.22,
      });
    }
  }

  // ── MELEE ──
  if (canAttack && targetDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: target.id }; }
  if (canAttack && nearestDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: nearestEnemy.id }; }

  // ── ENDGAME PURSUIT (with pack convergence) ──
  if (enemies.length <= 2 && (lateGame || allies.length === 0)) {
    const myDistToEnemy = dist(self, nearestEnemy);
    const closerAllies = allies.filter(a => dist(a, nearestEnemy) < myDistToEnemy);

    // Straggler: 2+ allies are closer to enemy AND I'm far — converge to the fight
    if (closerAllies.length >= 2 && myDistToEnemy > 400) {
      const nearFighter = closerAllies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
      let convergeDir = dirTo(self, nearFighter);
      if (nearZoneEdge) {
        convergeDir.x = convergeDir.x * 0.59 + (zx - self.position.x) * 0.41;
        convergeDir.y = convergeDir.y * 0.59 + (zy - self.position.y) * 0.41;
      }
      return safeMove(convergeDir);
    }
    // Chaser: pursue directly
    let chaseDir = dirTo(self, nearestEnemy);
    if (nearZoneEdge) {
      chaseDir.x = chaseDir.x * 0.59 + (zx - self.position.x) * 0.41;
      chaseDir.y = chaseDir.y * 0.59 + (zy - self.position.y) * 0.41;
    }
    return safeMove(chaseDir);
  }

  // ── ANTI-IDLE ──
  if (_s.idleTicks[input.selfId] >= 10) {
    _s.idleTicks[input.selfId] = 0;
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // ══════════════════════════════════════════════════
  // MOVEMENT — converge to pack, then attack as unit
  // ══════════════════════════════════════════════════

  // Low HP retreat with zone awareness
  if (lowHP && allies.length > 0) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    return safeMove({
      x: (nearestAlly.position.x - self.position.x) * 0.43 +
         (self.position.x - nearestEnemy.position.x) * 0.29 +
         (zx - self.position.x) * 0.28,
      y: (nearestAlly.position.y - self.position.y) * 0.43 +
         (self.position.y - nearestEnemy.position.y) * 0.29 +
         (zy - self.position.y) * 0.28,
    });
  }

  // Isolated or too far from team: converge first
  if ((isolated || distToTeam > CONVERGE_RADIUS) && nearestDist > ATK_RANGE) {
    return safeMove({
      x: (teamCenter.x - self.position.x) * 0.61 + (target.position.x - self.position.x) * 0.39,
      y: (teamCenter.y - self.position.y) * 0.61 + (target.position.y - self.position.y) * 0.39,
    });
  }

  // Move toward target with light centroid bias (stay together)
  if (targetDist > ATK_RANGE) {
    let moveDir = dirTo(self, target);

    // Gentle centroid pull — keeps pack tight without hard-locking
    if (distToTeam > CONVERGE_RADIUS * 0.61) {
      moveDir.x = moveDir.x * 0.71 + (teamCenter.x - self.position.x) * 0.29;
      moveDir.y = moveDir.y * 0.71 + (teamCenter.y - self.position.y) * 0.29;
    }

    // Spread only if dangerously close
    if (allyDist < SOFT_SPREAD) {
      const sd = spreadDir();
      const spreadWeight = allyDist < HARD_SPREAD ? 0.37 : 0.19;
      moveDir.x = moveDir.x * (1 - spreadWeight) + sd.x * spreadWeight;
      moveDir.y = moveDir.y * (1 - spreadWeight) + sd.y * spreadWeight;
    }

    if (nearZoneEdge) {
      moveDir.x = moveDir.x * 0.53 + (zx - self.position.x) * 0.47;
      moveDir.y = moveDir.y * 0.53 + (zy - self.position.y) * 0.47;
    }

    return safeMove(moveDir);
  }

  // In melee range, on cooldown: tight orbit with angular spread per bot
  const angle = Math.atan2(target.position.y - self.position.y, target.position.x - self.position.x);
  // Spread bots around target using prime-based offsets
  const orbitOffset = (input.botNumber * 1.31) - 2.62;
  const toTarget = dirTo(self, target);
  const mag = Math.hypot(toTarget.x, toTarget.y) || 1;

  let orbitMove = {
    x: Math.cos(angle + orbitOffset) * 0.29 + (toTarget.x / mag) * 0.71,
    y: Math.sin(angle + orbitOffset) * 0.29 + (toTarget.y / mag) * 0.71,
  };

  // Light spread only if very close
  if (allyDist < HARD_SPREAD) {
    const sd = spreadDir();
    orbitMove.x = orbitMove.x * 0.71 + sd.x * 0.29;
    orbitMove.y = orbitMove.y * 0.71 + sd.y * 0.29;
  }

  return safeMove(orbitMove);
}
