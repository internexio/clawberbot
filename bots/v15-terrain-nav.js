/**
 * v15 Terrain Nav — obstacle-aware pathfinding + buddy system
 *
 * v15c: Distance recalibration from replay measurements (8 wins vs 8 losses).
 *   Key finding: wins have ~50% tighter ally spacing at every phase.
 *   - HARD_SPREAD: 80 → 60u (wins converge to 96u endgame, stop pushing apart)
 *   - SOFT_SPREAD: 120 → 100u (tighter pairs = more support)
 *   - CONVERGE_RADIUS: 250 → 200u (= ATK_RANGE, pack formed when ally in melee range)
 *   - "nearby" thresholds: 300 → 250u, 350 → 300u (measured support dist = 187u in wins)
 *   - isolated fight mode: 400 → 350u upper bound
 *   - alliesNear scoring: 400 → 300u (match actual support range)
 *
 * v15b: Prime timings + KF-Debugger fixes
 *   - Prime timings: target lock 17t, stuck detection 7t
 *   - Isolated bot fight mode: sprint at nearby enemy instead of freezing
 *   - Isolated ability: skip alliesInBlast when no ally nearby
 *
 * v15a: Terrain navigation layer
 *   - BFS obstacle distance field computed once on tick 0
 *   - 2.5-step lookahead steering in safeMove
 *   - Eliminates stuck/oscillation losses (oztenbot-type terrain traps)
 *
 * Kept from v14:
 *   - Buddy system (rally to nearest ally, not center)
 *   - Ability friendly-fire tolerance (alliesInBlast <= 1)
 *   - Rally threshold >= 3
 *   - All v12 fixes (terrain escape, fight-local-first)
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
    pursuitDist: {},
    pursuitTicks: {},
    zoneRetreating: {},
    lockedTarget: null,
    lockedSince: 0,
    stuckPos: {},
    stuckTicks: {},
    navGrid: null,
  };
}

function update(input) {
  const ATK_RANGE = 200;
  const ATK_CD = 5;
  const ABL_RANGE = 500;
  const ABL_RADIUS = 150;
  const ABL_CD = 30;
  const ZONE_BUFFER_ENTER = 180;
  const ZONE_BUFFER_EXIT = 100;
  const HARD_SPREAD = 60;    // was 80 — measured: wins converge to 96u, let them stack tighter
  const SOFT_SPREAD = 100;   // was 120 — measured: win support dist = 187u median
  const SPEED = 12;
  const CONVERGE_RADIUS = 200; // was 250 — = ATK_RANGE, ally in melee range = pack formed

  const self = input.bots.find(b => b.id === input.selfId);
  if (!self || !self.alive) return { type: 'idle' };

  const teamIds = new Set(input.teamBotIds);
  const allies = input.bots.filter(b => b.alive && teamIds.has(b.id) && b.id !== input.selfId);
  const allTeam = input.bots.filter(b => b.alive && teamIds.has(b.id));
  const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));
  const tick = input.tick;

  if (enemies.length === 0) return { type: 'idle' };

  // === TERRAIN NAVIGATION LAYER (v15) ===
  // BFS obstacle distance field — computed once on tick 0
  // obstDist[i] = tile distance to nearest obstacle (capped at 4)
  if (tick === 0 && !_s.navGrid && input.tiles) {
    const t = input.tiles;
    const W = t.width, H = t.height, total = W * H;
    const od = new Uint8Array(total);
    const q = [];
    for (let i = 0; i < total; i++) {
      if (t.passable[i]) { od[i] = 255; } else { od[i] = 0; q.push(i); }
    }
    let qi = 0;
    while (qi < q.length) {
      const idx = q[qi++];
      const cx = idx % W, cy = (idx - cx) / W;
      const nd = od[idx] + 1;
      if (nd > 4) continue;
      if (cx > 0 && od[idx - 1] > nd) { od[idx - 1] = nd; q.push(idx - 1); }
      if (cx < W - 1 && od[idx + 1] > nd) { od[idx + 1] = nd; q.push(idx + 1); }
      if (cy > 0 && od[idx - W] > nd) { od[idx - W] = nd; q.push(idx - W); }
      if (cy < H - 1 && od[idx + W] > nd) { od[idx + W] = nd; q.push(idx + W); }
    }
    _s.navGrid = { od, W, H, ts: t.tileSize };
  }

  // -- Cooldown tracking --
  if (!_s.cooldowns[input.selfId]) {
    _s.cooldowns[input.selfId] = { atk: -999, abl: -999 };
  }
  const cd = _s.cooldowns[input.selfId];
  const canAttack = tick - cd.atk >= ATK_CD;
  const canAbility = tick - cd.abl >= ABL_CD;

  // -- Idle tracking --
  if (!_s.idleTicks[input.selfId]) _s.idleTicks[input.selfId] = 0;

  // -- Match state --
  _s.killsUs = 5 - enemies.length;
  _s.killsThem = 5 - allTeam.length;

  // -- Helpers --
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

  // -- Velocity estimation --
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

  // -- Stuck detection (P0) --
  const sp = _s.stuckPos[input.selfId];
  if (sp && Math.hypot(self.position.x - sp.x, self.position.y - sp.y) < 20) {
    _s.stuckTicks[input.selfId] = (_s.stuckTicks[input.selfId] || 0) + 1;
  } else {
    _s.stuckTicks[input.selfId] = 0;
  }
  if (tick % 7 === 0) {
    _s.stuckPos[input.selfId] = { x: self.position.x, y: self.position.y };
  }
  const isStuck = _s.stuckTicks[input.selfId] >= 7;

  // -- Terrain --
  function isPassable(x, y) {
    const t = input.tiles;
    if (!t) return true;
    const tx = Math.floor(x / t.tileSize);
    const ty = Math.floor(y / t.tileSize);
    if (tx < 0 || tx >= t.width || ty < 0 || ty >= t.height) return false;
    return t.passable[ty * t.width + tx];
  }

  // v15: obstacle distance at world coordinates (0 = on obstacle, 4+ = safe)
  function obstDist(wx, wy) {
    if (!_s.navGrid) return 99;
    const { od, W, H, ts } = _s.navGrid;
    const tx = Math.floor(wx / ts), ty = Math.floor(wy / ts);
    if (tx < 0 || tx >= W || ty < 0 || ty >= H) return 0;
    return od[ty * W + tx];
  }

  function safeMove(dir) {
    const mag = Math.hypot(dir.x, dir.y);
    if (mag === 0) { _s.idleTicks[input.selfId]++; return { type: 'idle' }; }
    let nx = dir.x / mag;
    let ny = dir.y / mag;

    // v15: Terrain lookahead — steer around obstacles 2-3 steps ahead
    if (_s.navGrid) {
      const l1x = self.position.x + nx * SPEED;
      const l1y = self.position.y + ny * SPEED;
      const l2x = self.position.x + nx * SPEED * 2.5;
      const l2y = self.position.y + ny * SPEED * 2.5;
      if (!isPassable(l2x, l2y) || obstDist(l1x, l1y) <= 1) {
        const ba = Math.atan2(ny, nx);
        const offs = [0.4, -0.4, 0.8, -0.8, 1.2, -1.2];
        for (const off of offs) {
          const ax = Math.cos(ba + off), ay = Math.sin(ba + off);
          const t1x = self.position.x + ax * SPEED;
          const t1y = self.position.y + ay * SPEED;
          if (isPassable(t1x, t1y) && obstDist(t1x, t1y) >= 2) {
            nx = ax; ny = ay; break;
          }
        }
      }
    }

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
    // P0: 16-direction escape when stuck in terrain trap
    if (isStuck) {
      const escapeAngle = (tick * 1.37 + input.botNumber * 2.1) % (Math.PI * 2);
      for (let a = 0; a < 16; a++) {
        const angle = escapeAngle + (a * Math.PI / 8);
        const ex = Math.cos(angle), ey = Math.sin(angle);
        if (isPassable(self.position.x + ex * SPEED, self.position.y + ey * SPEED)) {
          _s.stuckTicks[input.selfId] = 0;
          return { type: 'move', direction: { x: ex, y: ey } };
        }
      }
    }
    _s.idleTicks[input.selfId]++;
    return { type: 'idle' };
  }

  // -- Zone --
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
  // Zone hysteresis: start retreating at ENTER buffer, stop at EXIT buffer
  if (!_s.zoneRetreating[input.selfId]) _s.zoneRetreating[input.selfId] = false;
  if (distToCenter > zr - ZONE_BUFFER_EXIT) {
    _s.zoneRetreating[input.selfId] = true;
  }
  if (distToCenter < zr - ZONE_BUFFER_ENTER) {
    _s.zoneRetreating[input.selfId] = false;
  }
  const nearZoneEdge = _s.zoneRetreating[input.selfId];
  const lateGame = tick > 600 || zoneSmall();

  // -- Nearest enemy (needed for zone-edge ability fire) --
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  function alliesInBlast(pos) {
    return allies.filter(a =>
      Math.hypot(a.position.x - pos.x, a.position.y - pos.y) <= ABL_RADIUS
    ).length;
  }

  // v13: Fire ability even while stuck — accept 1 ally in blast
  if (isStuck && canAbility && nearestDist <= ABL_RANGE) {
    const lead = leadPosition(nearestEnemy, 2);
    if (alliesInBlast(lead) <= 1) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: lead };
    }
  }

  // -- HARD ZONE RULE: within 50u of edge, fire ability if possible then retreat --
  if (distToCenter > zr - 50) {
    if (canAbility && !criticalHP && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      if (alliesInBlast(lead) <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // -- Closest ally + hard spread check --
  const closestAlly = allies.length > 0 ? allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b) : null;
  const allyDist = closestAlly ? dist(self, closestAlly) : 9999;
  const inAoEDanger = allyDist < HARD_SPREAD;

  // -- Team info --
  const teamCenter = {
    x: allTeam.reduce((s, b) => s + b.position.x, 0) / allTeam.length,
    y: allTeam.reduce((s, b) => s + b.position.y, 0) / allTeam.length,
  };
  const distToTeam = Math.hypot(self.position.x - teamCenter.x, self.position.y - teamCenter.y);

  const nearbyAllies250 = allies.filter(a => dist(self, a) < 250).length;  // was 300
  const nearbyAllies = allies.filter(a => dist(self, a) < 300).length;    // was 350
  const isolated = nearbyAllies === 0 && allies.length > 0;
  const packFormed = nearbyAllies250 >= 1;
  const beingAttacked = self.health < 100;

  // ======================================================
  // BUDDY SYSTEM — converge to nearest ally, not center
  // v14: Creates 2v1 pairs in 10-15 ticks vs 30-40 tick rally
  // Counters hbfreed's distributed 1-per-target lock-on
  // ======================================================
  if (!packFormed && allies.length > 0 && allTeam.length >= 3 && nearestDist >= 300) {
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      if (alliesInBlast(lead) <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    if (canAttack && nearestDist <= ATK_RANGE && beingAttacked) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }
    if (canAttack && nearestDist <= ATK_RANGE * 0.53) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }
    // v14: Sprint to nearest ally (buddy up) instead of team center
    // Zone safety only when near edge — otherwise pure buddy convergence
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    const zoneW = nearZoneEdge ? 0.35 : 0.15;
    const buddyW = 1.0 - zoneW;
    const rallyDir = {
      x: (nearestAlly.position.x - self.position.x) * buddyW + (zx - self.position.x) * zoneW,
      y: (nearestAlly.position.y - self.position.y) * buddyW + (zy - self.position.y) * zoneW,
    };
    return safeMove(rallyDir);
  }

  function spreadDir() {
    if (!closestAlly) return { x: 0, y: 0 };
    return { x: self.position.x - closestAlly.position.x, y: self.position.y - closestAlly.position.y };
  }

  // ======================================================
  // PAIR DETECTION — find enemy pairs <300u apart
  // ======================================================
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

  // ======================================================
  // HP-WEIGHTED TARGET SELECTION — finish wounded first
  // ======================================================
  function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 300).length + 1;  // was 400
    const nearEdge = Math.hypot(e.position.x - zx, e.position.y - zy) > zr - 100;
    const hpPriority = d < 300 ? (100 - e.health) * 3 : (100 - e.health) * 1;
    const distPenalty = d > 300 ? 200 : d * 0.1;  // was 400
    const inPair = _s.enemyPairs.some(p => p.a.id === e.id || p.b.id === e.id);
    const pairBonus = inPair ? 20 : 0;
    return -hpPriority - alliesNear * 25 + distPenalty - (nearEdge ? 30 : 0) - pairBonus;
  }

  const aliveTeamIds = [input.selfId, ...allies.map(a => a.id)].sort();
  const isLeader = aliveTeamIds[0] === input.selfId;

  let target = null;
  if (_s.lockedTarget) target = enemies.find(e => e.id === _s.lockedTarget);

  // Stricter target lock: only leader re-evaluates every 17 ticks (prime).
  const targetGone = !target;
  const lockExpired = tick - _s.lockedSince >= 17;

  if (targetGone || (isLeader && lockExpired)) {
    const scored = enemies.map(e => ({ enemy: e, score: scoreEnemy(e) }));
    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];
    const currentScore = target ? scoreEnemy(target) : 999;
    if (!target || best.score < currentScore - 20) {
      target = best.enemy;
      _s.lockedTarget = target.id;
      _s.lockedSince = tick;
    }
  }
  // If locked target is >500u from this bot, use nearest locally
  if (target && dist(self, target) > 500) {
    target = nearestEnemy;
  }
  if (!target) target = nearestEnemy;

  const targetDist = dist(self, target);

  // ======================================================
  // ABILITY-FIRST — fire ability ASAP, with pair targeting
  // v13: Accept 1 ally in blast for single-target shots
  // ======================================================
  if (canAbility && !criticalHP) {
    let bestPos = null;
    let bestScore = -999;

    // Pair targeting: aim at midpoint between enemy pairs (strict — no friendly fire)
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

    // v13: Single-target fallback — accept 1 ally in blast (was === 0)
    if (!bestPos || bestScore < 1) {
      if (nearestDist <= ABL_RANGE) {
        const lead = leadPosition(nearestEnemy, 2);
        if (alliesInBlast(lead) <= 1) {
          bestPos = lead;
          bestScore = 1;
        }
      }
    }

    if (bestPos && bestScore >= 1) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: bestPos };
    }
  }

  // ======================================================
  // SOFT SPREAD — if too close to ally, bias away while still fighting
  // ======================================================
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

  // ======================================================
  // ANTI-DISTRIBUTED-LOCK-ON
  // Detect when enemies are targeting multiple allies (hbfreed pattern).
  // If ally is low HP and being focused, collapse toward them.
  // ======================================================
  const woundedAllies = allies.filter(a => a.health < 60);
  const mostWounded = woundedAllies.length > 0
    ? woundedAllies.reduce((a, b) => a.health < b.health ? a : b)
    : null;

  const alliesTakingDmg = allTeam.filter(b => b.health < 100).length;
  const distributedAttack = alliesTakingDmg >= 3 && enemies.length >= 3;

  if (distributedAttack && mostWounded && mostWounded.id !== input.selfId) {
    const mwDist = dist(self, mostWounded);
    const enemyOnWounded = enemies.reduce((a, b) =>
      dist(a, mostWounded) < dist(b, mostWounded) ? a : b
    );
    const ewDist = dist(self, enemyOnWounded);

    // v13: Accept 1 ally in blast when defending wounded ally
    if (canAbility && ewDist <= ABL_RANGE) {
      const lead = leadPosition(enemyOnWounded, 2);
      if (alliesInBlast(lead) <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    if (canAttack && ewDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: enemyOnWounded.id };
    }
    if (mwDist > 150) {
      return safeMove({
        x: (mostWounded.position.x - self.position.x) * 0.67 +
           (enemyOnWounded.position.x - self.position.x) * 0.33,
        y: (mostWounded.position.y - self.position.y) * 0.67 +
           (enemyOnWounded.position.y - self.position.y) * 0.33,
      });
    }
  }

  // ======================================================
  // ALL 5 BOTS: MELEE ASSAULT (no kiter)
  // ======================================================

  // -- ZONE-PRIORITY RETREAT for low HP --
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

  // -- MELEE --
  if (canAttack && targetDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: target.id }; }
  if (canAttack && nearestDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: nearestEnemy.id }; }

  // ======================================================
  // ENDGAME PURSUIT — zone pinch + intercept + pincer
  // ======================================================
  if (enemies.length <= 2 && (lateGame || allies.length === 0)) {
    const myDistToEnemy = dist(self, nearestEnemy);
    const closerAllies = allies.filter(a => dist(a, nearestEnemy) < myDistToEnemy);

    // -- Kite detection: track distance stalemate per bot --
    const pursuitKey = input.selfId;
    const prevDist = _s.pursuitDist[pursuitKey];
    if (prevDist !== undefined && Math.abs(myDistToEnemy - prevDist) < 15) {
      _s.pursuitTicks[pursuitKey] = (_s.pursuitTicks[pursuitKey] || 0) + 1;
    } else {
      _s.pursuitTicks[pursuitKey] = 0;
    }
    _s.pursuitDist[pursuitKey] = myDistToEnemy;

    const isKiting = _s.pursuitTicks[pursuitKey] >= 8 && myDistToEnemy > 300;  // was 400

    // v13: Accept 1 ally in blast during pursuit
    if (canAbility && myDistToEnemy <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 3);
      if (alliesInBlast(lead) <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }

    // -- Straggler convergence (3v1+): if 2+ allies closer, converge to fight --
    if (closerAllies.length >= 2 && myDistToEnemy > 300) {  // was 400
      const nearFighter = closerAllies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
      let convergeDir = dirTo(self, nearFighter);
      if (nearZoneEdge) {
        convergeDir.x = convergeDir.x * 0.59 + (zx - self.position.x) * 0.41;
        convergeDir.y = convergeDir.y * 0.59 + (zy - self.position.y) * 0.41;
      }
      return safeMove(convergeDir);
    }

    // -- Zone Pinch: when kiting detected, position between enemy and zone center --
    if (isKiting) {
      const enemyRadial = Math.hypot(nearestEnemy.position.x - zx, nearestEnemy.position.y - zy);
      const centerToEnemyX = nearestEnemy.position.x - zx;
      const centerToEnemyY = nearestEnemy.position.y - zy;
      const centerToEnemyMag = Math.hypot(centerToEnemyX, centerToEnemyY) || 1;

      const pinchDist = Math.max(0, enemyRadial - 200);
      const pinchX = zx + (centerToEnemyX / centerToEnemyMag) * pinchDist;
      const pinchY = zy + (centerToEnemyY / centerToEnemyMag) * pinchDist;

      if (allies.length >= 1 && input.botNumber % 2 === 1) {
        const eVel = getVelocity(nearestEnemy);
        const velMag = Math.hypot(eVel.x, eVel.y);
        if (velMag > 2) {
          const interceptX = nearestEnemy.position.x + eVel.x * 10;
          const interceptY = nearestEnemy.position.y + eVel.y * 10;
          const moveX = (interceptX - self.position.x) * 0.67 + (zx - self.position.x) * 0.33;
          const moveY = (interceptY - self.position.y) * 0.67 + (zy - self.position.y) * 0.33;
          return safeMove({ x: moveX, y: moveY });
        }
      }

      const moveX = pinchX - self.position.x;
      const moveY = pinchY - self.position.y;
      if (Math.hypot(moveX, moveY) < 50) {
        const eVel = getVelocity(nearestEnemy);
        const interceptX = nearestEnemy.position.x + eVel.x * 5;
        const interceptY = nearestEnemy.position.y + eVel.y * 5;
        return safeMove({ x: interceptX - self.position.x, y: interceptY - self.position.y });
      }
      return safeMove({ x: moveX, y: moveY });
    }

    // -- Default: direct pursuit (non-kiting enemies) --
    let chaseDir = dirTo(self, nearestEnemy);
    if (nearZoneEdge) {
      chaseDir.x = chaseDir.x * 0.59 + (zx - self.position.x) * 0.41;
      chaseDir.y = chaseDir.y * 0.59 + (zy - self.position.y) * 0.41;
    }
    return safeMove(chaseDir);
  }

  // -- ANTI-IDLE --
  if (_s.idleTicks[input.selfId] >= 10) {
    _s.idleTicks[input.selfId] = 0;
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // ======================================================
  // MOVEMENT — converge to pack, then attack as unit
  // ======================================================

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

  // v15: Isolated bot fight mode — fight nearby enemy instead of freezing
  // When isolated (no ally within 300u) with enemy in 200-350u, commit to fight
  if (isolated && nearestDist > ATK_RANGE && nearestDist < 350) {
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      // No alliesInBlast check needed — nearest ally is 300u+ away (> 150u blast radius)
      cd.abl = tick;
      return { type: 'ability', targetPosition: lead };
    }
    return safeMove(dirTo(self, nearestEnemy));
  }

  // Isolated or too far from team: converge first
  if ((isolated || distToTeam > CONVERGE_RADIUS) && nearestDist > ATK_RANGE) {
    return safeMove({
      x: (teamCenter.x - self.position.x) * 0.61 + (target.position.x - self.position.x) * 0.39,
      y: (teamCenter.y - self.position.y) * 0.61 + (target.position.y - self.position.y) * 0.39,
    });
  }

  // v13: AoE while closing — accept 1 ally in blast
  if (canAbility && targetDist > ATK_RANGE && targetDist <= ABL_RANGE) {
    const lead = leadPosition(target, 2);
    if (alliesInBlast(lead) <= 1) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: lead };
    }
  }

  // Move toward target with light centroid bias (stay together)
  if (targetDist > ATK_RANGE) {
    let moveDir = dirTo(self, target);

    if (distToTeam > CONVERGE_RADIUS * 0.61) {
      moveDir.x = moveDir.x * 0.71 + (teamCenter.x - self.position.x) * 0.29;
      moveDir.y = moveDir.y * 0.71 + (teamCenter.y - self.position.y) * 0.29;
    }

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
  const orbitOffset = (input.botNumber * 1.31) - 2.62;
  const toTarget = dirTo(self, target);
  const mag = Math.hypot(toTarget.x, toTarget.y) || 1;

  let orbitMove = {
    x: Math.cos(angle + orbitOffset) * 0.29 + (toTarget.x / mag) * 0.71,
    y: Math.sin(angle + orbitOffset) * 0.29 + (toTarget.y / mag) * 0.71,
  };

  if (allyDist < HARD_SPREAD) {
    const sd = spreadDir();
    orbitMove.x = orbitMove.x * 0.71 + sd.x * 0.29;
    orbitMove.y = orbitMove.y * 0.71 + sd.y * 0.29;
  }

  return safeMove(orbitMove);
}
