/**
 * v16d Terrain Escape — v16c + 3 terrain navigation fixes
 *
 * Base: v16c Anti-Oscillate (91W-9L)
 *   - All v16c fixes preserved (1v1 chase, oscillation detect, anti-ABAB)
 *
 * v16d Fixes (KF-Debugger diagnosed v16c fix failures):
 *   Fix 7: Persistent oscillation state — once detected, stays active until bot
 *     escapes 80u from detection point. v16c was transient (1 tick per 15).
 *   Fix 8: Top-level terrain escape override — bypasses safeMove entirely when
 *     persistently oscillating. Uses sweeping angle probe (16 angles, rotating
 *     each tick) to find ANY passable direction. Placed BEFORE all tactical logic.
 *   Fix 9: Proactive zone pull — when zone radius < 700 and bot is in far half
 *     of arena, start pulling toward center BEFORE getting trapped between
 *     terrain and shrinking zone edge.
 *
 * Root cause: safeMove uses single-step lookahead with 6 fixed offsets.
 *   Against multi-tile terrain pockets on sunken_reef, no single-step direction
 *   can navigate out. This produces:
 *   - Mode A (oscillation): Two offsets passable but reverse each other (±12u)
 *   - Mode B (freeze): Zero offsets passable, safeMove returns idle
 *   v16c's isOscillating was true for 1/15 ticks and only checked in endgame
 *   pursuit block — the other 14 ticks ran regular logic → back to oscillation.
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
    moveHist: {},     // v16c: last 2 move directions per bot (anti-ABAB)
    oscAnchor: {},    // v16c: oscillation anchor position per bot
    oscTick: {},      // v16c: when anchor was set
    oscEscaping: {},  // v16d Fix 7: persistent oscillation escape mode
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

  // -- Stuck detection (P0) — persistent escape --
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

  // v16: Enter persistent escape mode when stuck
  if (isStuck && !_s.escaping[input.selfId]) {
    _s.escaping[input.selfId] = { startTick: tick, ox: self.position.x, oy: self.position.y };
  }
  const esc = _s.escaping[input.selfId];
  if (esc) {
    const escElapsed = tick - esc.startTick;
    const escDist = Math.hypot(self.position.x - esc.ox, self.position.y - esc.oy);
    if (escElapsed > 15 || escDist > 60) {
      delete _s.escaping[input.selfId];
    }
  }

  // v16c Fix 5: Oscillation detection — net displacement over 15 ticks
  if (!_s.oscAnchor[input.selfId] || !_s.oscTick[input.selfId]) {
    _s.oscAnchor[input.selfId] = { x: self.position.x, y: self.position.y };
    _s.oscTick[input.selfId] = tick;
  }
  const oscElapsed = tick - _s.oscTick[input.selfId];
  const oscNetDist = Math.hypot(
    self.position.x - _s.oscAnchor[input.selfId].x,
    self.position.y - _s.oscAnchor[input.selfId].y
  );
  let isOscillating = false;
  if (oscElapsed >= 15) {
    if (oscNetDist < 30) {
      isOscillating = true;
    }
    _s.oscAnchor[input.selfId] = { x: self.position.x, y: self.position.y };
    _s.oscTick[input.selfId] = tick;
  }

  // v16d Fix 7: Persistent oscillation state
  // Once oscillation detected, stay in escape mode until bot moves 80u away
  if (isOscillating) {
    _s.oscEscaping[input.selfId] = {
      startTick: tick,
      ox: self.position.x,
      oy: self.position.y
    };
  }
  const oscEsc = _s.oscEscaping[input.selfId];
  if (oscEsc) {
    const oeDist = Math.hypot(self.position.x - oscEsc.ox, self.position.y - oscEsc.oy);
    const oeTime = tick - oscEsc.startTick;
    if (oeDist > 80 || oeTime > 50) {
      delete _s.oscEscaping[input.selfId];
    }
  }
  const persistentOsc = !!_s.oscEscaping[input.selfId];

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

  // v16d Fix 9: Proactive zone pull — start moving center-ward early
  // When zone is closing and bot is in far half, pull toward center before getting trapped
  if (zr < 700 && distToCenter > zr * 0.6) {
    _s.zoneRetreating[input.selfId] = true;
  }

  const nearZoneEdge = _s.zoneRetreating[input.selfId];
  const lateGame = tick > 600 || zoneSmall();

  // -- Nearest enemy (needed for zone-edge ability fire) --
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;

  // v16: Persistent escape — override ALL other logic when stuck
  if (_s.escaping[input.selfId]) {
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
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // v16d Fix 8: Top-level terrain escape override
  // When persistently oscillating, bypass safeMove entirely — direct passability probe
  // Sweeps 16 angles, rotating base each tick to systematically find ANY exit
  if (persistentOsc) {
    // Fire ability opportunistically
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

    // Sweeping angle probe — bypasses safeMove terrain avoidance entirely
    const toZone = Math.atan2(zy - self.position.y, zx - self.position.x);
    const escTick = _s.oscEscaping[input.selfId].startTick;
    // Rotate base angle over time to break symmetry
    const sweep = ((tick - escTick) % 16) * (Math.PI / 8);

    for (let i = 0; i < 16; i++) {
      // Alternate positive/negative offsets from swept direction
      const offset = (i % 2 === 0 ? 1 : -1) * Math.floor((i + 1) / 2) * (Math.PI / 8);
      const angle = toZone + sweep + offset;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const tx = self.position.x + dx * SPEED;
      const ty = self.position.y + dy * SPEED;
      if (isPassable(tx, ty)) {
        return { type: 'move', direction: { x: dx, y: dy } };
      }
    }
    // If no direction works at full speed, the bot is truly walled in
    return { type: 'idle' };
  }

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
  // BUDDY SYSTEM — converge to nearest ally, not center
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
  // ENDGAME PURSUIT — zone pinch + intercept + pincer
  // ======================================================
  if (enemies.length <= 2 && (lateGame || allies.length === 0 || numericalAdvantage)) {
    const myDistToEnemy = dist(self, nearestEnemy);
    const closerAllies = allies.filter(a => dist(a, nearestEnemy) < myDistToEnemy);

    // v16c Fix 4: 1v1 direct chase
    if ((allies.length === 0 && enemies.length === 1) || isOscillating) {
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
