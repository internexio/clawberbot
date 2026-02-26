/**
 * v6 Pair Hunter — Counter hbfreed-opus
 *
 * v5 went 99W-1L (99%). vs hbfreed-opus: 3W-3L across versions.
 * Analysis of 6 replays revealed hbfreed's strategy:
 *   - Runs 2 tight pairs (~180u apart) + 1 roamer
 *   - Fires ability at tick 1 (we were 17 ticks late in v3)
 *   - Out-abilities us 2:1 in losses (25 hits vs 13)
 *   - Zone kills cost us 2 games we were winning
 *
 * v6 changes (post kf-critic + kf-strategist review):
 *   1. PAIR DETECTION: detect enemy pairs <300u, AoE their midpoint
 *   2. ABILITY-FIRST: fire ability ASAP every cooldown (skip when criticalHP)
 *   3. SINGLE KITER: bot 4 only (dual kiters cost 25% DPS for marginal hbfreed gain)
 *   4. HARD ZONE: 50u emergency zone + fire ability before retreating
 *   5. KITER MELEE GATE: only swing at ≤10HP enemies (prevents melee trap)
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
    enemyPairs: [],   // Detected enemy pairs
    pairTick: -1,     // When pairs were last computed
  };
}

function update(input) {
  const ATK_RANGE = 200;
  const ATK_CD = 5;
  const ABL_RANGE = 500;
  const ABL_RADIUS = 150;
  const ABL_CD = 30;
  const ZONE_BUFFER = 180;    // Increased from 150 — never get caught
  const HARD_SPREAD = 155;
  const SOFT_SPREAD = 200;
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

  // HARD ZONE: if outside, immediately return
  if (distToCenter > zr) {
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }
  const nearZoneEdge = distToCenter > zr - ZONE_BUFFER;
  const lateGame = tick > 600 || zoneSmall();

  // ── HARD ZONE RULE: within 50u of edge, fire ability if possible then retreat ──
  if (distToCenter > zr - 50) {
    // Still fire ability — it's instant, doesn't require staying
    if (canAbility && !criticalHP && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      if (alliesInBlast(lead) === 0) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // ── Nearest enemy ──
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);

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

  const nearbyAllies = allies.filter(a => dist(self, a) < 350).length;
  const isolated = nearbyAllies === 0 && allies.length > 0;

  // Single kiter (bot 4) — dual kiters cost 25% melee DPS for only ~5% matchup gain
  const isKiter = input.botNumber === 4;

  // ══════════════════════════════════════════════════
  // NEW: PAIR DETECTION — find enemy pairs <300u apart
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

  // ── Target selection with pair awareness ──
  function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 400).length + 1;
    const nearEdge = Math.hypot(e.position.x - zx, e.position.y - zy) > zr - 100;
    const lowHP = e.health <= 30 ? -50 : 0;
    // NEW: bonus for enemies in detected pairs (splash value)
    const inPair = _s.enemyPairs.some(p => p.a.id === e.id || p.b.id === e.id);
    const pairBonus = inPair ? -20 : 0;
    return e.health + lowHP + pairBonus - alliesNear * 25 + d * 0.03 - (nearEdge ? 30 : 0);
  }

  const aliveTeamIds = [input.selfId, ...allies.map(a => a.id)].sort();
  const isLeader = aliveTeamIds[0] === input.selfId;

  let target = null;
  if (_s.target) target = enemies.find(e => e.id === _s.target);

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
  if (!target) target = nearestEnemy;

  const targetDist = dist(self, target);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  function alliesInBlast(pos) {
    return allies.filter(a =>
      Math.hypot(a.position.x - pos.x, a.position.y - pos.y) <= ABL_RADIUS
    ).length;
  }

  function spreadDir() {
    if (!closestAlly) return { x: 0, y: 0 };
    return { x: self.position.x - closestAlly.position.x, y: self.position.y - closestAlly.position.y };
  }

  // ══════════════════════════════════════════════════
  // NEW: ABILITY-FIRST — fire ability ASAP, with pair targeting
  // This runs before ALL other logic (except zone escape)
  // ══════════════════════════════════════════════════
  if (canAbility && !criticalHP) {
    let bestPos = null;
    let bestScore = -999;

    // Check pair midpoints first — highest value AoE targets
    // Use current midpoint (no lead) — 150u blast radius covers 180u-apart pairs
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

    // NEW: Lower threshold — fire at single targets too (was >= 4, now >= 1)
    // This ensures we fire ability every 30 ticks, matching hbfreed's rate
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
  // HARD SPREAD — if within AoE blast of ally, ONLY spread
  // ══════════════════════════════════════════════════
  if (inAoEDanger && !isKiter) {
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
      x: sd.x * 0.8 + (target.position.x - self.position.x) * 0.2,
      y: sd.y * 0.8 + (target.position.y - self.position.y) * 0.2,
    });
  }

  // ══════════════════════════════════════════════════
  // DUAL KITER BOTS (#3 and #4)
  // ══════════════════════════════════════════════════
  if (isKiter) {
    // Kiter melee: only if enemy is almost dead or kiter is cornered
    if (canAttack && nearestDist <= ATK_RANGE && (nearestEnemy.health <= 10 || nearZoneEdge)) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }

    const nearbyEnemies = enemies.filter(e => dist(self, e) < 500).length;
    const dangerThreshold = nearbyEnemies >= 2 ? 400 : 300;
    const tooCloseEnemy = nearestDist < dangerThreshold;
    const tooFarEnemy = nearestDist > 470;
    const tooCloseAlly = allyDist < SOFT_SPREAD;

    if (tooCloseEnemy) {
      let retreatDir = {
        x: self.position.x - nearestEnemy.position.x,
        y: self.position.y - nearestEnemy.position.y,
      };
      if (nearZoneEdge) {
        retreatDir.x = retreatDir.x * 0.5 + (zx - self.position.x) * 0.5;
        retreatDir.y = retreatDir.y * 0.5 + (zy - self.position.y) * 0.5;
      }
      if (tooCloseAlly) {
        const sd = spreadDir();
        retreatDir.x = retreatDir.x * 0.7 + sd.x * 0.3;
        retreatDir.y = retreatDir.y * 0.7 + sd.y * 0.3;
      }
      return safeMove(retreatDir);
    }

    if (tooFarEnemy) {
      let closeDir = dirTo(self, target);
      if (tooCloseAlly) {
        const sd = spreadDir();
        closeDir.x = closeDir.x * 0.6 + sd.x * 0.4;
        closeDir.y = closeDir.y * 0.6 + sd.y * 0.4;
      }
      return safeMove(closeDir);
    }

    // Strafe at ideal range — alternate direction by bot number
    const strafeAngle = Math.atan2(
      target.position.y - self.position.y,
      target.position.x - self.position.x
    ) + (input.botNumber === 3 ? Math.PI / 2 : -Math.PI / 2);
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
  // ASSAULT BOTS (#0-2)
  // ══════════════════════════════════════════════════

  // ── ZONE-PRIORITY RETREAT for low HP ──
  if (criticalHP) {
    if (nearZoneEdge || distToCenter > zr - 100) {
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

  // ── ENDGAME PURSUIT ──
  if (enemies.length <= 2 && (lateGame || allies.length === 0)) {
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

  // ── ANTI-IDLE ──
  if (_s.idleTicks[input.selfId] >= 10) {
    _s.idleTicks[input.selfId] = 0;
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // ── MOVEMENT ──

  // Low HP retreat with zone awareness
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

  // Isolated: rejoin team
  if (isolated && nearestDist > ATK_RANGE) {
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    return safeMove({
      x: (nearestAlly.position.x - self.position.x) * 0.7 + (self.position.x - nearestEnemy.position.x) * 0.3,
      y: (nearestAlly.position.y - self.position.y) * 0.7 + (self.position.y - nearestEnemy.position.y) * 0.3,
    });
  }

  // Move toward target with spread
  if (targetDist > ATK_RANGE) {
    let moveDir = dirTo(self, target);

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
