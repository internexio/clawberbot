/**
 * v26 Ammo Core — v16e proven combat + ammo awareness + powerup collection
 *
 * Base: v16e-unified-escape (98% WR peak, 98W-2L grind)
 *
 * Additions from v25:
 *   - Ammo tracking: gate attacks on hasAmmo, abilities on hasAbilityAmmo
 *   - Powerup collection: claim system, scoring, expiry-aware pathing
 *   - Out-of-ammo: center on zone, flee enemies, wait for pickups
 *   - Zone ceiling: when zr < 500, cap distance from center
 *
 * Preserved from v16e (NOT in v25):
 *   - Anti-ABAB oscillation (moveHist in safeMove)
 *   - Proactive zone pull (zr < 700 && distToCenter > zr * 0.6)
 *   - 1v1 direct chase endgame branch
 *   - Original buddy system (fires at any enemy during rally, no 300u gate)
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
    escaping: {},
    navGrid: null,
    moveHist: {},     // v16e: anti-ABAB direction tracking
    myPrev: {},       // v16e: per-bot previous position
    dispRing: {},     // v16e: per-tick displacement rolling window
    posRing: {},      // v16e: position history for orbit detection
    escLock: {},      // v16e: locked escape direction per bot
    // v26: pickup claiming
    pickupClaims: {},
    claimTick: -1,
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
  const HARD_SPREAD = 80;
  const SOFT_SPREAD = 160;
  const SPEED = 12;
  const CONVERGE_RADIUS = 200;

  const self = input.bots.find(b => b.id === input.selfId);
  if (!self || !self.alive) return { type: 'idle' };

  const teamIds = new Set(input.teamBotIds);
  const allies = input.bots.filter(b => b.alive && teamIds.has(b.id) && b.id !== input.selfId);
  const allTeam = input.bots.filter(b => b.alive && teamIds.has(b.id));
  const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));
  const tick = input.tick;

  if (enemies.length === 0) return { type: 'idle' };

  // === v26: AMMO TRACKING ===
  const ammo = self.ammo !== undefined ? self.ammo : 999;
  const hasAmmo = ammo > 0;
  const hasAbilityAmmo = ammo >= 2;

  // === v26: POWERUPS ===
  const powerups = input.powerups || [];

  if (_s.claimTick !== tick) {
    const aliveIds = new Set(allTeam.map(b => b.id));
    const activePowerupIds = new Set(powerups.map(p => p.id));
    for (const pid in _s.pickupClaims) {
      if (!aliveIds.has(_s.pickupClaims[pid]) || !activePowerupIds.has(pid)) {
        delete _s.pickupClaims[pid];
      }
    }
    _s.claimTick = tick;
  }

  // === TERRAIN NAVIGATION LAYER (v15) ===
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

  // -- Cooldown tracking (v26: gated on ammo) --
  if (!_s.cooldowns[input.selfId]) {
    _s.cooldowns[input.selfId] = { atk: -999, abl: -999 };
  }
  const cd = _s.cooldowns[input.selfId];
  const canAttack = tick - cd.atk >= ATK_CD && hasAmmo;
  const canAbility = tick - cd.abl >= ABL_CD && hasAbilityAmmo;

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

  // v16e: Save per-bot previous position BEFORE general update
  const myLastPos = _s.myPrev[input.selfId];
  const myTickDisp = myLastPos
    ? Math.hypot(self.position.x - myLastPos.x, self.position.y - myLastPos.y)
    : SPEED;
  _s.myPrev[input.selfId] = { x: self.position.x, y: self.position.y };

  for (const b of input.bots) {
    if (b.alive) _s.prevPos[b.id] = { x: b.position.x, y: b.position.y };
  }

  // -- Stuck detection --
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

  // v16e Fix 13: Unified fast terrain trap detection
  if (!_s.dispRing[input.selfId]) _s.dispRing[input.selfId] = [];
  const dRing = _s.dispRing[input.selfId];
  dRing.push(myTickDisp);
  if (dRing.length > 10) dRing.shift();

  if (!_s.posRing[input.selfId]) _s.posRing[input.selfId] = [];
  const pRing = _s.posRing[input.selfId];
  pRing.push({ x: self.position.x, y: self.position.y });
  if (pRing.length > 25) pRing.shift();

  const shortAvg = dRing.length >= 5
    ? dRing.slice(-5).reduce((a, b) => a + b, 0) / 5
    : SPEED;

  const medNetDisp = pRing.length >= 8
    ? Math.hypot(self.position.x - pRing[pRing.length - 8].x,
                 self.position.y - pRing[pRing.length - 8].y)
    : 999;

  const longNetDisp = pRing.length >= 20
    ? Math.hypot(self.position.x - pRing[pRing.length - 20].x,
                 self.position.y - pRing[pRing.length - 20].y)
    : 999;

  const terrainTrapped =
    (dRing.length >= 5 && shortAvg < 3) ||
    (pRing.length >= 8 && medNetDisp < 24) ||
    (pRing.length >= 20 && longNetDisp < 80 && shortAvg > 5);

  // -- Terrain --
  function isPassable(x, y) {
    const t = input.tiles;
    if (!t) return true;
    const tx = Math.floor(x / t.tileSize);
    const ty = Math.floor(y / t.tileSize);
    if (tx < 0 || tx >= t.width || ty < 0 || ty >= t.height) return false;
    return t.passable[ty * t.width + tx];
  }

  function obstDist(wx, wy) {
    if (!_s.navGrid) return 99;
    const { od, W, H, ts } = _s.navGrid;
    const tx = Math.floor(wx / ts), ty = Math.floor(wy / ts);
    if (tx < 0 || tx >= W || ty < 0 || ty >= H) return 0;
    return od[ty * W + tx];
  }

  // v16e safeMove with anti-ABAB (preserved from v16e, NOT v22/v25)
  function safeMove(dir) {
    const mag = Math.hypot(dir.x, dir.y);
    if (mag === 0) { _s.idleTicks[input.selfId]++; return { type: 'idle' }; }
    let nx = dir.x / mag;
    let ny = dir.y / mag;

    // v15: Terrain lookahead — steer around obstacles 2-3 steps ahead
    // v16c Fix 6: Anti-ABAB — skip offsets that reverse 2-ago direction
    if (_s.navGrid) {
      const l1x = self.position.x + nx * SPEED;
      const l1y = self.position.y + ny * SPEED;
      const l2x = self.position.x + nx * SPEED * 2.5;
      const l2y = self.position.y + ny * SPEED * 2.5;
      if (!isPassable(l2x, l2y) || obstDist(l1x, l1y) <= 1) {
        const ba = Math.atan2(ny, nx);
        const offs = [0.4, -0.4, 0.8, -0.8, 1.2, -1.2];
        const hist = _s.moveHist[input.selfId];
        const prev2 = hist && hist.length >= 2 ? hist[hist.length - 2] : null;
        for (const off of offs) {
          const ax = Math.cos(ba + off), ay = Math.sin(ba + off);
          const t1x = self.position.x + ax * SPEED;
          const t1y = self.position.y + ay * SPEED;
          if (isPassable(t1x, t1y) && obstDist(t1x, t1y) >= 2) {
            if (prev2 && Math.abs(ax - prev2.x) < 0.2 && Math.abs(ay - prev2.y) < 0.2) {
              continue;
            }
            nx = ax; ny = ay; break;
          }
        }
      }
    }

    const dx = self.position.x + nx * SPEED;
    const dy = self.position.y + ny * SPEED;

    function recordMove(mx, my) {
      if (!_s.moveHist[input.selfId]) _s.moveHist[input.selfId] = [];
      _s.moveHist[input.selfId].push({ x: mx, y: my });
      if (_s.moveHist[input.selfId].length > 3) _s.moveHist[input.selfId].shift();
    }

    if (isPassable(dx, dy)) { _s.idleTicks[input.selfId] = 0; recordMove(nx, ny); return { type: 'move', direction: { x: nx, y: ny } }; }
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

  // HARD ZONE: if outside, immediately return (v16e: always, no terrain skip)
  if (distToCenter > zr) {
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }
  // Zone hysteresis
  if (!_s.zoneRetreating[input.selfId]) _s.zoneRetreating[input.selfId] = false;
  if (distToCenter > zr - ZONE_BUFFER_EXIT) {
    _s.zoneRetreating[input.selfId] = true;
  }
  if (distToCenter < zr - ZONE_BUFFER_ENTER) {
    _s.zoneRetreating[input.selfId] = false;
  }

  // v16d Fix 9: Proactive zone pull (preserved from v16e)
  if (zr < 700 && distToCenter > zr * 0.6) {
    _s.zoneRetreating[input.selfId] = true;
  }

  const nearZoneEdge = _s.zoneRetreating[input.selfId];
  const lateGame = tick > 600 || zoneSmall();

  // -- Nearest enemy --
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  // v26: OPENING BURST (tick 0-10) — maximize first-contact damage
  if (tick <= 10 && canAbility) {
    for (const e of enemies) {
      const eDist = dist(self, e);
      if (eDist <= ABL_RANGE) {
        const lead = leadPosition(e, 2);
        if (alliesInBlast(lead) <= 1) {
          cd.abl = tick;
          return { type: 'ability', targetPosition: lead };
        }
      }
    }
  }

  // v16e Fix 14: Unified terrain escape — HIGHEST PRIORITY
  if (terrainTrapped) {
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      const friendsNear = allies.filter(a =>
        Math.hypot(a.position.x - lead.x, a.position.y - lead.y) <= ABL_RADIUS
      ).length;
      if (friendsNear <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }

    if (canAttack && nearestDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }

    const lock = _s.escLock[input.selfId];
    let needNewLock = !lock
      || tick - lock.tick > 8
      || !isPassable(self.position.x + lock.dx * SPEED,
                     self.position.y + lock.dy * SPEED);

    if (needNewLock) {
      const toZone = Math.atan2(zy - self.position.y, zx - self.position.x);
      const zoneUrgency = distToCenter > zr - 200 ? 4 : 2;
      let bestScore = -Infinity;
      let bestDx = 0, bestDy = 0;

      for (let i = 0; i < 16; i++) {
        const angle = i * (Math.PI / 8);
        const adx = Math.cos(angle), ady = Math.sin(angle);
        const tx = self.position.x + adx * SPEED;
        const ty = self.position.y + ady * SPEED;
        if (!isPassable(tx, ty)) continue;

        let depth = 0;
        for (let d = 1; d <= 6; d++) {
          const fx = self.position.x + adx * SPEED * d;
          const fy = self.position.y + ady * SPEED * d;
          if (isPassable(fx, fy)) depth++;
          else break;
        }

        const alignment = Math.cos(angle - toZone);
        const od = obstDist(tx, ty);
        const score = depth * 3 + alignment * zoneUrgency + Math.min(od, 4);
        if (score > bestScore) {
          bestScore = score;
          bestDx = adx;
          bestDy = ady;
        }
      }

      if (bestScore > -Infinity) {
        _s.escLock[input.selfId] = { dx: bestDx, dy: bestDy, tick: tick };
      } else {
        if (canAttack && nearestDist <= ATK_RANGE) {
          cd.atk = tick;
          return { type: 'attack', targetId: nearestEnemy.id };
        }
        return { type: 'idle' };
      }
    }

    const el = _s.escLock[input.selfId];
    return { type: 'move', direction: { x: el.dx, y: el.dy } };
  }

  // Clear escape lock when not trapped
  if (_s.escLock[input.selfId]) {
    delete _s.escLock[input.selfId];
  }

  function alliesInBlast(pos) {
    return allies.filter(a =>
      Math.hypot(a.position.x - pos.x, a.position.y - pos.y) <= ABL_RADIUS
    ).length;
  }

  // ======================================================
  // v26: PICKUP COLLECTION — after terrain escape, before combat
  // ======================================================
  const needsAmmo = ammo <= 1;
  const needsHealth = self.health < 65;
  const timeoutMeta = tick > 600 && zr < 500;
  const pickupProximity = timeoutMeta ? 200 : 120;
  const nearPickup = powerups.length > 0 && powerups.some(p =>
    Math.hypot(p.position.x - self.position.x, p.position.y - self.position.y) < pickupProximity
  );

  if (powerups.length > 0 && (needsAmmo || needsHealth || nearPickup || timeoutMeta)) {
    let bestPickup = null;
    let bestScore = -Infinity;

    for (const p of powerups) {
      if (_s.pickupClaims[p.id] && _s.pickupClaims[p.id] !== input.selfId) continue;

      const pDistZone = Math.hypot(p.position.x - zx, p.position.y - zy);
      if (pDistZone > zr - 30) continue;

      const pDist = Math.hypot(p.position.x - self.position.x, p.position.y - self.position.y);
      const ticksToReach = pDist / SPEED;
      if (p.expiresAtTick && tick + ticksToReach + 5 > p.expiresAtTick) continue;

      let score = 0;

      if (p.type === 'ammo' && needsAmmo) {
        score = 200 - pDist * 0.3;
        if (ammo === 0) score += 100;
      } else if (p.type === 'health' && needsHealth) {
        score = 100 - pDist * 0.3;
        if (self.health < 30) score += 50;
      } else if (p.type === 'health' && timeoutMeta) {
        score = 150 - pDist * 0.2;
      } else {
        score = 30 - pDist * 0.3;
      }

      if (p.type === 'health' && (tick > 800 || timeoutMeta)) score += 40;
      score -= pDistZone * 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestPickup = p;
      }
    }

    if (bestPickup && bestScore > 0) {
      _s.pickupClaims[bestPickup.id] = input.selfId;

      const pDist = Math.hypot(bestPickup.position.x - self.position.x,
                               bestPickup.position.y - self.position.y);

      // Still fight while collecting
      if (canAbility && nearestDist <= ABL_RANGE && pDist > 50) {
        const lead = leadPosition(nearestEnemy, 2);
        if (alliesInBlast(lead) <= 1) {
          cd.abl = tick;
          return { type: 'ability', targetPosition: lead };
        }
      }
      if (canAttack && nearestDist <= ATK_RANGE) {
        cd.atk = tick;
        return { type: 'attack', targetId: nearestEnemy.id };
      }

      const pickupDir = {
        x: bestPickup.position.x - self.position.x,
        y: bestPickup.position.y - self.position.y,
      };
      if (nearZoneEdge) {
        pickupDir.x = pickupDir.x * 0.7 + (zx - self.position.x) * 0.3;
        pickupDir.y = pickupDir.y * 0.7 + (zy - self.position.y) * 0.3;
      }
      return safeMove(pickupDir);
    }
  }

  // ======================================================
  // v26: ZONE CEILING (from v22/v25)
  // ======================================================
  if (zr < 500) {
    const zoneCeiling = Math.min(zr * 0.9, 320);
    if (distToCenter > zoneCeiling) {
      if (canAbility && nearestDist <= ABL_RANGE) {
        const lead = leadPosition(nearestEnemy, 2);
        if (alliesInBlast(lead) <= 1) {
          cd.abl = tick;
          return { type: 'ability', targetPosition: lead };
        }
      }
      if (canAttack && nearestDist <= ATK_RANGE) {
        cd.atk = tick;
        return { type: 'attack', targetId: nearestEnemy.id };
      }
      return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
    }
  }

  // ======================================================
  // v26: OUT OF AMMO — center on zone, flee enemies, wait
  // ======================================================
  if (ammo === 0 && !needsHealth) {
    const totalHP = allTeam.reduce((s, b) => s + b.health, 0) || 1;
    const teamCtr = {
      x: allTeam.reduce((s, b) => s + b.position.x * b.health, 0) / totalHP,
      y: allTeam.reduce((s, b) => s + b.position.y * b.health, 0) / totalHP,
    };
    const zoneW = zr < 400 ? 0.95 : (zr < 600 ? 0.80 : 0.65);
    const teamW = 1.0 - zoneW;
    const waitDir = {
      x: (teamCtr.x - self.position.x) * teamW + (zx - self.position.x) * zoneW,
      y: (teamCtr.y - self.position.y) * teamW + (zy - self.position.y) * zoneW,
    };
    if (nearestDist < 200) {
      const fleeX = self.position.x - nearestEnemy.position.x;
      const fleeY = self.position.y - nearestEnemy.position.y;
      const zBlend = distToCenter > zr - 150 ? 0.6 : 0.25;
      return safeMove({
        x: fleeX * (1 - zBlend) + (zx - self.position.x) * zBlend,
        y: fleeY * (1 - zBlend) + (zy - self.position.y) * zBlend,
      });
    }
    return safeMove(waitDir);
  }

  // Fire ability even while stuck
  if (isStuck && canAbility && nearestDist <= ABL_RANGE) {
    const lead = leadPosition(nearestEnemy, 2);
    if (alliesInBlast(lead) <= 1) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: lead };
    }
  }

  // -- HARD ZONE RULE: within 50u of edge --
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

  // -- Team info (v16: HP-weighted center) --
  const totalHP = allTeam.reduce((s, b) => s + b.health, 0) || 1;
  const teamCenter = {
    x: allTeam.reduce((s, b) => s + b.position.x * b.health, 0) / totalHP,
    y: allTeam.reduce((s, b) => s + b.position.y * b.health, 0) / totalHP,
  };
  const distToTeam = Math.hypot(self.position.x - teamCenter.x, self.position.y - teamCenter.y);

  const nearbyAllies250 = allies.filter(a => dist(self, a) < 250).length;
  const nearbyAllies = allies.filter(a => dist(self, a) < 300).length;
  const isolated = nearbyAllies === 0 && allies.length > 0;
  const packFormed = nearbyAllies250 >= 1;
  const beingAttacked = self.health < 100;
  const numericalAdvantage = allTeam.length >= enemies.length + 2;

  // ======================================================
  // BUDDY SYSTEM — converge to nearest ally, not center (v16e original)
  // ======================================================
  if (!packFormed && allies.length > 0 && allTeam.length >= 3) {
    if (canAbility) {
      for (const e of enemies) {
        if (dist(self, e) <= ABL_RANGE) {
          const lead = leadPosition(e, 2);
          if (alliesInBlast(lead) <= 1) {
            cd.abl = tick;
            return { type: 'ability', targetPosition: lead };
          }
        }
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
  // PAIR DETECTION
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
  // HP-WEIGHTED TARGET SELECTION
  // ======================================================
  function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 300).length + 1;
    const nearEdge = Math.hypot(e.position.x - zx, e.position.y - zy) > zr - 100;
    const hpPriority = d < 300 ? (100 - e.health) * 3 : (100 - e.health) * 1;
    const distPenalty = d > 300 ? 200 : d * 0.1;
    const inPair = _s.enemyPairs.some(p => p.a.id === e.id || p.b.id === e.id);
    const pairBonus = inPair ? 20 : 0;
    return -hpPriority - alliesNear * 25 + distPenalty - (nearEdge ? 30 : 0) - pairBonus;
  }

  const aliveTeamIds = [input.selfId, ...allies.map(a => a.id)].sort();
  const isLeader = aliveTeamIds[0] === input.selfId;

  let target = null;
  if (_s.lockedTarget) target = enemies.find(e => e.id === _s.lockedTarget);

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
  if (target && dist(self, target) > 500) {
    target = nearestEnemy;
  }
  if (!target) target = nearestEnemy;

  const targetDist = dist(self, target);

  // ======================================================
  // ABILITY-FIRST — fire ability ASAP, with pair targeting
  // ======================================================
  if (canAbility && !criticalHP) {
    let bestPos = null;
    let bestScore = -999;

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
  // SOFT SPREAD
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
  // ALL 5 BOTS: MELEE ASSAULT
  // ======================================================

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
  // ENDGAME PURSUIT (v16e: includes 1v1 chase branch)
  // ======================================================
  if (enemies.length <= 2 && (lateGame || allies.length === 0 || numericalAdvantage)) {
    const myDistToEnemy = dist(self, nearestEnemy);
    const closerAllies = allies.filter(a => dist(a, nearestEnemy) < myDistToEnemy);

    // v16c Fix 4: 1v1 direct chase (preserved from v16e)
    if ((allies.length === 0 && enemies.length === 1) || terrainTrapped) {
      if (canAbility && myDistToEnemy <= ABL_RANGE) {
        const lead = leadPosition(nearestEnemy, 3);
        if (alliesInBlast(lead) <= 1) {
          cd.abl = tick;
          return { type: 'ability', targetPosition: lead };
        }
      }
      let chaseDir = dirTo(self, nearestEnemy);
      if (nearZoneEdge || distToCenter > zr - 100) {
        chaseDir.x = chaseDir.x * 0.5 + (zx - self.position.x) * 0.5;
        chaseDir.y = chaseDir.y * 0.5 + (zy - self.position.y) * 0.5;
      }
      return safeMove(chaseDir);
    }

    // -- Kite detection --
    const pursuitKey = input.selfId;
    const prevDist = _s.pursuitDist[pursuitKey];
    if (prevDist !== undefined && Math.abs(myDistToEnemy - prevDist) < 15) {
      _s.pursuitTicks[pursuitKey] = (_s.pursuitTicks[pursuitKey] || 0) + 1;
    } else {
      _s.pursuitTicks[pursuitKey] = 0;
    }
    _s.pursuitDist[pursuitKey] = myDistToEnemy;

    const isKiting = _s.pursuitTicks[pursuitKey] >= 8 && myDistToEnemy > 300;

    if (canAbility && myDistToEnemy <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 3);
      if (alliesInBlast(lead) <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }

    // -- Straggler convergence --
    if (closerAllies.length >= 2 && myDistToEnemy > 300) {
      const nearFighter = closerAllies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
      let convergeDir = dirTo(self, nearFighter);
      if (nearZoneEdge) {
        convergeDir.x = convergeDir.x * 0.59 + (zx - self.position.x) * 0.41;
        convergeDir.y = convergeDir.y * 0.59 + (zy - self.position.y) * 0.41;
      }
      return safeMove(convergeDir);
    }

    // -- Zone Pinch --
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

    // -- Default: direct pursuit --
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

  if (lowHP && allies.length > 0 && !numericalAdvantage) {
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

  if (isolated && nearestDist > ATK_RANGE && nearestDist < 350) {
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = leadPosition(nearestEnemy, 2);
      cd.abl = tick;
      return { type: 'ability', targetPosition: lead };
    }
    return safeMove(dirTo(self, nearestEnemy));
  }

  if ((isolated || distToTeam > CONVERGE_RADIUS) && nearestDist > ATK_RANGE) {
    return safeMove({
      x: (teamCenter.x - self.position.x) * 0.61 + (target.position.x - self.position.x) * 0.39,
      y: (teamCenter.y - self.position.y) * 0.61 + (target.position.y - self.position.y) * 0.39,
    });
  }

  if (canAbility && targetDist > ATK_RANGE && targetDist <= ABL_RANGE) {
    const lead = leadPosition(target, 2);
    if (alliesInBlast(lead) <= 1) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: lead };
    }
  }

  if (targetDist > ATK_RANGE) {
    let moveDir = dirTo(self, target);

    if (distToTeam > CONVERGE_RADIUS * 0.61) {
      moveDir.x = moveDir.x * 0.71 + (teamCenter.x - self.position.x) * 0.29;
      moveDir.y = moveDir.y * 0.71 + (teamCenter.y - self.position.y) * 0.29;
    }

    if (allyDist < SOFT_SPREAD && packFormed) {
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

  // In melee range, on cooldown: tight orbit
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
