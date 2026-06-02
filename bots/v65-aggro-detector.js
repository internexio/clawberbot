/**
 * v65 Behavioral Aggro-Detector (submit bots/v65-aggro-detector.min.js).
 * Phase 3: HYBRID gate for the mirror = prefix fast-path (CC/hbfreed/ClaudeOpus, instant) OR a
 * BEHAVIORAL fire-detector that latches "wide-aggressor" from observed enemy AMMO-DROPS (fire pressure)
 * in the opening. Catches rotating-id / unknown aggressors (oztenbot) the prefix list misses, with no
 * code change for future ones. ~89% class accuracy by ~t50 (>=~5 ammo-drops). SAFE FALLBACK: if enemy
 * ammo is absent from input, drops stay 0 -> never latches -> behaves as the v64 prefix-gate.
 * Mirror itself unchanged (v63 forage+close-fire). Validated: low-fire/passive opponents stay v60-pack.
 * Fallback: v64 sv114 (prefix-only), v63 sv113 (CC-only), v60 sv110.
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
    myPrev: {},
    dispRing: {},
    posRing: {},
    escLock: {},
    moveHist: {},     // v27 Fix 1: anti-ABAB direction tracking from v16e
    pickupClaims: {},
    claimTick: -1,
    surroundActive: false,
    surroundTargetId: undefined,
    surroundTargetSpawnPos: null,
    surroundExpireTick: 80,
    ringPosition: {},
  };
}

const NAV_G=64, NAV_CW=32, NAV_HASH=4115432252;
const NAV_FLOW=(()=>{const e="i33f5i7f10i39f24i19g1i1f8i7f7g1f21i18g1f22i1f22i18f46i17h1g1f45i18g1f19h1g1f24i18h1g1f17e1a1h1g1f23i16a3h1g1f15e1d1a2h1g1f21e1i5f3i3a9h1g1f13e1d2b1i2h1g1f19e1d2e3f3i4a10h1g1f11i8g1f18e1d5f4i4a11h1g1f10i8h1g1f16e1d5f4i5a12h1g1f8i10g1f15e1d5f5i5a13h1g1f7i10h1g1f13e1d5f5e1i6a13h1g1f6i11g1f12e1d5f5e1d2i4a15h1g1f4i12g1f11e1i2d3f5e1d4i3a16h1g1f3i12h1g1f9e1i5g1f4e1d5i3a17h1g1f2i13g1f8e1i6g1f3e1d7i2a18h1g1f2i12g1f7i8h1g1f1e1d8i5a16h1g1i13f7i10f1e1d8i10a13h1i12g1f8i8f1e1d8i11b1i4a9h1g1i10f11i4f1e2d8i18a9h1g1i2f1i5f11e1d1e4d10i18a10h1g1f17e1d15i16h1i2a11h1g1f15e1d16i15a16h1g1f13e1d16i16a17h1g1f11e1d17i16a18h1g1f9e1d18i15a20h1g1f7e1d18i16a21h1g1f5e1d20i14a23h1g1f3e1d22e1i12a24h1g1f1i5d21i10a23b1i1a1j1i7d13i2d5i7a25b1c1i10c1d12i5d2i7b1i1a22b2c1i9b2c1d11i6d1i7a23b3c1d1i8b3c1d10i6c1i6a23b5i9b4c1d9i6f1i6a22b5c1i8b6c1d8i5f1e1i4a23b6i8b8c1d8e1i2f1e1d1i5a21b6c1i7b10c1d9e2d1i6a20b7c1i6b12c1d10i7a19b8c1d1e1i3b14c1d9i6a19b10c1d2i1f1e1b14c1d9i5a18b12c1d2e1d2b14c1d8i4a18b14c1d5b14c1d7i3a18b16c1d5b4i2b1i1b6c1d6i3a17b18c1d5b2i8b4c1d6i2a16b20c1d5c1i9b4c1d5i2a15b22c1d6i8b5c1d4i2a14b24c1d6e2i6b5c1d2i3a13b26c1d8i4b7c1d1i3a12b28c1d8i1a1b9i4a11b30c1d7a1b7i7a10b32c1d6b7i8a9b20i3b11c1d5b6c1i16b20i5b11c1d5b5c1d1e1i14b19i7b11c1d5b4i18b17i9b11c1d5b2c1i18b16i10b12c1d5b1c1i18b15c1i9b14c1d5i19b13i1b1c1i8b1i1b2i1b11c1d5i18b1i6b5i2b1i11b1i9b1i7d1i19c1i7b3i61b2i45";const I={a:'0',b:'1',c:'2',d:'3',e:'4',f:'5',g:'6',h:'7',i:'X',j:'C'};let s='',k=0;while(k<e.length){const c=I[e[k++]];let n='';while(k<e.length&&e[k]>='0'&&e[k]<='9')n+=e[k++];s+=c.repeat(+n);}return s;})();
const _NAV_DIRS=[[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1],[1,1]];
function flowDirAt(x,y){const c=Math.floor(x/NAV_CW),r=Math.floor(y/NAV_CW);if(r<0||r>=NAV_G||c<0||c>=NAV_G)return null;const ch=NAV_FLOW.charCodeAt(r*NAV_G+c)-48;if(ch<0||ch>7)return null;const d=_NAV_DIRS[ch];return{x:d[0],y:d[1]};}
function update(input) {
  const ATK_RANGE = 256;
  const ATK_CD = 10;
  const ABL_RANGE = 700;
  const ABL_RADIUS = 150;
  const ABL_CD = 30;
  const AGGRO_PREFIXES = ['edae262d-b7e4-4dd0-a8d0-3f34cb7c0a90','66af2b8d-610e-4b23-94a7-42b527f2cf89','83f79af2-3996-454f-ba57-6310283cbe1f']; // CC, hbfreed, ClaudeOpus
  const AGGRO_FIRE_THRESH = 5;  // enemy ammo-drops (fire pressure) to latch "wide-aggressor"
  const AGGRO_WINDOW = 120;     // only latch within the opening/midgame
  const MIRROR_SPREAD = 400;
  const MIRROR_REPEL = 1.0;
  const MIRROR_FORAGE = 300;
  const CC_CLOSE_FIRE = 400;  // v63: single-target ability only fires within this range (CC fires ~284u); multi-hit + endgame exempt
  const ZONE_BUFFER_ENTER = 180;
  const ZONE_BUFFER_EXIT = 100;
  const HARD_SPREAD = 200;  // v35b: 120→200 (outside 150u AoE blast radius)
  const SOFT_SPREAD = 260;  // v35b: 160→260 (wider soft repulsion)
  const SPEED = 12;
  const CONVERGE_RADIUS = 200;
  const self = input.bots.find(b => b.id === input.selfId);
  if (!self || !self.alive) return { type: 'idle' };
  const teamIds = new Set(input.teamBotIds);
  const allies = input.bots.filter(b => b.alive && teamIds.has(b.id) && b.id !== input.selfId);
  const allTeam = input.bots.filter(b => b.alive && teamIds.has(b.id));
  const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));
  const tick = input.tick;
  // --- Phase 3 behavioral fire-detector (hybrid: prefix fast-path OR observed fire pressure) ---
  const aggroByPrefix = enemies.some(e => typeof e.id === 'string' && AGGRO_PREFIXES.some(p => e.id.indexOf(p) === 0));
  if (_s.fireTrackTick !== tick) {
    if (!_s.enemyAmmoPrev) { _s.enemyAmmoPrev = {}; _s.enemyFireSeen = 0; }
    for (const e of enemies) {
      if (e.ammo === undefined) continue;
      const pv = _s.enemyAmmoPrev[e.id];
      if (pv !== undefined && e.ammo < pv) _s.enemyFireSeen += (pv - e.ammo);
      _s.enemyAmmoPrev[e.id] = e.ammo;
    }
    if (tick <= AGGRO_WINDOW && _s.enemyFireSeen >= AGGRO_FIRE_THRESH) _s.aggroLatch = true;
    _s.fireTrackTick = tick;
  }
  const VS_AGGRO = aggroByPrefix || _s.aggroLatch === true;
  if (enemies.length === 0) return { type: 'idle' };
  if (input.tick === 0 && _s.navDrift === undefined) {
    _s.navDrift = false; const _t = input.tiles;
    if (_t && _t.passable && _t.width) { let mis=0,nn=0;
      for (let r=8;r<NAV_G-8;r++) for (let c=8;c<NAV_G-8;c++){
        const baked = NAV_FLOW.charCodeAt(r*NAV_G+c)===88;
        const tx=Math.floor((c+0.5)*NAV_CW/_t.tileSize), ty=Math.floor((r+0.5)*NAV_CW/_t.tileSize);
        const live=(tx>=0&&tx<_t.width&&ty>=0&&ty<_t.height)? !_t.passable[ty*_t.width+tx] : true;
        nn++; if(baked!==live) mis++; }
      if (nn && mis/nn > 0.20) _s.navDrift = true; } }
  const RING_RADIUS = 350;
  if (tick === 0 && _s.surroundTargetId === undefined) {
    const ourCx = allTeam.reduce((s, b) => s + b.position.x, 0) / allTeam.length;
    const ourCy = allTeam.reduce((s, b) => s + b.position.y, 0) / allTeam.length;
    let bestTarget = null;
    let bestScore = -Infinity;
    for (const e of enemies) {
      const nearestAllyDist = enemies.filter(a => a.id !== e.id)
        .reduce((mn, a) => Math.min(mn, Math.hypot(a.position.x - e.position.x, a.position.y - e.position.y)), 9999);
      const threatProx = Math.hypot(e.position.x - ourCx, e.position.y - ourCy);
      const score = nearestAllyDist * 1.0 - threatProx * 0.5;
      if (score > bestScore) { bestScore = score; bestTarget = e; }
    }
    if (bestTarget) {
      _s.surroundTargetId = bestTarget.id;
      _s.surroundTargetSpawnPos = { x: bestTarget.position.x, y: bestTarget.position.y };
      _s.surroundActive = true;
      _s.surroundExpireTick = 80;
      const ccCx = enemies.reduce((s, b) => s + b.position.x, 0) / enemies.length;
      const ccCy = enemies.reduce((s, b) => s + b.position.y, 0) / enemies.length;
      const awayFromCC = Math.atan2(bestTarget.position.y - ccCy, bestTarget.position.x - ccCx);
      const ringPositions = [];
      for (let i = 0; i < 5; i++) {
        const angle = awayFromCC + (i * 2 * Math.PI / 5);
        ringPositions.push({
          x: bestTarget.position.x + Math.cos(angle) * RING_RADIUS,
          y: bestTarget.position.y + Math.sin(angle) * RING_RADIUS,
        });
      }
      const assigned = new Set();
      const botIds = input.teamBotIds.slice().sort();
      for (const bid of botIds) {
        const bot = allTeam.find(b => b.id === bid);
        if (!bot) continue;
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < ringPositions.length; i++) {
          if (assigned.has(i)) continue;
          const d = Math.hypot(bot.position.x - ringPositions[i].x, bot.position.y - ringPositions[i].y);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        assigned.add(bestIdx);
        _s.ringPosition[bid] = ringPositions[bestIdx];
      }
    }
  }
  if (_s.surroundActive) {
    const sTarget = enemies.find(e => e.id === _s.surroundTargetId);
    const targetDead = !sTarget;
    const targetMoved = sTarget && _s.surroundTargetSpawnPos &&
      Math.hypot(sTarget.position.x - _s.surroundTargetSpawnPos.x,
                 sTarget.position.y - _s.surroundTargetSpawnPos.y) > 400;
    const lostBot = allTeam.length < 5;
    const earlyDamage = tick < 40 && allTeam.some(b => b.health < 50);
    const expired = tick >= _s.surroundExpireTick;
    if (targetDead || targetMoved || lostBot || earlyDamage || expired) {
      _s.surroundActive = false;
      _s.ringPosition = {};
    }
  }
  const ammo = self.ammo !== undefined ? self.ammo : 999;
  const hasAmmo = ammo > 0;
  const hasAbilityAmmo = ammo >= 1;  // v60: was >=2 (wasted every bot's last cast)
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
  if (!_s.cooldowns[input.selfId]) {
    _s.cooldowns[input.selfId] = { atk: -999, abl: -999 };
  }
  const cd = _s.cooldowns[input.selfId];
  const canAttack = tick - cd.atk >= ATK_CD && hasAmmo;
  const canAbilityCd = tick - cd.abl >= ABL_CD && hasAbilityAmmo;
  const cascadeTrigger = allTeam.length < 5 || (5 - enemies.length) >= 1;
  const ammoReserveOk = cascadeTrigger
    ? (ammo >= 2 || tick > 600)
    : (ammo >= 4 || tick > 600);
  const canAbility = canAbilityCd;  // gates checked at call sites with ammoReserveOk
  if (!_s.idleTicks[input.selfId]) _s.idleTicks[input.selfId] = 0;
  _s.killsUs = 5 - enemies.length;
  _s.killsThem = 5 - allTeam.length;
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
  function getVelocity(bot) {
    const prev = _s.prevPos[bot.id];
    if (!prev) return { x: 0, y: 0 };
    return { x: bot.position.x - prev.x, y: bot.position.y - prev.y };
  }
  function leadPosition(bot, ticks) {
    const v = getVelocity(bot);
    return { x: bot.position.x + v.x * ticks, y: bot.position.y + v.y * ticks };
  }
  function clusterAim(primary, ticks) {
    const primaryLead = leadPosition(primary, ticks);
    if (enemies.length < 2) return primaryLead;
    const leads = enemies.map(e => ({ id: e.id, lead: leadPosition(e, ticks) }));
    const reachable = leads.filter(el =>
      el.id !== primary.id &&
      Math.hypot(el.lead.x - primaryLead.x, el.lead.y - primaryLead.y) <= ABL_RADIUS * 2
    );
    const candidates = [primaryLead];
    for (let i = 0; i < reachable.length; i++) {
      candidates.push({
        x: (primaryLead.x + reachable[i].lead.x) / 2,
        y: (primaryLead.y + reachable[i].lead.y) / 2,
      });
      for (let j = i + 1; j < reachable.length; j++) {
        candidates.push({
          x: (primaryLead.x + reachable[i].lead.x + reachable[j].lead.x) / 3,
          y: (primaryLead.y + reachable[i].lead.y + reachable[j].lead.y) / 3,
        });
      }
    }
    let bestPos = primaryLead;
    let bestHits = 1;  // primaryLead hits at least the primary
    for (const c of candidates) {
      const drift = Math.hypot(c.x - primaryLead.x, c.y - primaryLead.y);
      if (drift > ABL_RADIUS) continue;  // must still hit primary
      let hits = 0;
      for (const el of leads) {
        if (Math.hypot(el.lead.x - c.x, el.lead.y - c.y) <= ABL_RADIUS) hits++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestPos = c;
      }
    }
    return bestPos;
  }
  const myLastPos = _s.myPrev[input.selfId];
  const myTickDisp = myLastPos
    ? Math.hypot(self.position.x - myLastPos.x, self.position.y - myLastPos.y)
    : SPEED;
  _s.myPrev[input.selfId] = { x: self.position.x, y: self.position.y };
  for (const b of input.bots) {
    if (b.alive) _s.prevPos[b.id] = { x: b.position.x, y: b.position.y };
  }
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
  const zone = input.zone;
  const zx = zone.centerX != null ? zone.centerX : (zone.center ? zone.center.x : 1024);
  const zy = zone.centerY != null ? zone.centerY : (zone.center ? zone.center.y : 1024);
  const zr = zone.radius || 1024;
  const distToCenter = Math.hypot(self.position.x - zx, self.position.y - zy);
  const pickupGravity = () => { let gx = 0, gy = 0; if (self.health < 15) return { x: 0, y: 0 };
    for (const p of (input.powerups || [])) {
      if (_s.pickupClaims[p.id] && _s.pickupClaims[p.id] !== input.selfId) continue;
      const need = p.type === 'health' ? Math.min(1, Math.max(0, (100 - self.health) / 60)) : Math.min(1, Math.max(0, (4 - ammo) / 4));
      if (need < 0.12) continue;
      const dx = p.position.x - self.position.x, dy = p.position.y - self.position.y, d = Math.hypot(dx, dy) || 1;
      if (d > 350) continue;
      if (Math.hypot(p.position.x - zx, p.position.y - zy) > zr - 50) continue;
      let safe = true; for (const e of enemies) if (Math.hypot(e.position.x - p.position.x, e.position.y - p.position.y) < 220) { safe = false; break; } if (!safe) continue;
      const mag = need * 3000 / (d * d); gx += (dx / d) * mag; gy += (dy / d) * mag;
    } return { x: gx, y: gy }; };
  const withGravity = (dir) => { const dm = Math.hypot(dir.x, dir.y) || 1; let g = pickupGravity(); const gm = Math.hypot(g.x, g.y); if (gm === 0) return dir; if (gm > 0.6) { g.x *= 0.6 / gm; g.y *= 0.6 / gm; } return { x: dir.x / dm + g.x, y: dir.y / dm + g.y }; };
  const navCenter = () => { const st = { x: zx - self.position.x, y: zy - self.position.y }; if (_s.navDrift) return st; const fd = flowDirAt(self.position.x, self.position.y); if (!fd) return st; const sm = Math.hypot(st.x, st.y) || 1, fm = Math.hypot(fd.x, fd.y) || 1; return ((fd.x * st.x + fd.y * st.y) / (sm * fm)) < 0.7 ? fd : st; };
  function zoneSmall() { return zr < 500; }
  function safeMove(dir) {
    const mag = Math.hypot(dir.x, dir.y);
    if (mag === 0) { _s.idleTicks[input.selfId]++; return { type: 'idle' }; }
    let nx = dir.x / mag;
    let ny = dir.y / mag;
    if (_s.navGrid) {
      const l1x = self.position.x + nx * SPEED;
      const l1y = self.position.y + ny * SPEED;
      const l2x = self.position.x + nx * SPEED * 2.5;
      const l2y = self.position.y + ny * SPEED * 2.5;
      if (!isPassable(l2x, l2y) || obstDist(l1x, l1y) <= 1) {
        const ba = Math.atan2(ny, nx);
        const offs = [0.4, -0.4, 0.8, -0.8, 1.2, -1.2];
        const outsideZone = distToCenter > zr;
        const hist = _s.moveHist[input.selfId];
        const prev2 = hist && hist.length >= 2 ? hist[hist.length - 2] : null;
        for (const off of offs) {
          const ax = Math.cos(ba + off), ay = Math.sin(ba + off);
          const t1x = self.position.x + ax * SPEED;
          const t1y = self.position.y + ay * SPEED;
          if (isPassable(t1x, t1y) && obstDist(t1x, t1y) >= 2) {
            if (outsideZone && Math.hypot(t1x - zx, t1y - zy) > distToCenter) continue;
            if (prev2 && Math.abs(ax - prev2.x) < 0.2 && Math.abs(ay - prev2.y) < 0.2) continue;
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
    if (distToCenter > zr) {
      dirs.sort((a, b) => {
        const da = Math.hypot(self.position.x + a[0] * SPEED - zx, self.position.y + a[1] * SPEED - zy);
        const db = Math.hypot(self.position.x + b[0] * SPEED - zx, self.position.y + b[1] * SPEED - zy);
        return da - db;
      });
    }
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
  if (distToCenter > zr && !terrainTrapped) {
    return safeMove(navCenter());
  }
  if (!_s.zoneRetreating[input.selfId]) _s.zoneRetreating[input.selfId] = false;
  if (distToCenter > zr - ZONE_BUFFER_EXIT) {
    _s.zoneRetreating[input.selfId] = true;
  }
  if (distToCenter < zr - ZONE_BUFFER_ENTER) {
    _s.zoneRetreating[input.selfId] = false;
  }
  if (zr < 700 && distToCenter > zr * 0.6) {
    _s.zoneRetreating[input.selfId] = true;
  }
  const nearZoneEdge = _s.zoneRetreating[input.selfId];
  const lateGame = tick > 600 || zoneSmall();
  const nearestEnemy = enemies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
  const nearestDist = dist(self, nearestEnemy);
  const lowHP = self.health < 30;
  const criticalHP = self.health < 15;
  if (terrainTrapped) {
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = clusterAim(nearestEnemy, 2);
      if (alliesInBlast(lead) <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    if (canAttack && nearestDist <= ATK_RANGE) {
      cd.atk = tick;
      return { type: 'attack', targetId: nearestEnemy.id };
    }
    if (!_s.navDrift) { const fd = flowDirAt(self.position.x, self.position.y); if (fd) return safeMove(fd); }
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
  if (_s.escLock[input.selfId]) {
    delete _s.escLock[input.selfId];
  }
  // ===== v62 GATED CC-MIRROR+FORAGE (non-CC never enters => byte-identical v60) =====
  if (VS_AGGRO) {
    // (A) AMMO IS EXISTENTIAL (melee + ability both need it). Low/dry -> fetch nearest in-zone ammo
    //     pickup over a LONG range; re-arming beats chasing toothlessly or huddling center.
    if (ammo <= 1 && powerups.length) {
      const reach = ammo === 0 ? 1100 : 600;
      let bestA = null, bestAD = Infinity;
      for (const p of powerups) {
        if (p.type !== 'ammo') continue;
        const pd = dist(self, p);
        if (pd > reach) continue;
        if (Math.hypot(p.position.x - zx, p.position.y - zy) > zr - 60) continue;       // in-zone
        if (p.expiresAtTick && tick + pd / SPEED + 5 > p.expiresAtTick) continue;       // reachable in time
        if (obstDist(p.position.x, p.position.y) < 2) continue;
        let onEnemy = false;
        for (const e of enemies) { if (dist(e, p) < 120) { onEnemy = true; break; } }   // don't walk onto an enemy
        if (onEnemy) continue;
        if (pd < bestAD) { bestAD = pd; bestA = p; }
      }
      if (bestA) return safeMove(dirTo(self, bestA));
    }
    // (B) opportunistic multi-hit; light reserve: hold the last single-target shot while 3+ enemies remain
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = clusterAim(nearestEnemy, 2);
      const multi = enemiesInBlast(lead) >= 2;
      // RULE: at distance fire ONLY if >=2 enemies in the splash (multi); single-target only when close. Endgame closes via converge, then fires close.
      if (alliesInBlast(lead) <= 1 && (multi || nearestDist < CC_CLOSE_FIRE)) { cd.abl = tick; return { type: 'ability', targetPosition: lead }; }
    }
    // (C) melee when adjacent
    if (canAttack && nearestDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: nearestEnemy.id }; }
    // (D) ENDGAME FINISH: numerically ahead + <=2 enemies + armed -> drop wide spacing, converge on
    //     the LOWEST-HP enemy and dispatch it (no AoE multi-hit risk at 1-2 enemies).
    if (allTeam.length > enemies.length && enemies.length <= 2 && hasAmmo) {
      const weakest = enemies.reduce((a, b) => a.health <= b.health ? a : b);
      return safeMove(dirTo(self, weakest));
    }
    // (E) health forage (attrition win-condition: highest total HP at timeout)
    if (self.health < 70 && powerups.length) {
      let bestP = null, bestPD = Infinity;
      for (const p of powerups) {
        if (p.type !== 'health') continue;
        const pd = dist(self, p);
        if (pd > MIRROR_FORAGE) continue;
        if (Math.hypot(p.position.x - zx, p.position.y - zy) > zr - 60) continue;
        if (p.expiresAtTick && tick + pd / SPEED + 5 > p.expiresAtTick) continue;
        if (obstDist(p.position.x, p.position.y) < 2) continue;
        let onE = false; for (const e of enemies) { if (dist(e, p) < 150) { onE = true; break; } }
        if (onE) continue;
        if (pd < bestPD) { bestPD = pd; bestP = p; }
      }
      if (bestP) return safeMove(dirTo(self, bestP));
    }
    // (F) critical HP: break off toward center + away from enemy
    if (criticalHP) {
      const c = navCenter(), cm = Math.hypot(c.x, c.y) || 1, aw = dirTo(nearestEnemy, self), am = Math.hypot(aw.x, aw.y) || 1;
      return safeMove({ x: (c.x / cm) * 0.7 + (aw.x / am) * 0.3, y: (c.y / cm) * 0.7 + (aw.y / am) * 0.3 });
    }
    // (G) movement: INDEPENDENT chase + WIDE ally repulsion (break the cluster CC multi-hits)
    const ch = dirTo(self, nearestEnemy), chm = Math.hypot(ch.x, ch.y) || 1;
    let mvx = ch.x / chm, mvy = ch.y / chm;
    for (const a of allies) {
      const d = dist(self, a);
      if (d > 0 && d < MIRROR_SPREAD) {
        const w = (MIRROR_SPREAD - d) / MIRROR_SPREAD;
        mvx += ((self.position.x - a.position.x) / d) * w * MIRROR_REPEL;
        mvy += ((self.position.y - a.position.y) / d) * w * MIRROR_REPEL;
      }
    }
    // (H) center-bias ONLY when the zone is small (zr<650): stay OUT foraging/fighting, don't huddle early.
    if (nearZoneEdge && zr < 650) {
      const c = navCenter(), cm = Math.hypot(c.x, c.y) || 1;
      mvx = mvx * 0.45 + (c.x / cm) * 0.55; mvy = mvy * 0.45 + (c.y / cm) * 0.55;
    }
    return safeMove({ x: mvx, y: mvy });
  }
  const needsAmmo = ammo <= 1;                // v43: tightened from <=2 (real need: can't cast)
  const needsHealth = self.health < 55;       // v43: tightened from <65 (real heal value)
  const timeoutMeta = tick > 600 && zr < 500;
  const pickupProximity = timeoutMeta ? 200 : 120;
  const doorstep = powerups.length > 0 && powerups.some(p =>
    Math.hypot(p.position.x - self.position.x, p.position.y - self.position.y) < pickupProximity
  ) && (self.health < 70 || ammo <= 2);
  // v56 B1: directional foraging — fire on TIME + useful pickup; per-pickup direction decides safety.
  const _numAdv = allTeam.length >= enemies.length + 2;
  const _myAllyDist = allies.length ? Math.min(...allies.map(a => dist(self, a))) : Infinity;
  const _lone = allies.length > 0 && _myAllyDist > 300;     // already isolated -> rally, don't wander
  const canForage = zr > 360 && tick < 1000 &&
    powerups.some(p => (p.type === 'health' && self.health < 85) || (p.type === 'ammo' && ammo < 4));
  if (powerups.length > 0 && (needsAmmo || needsHealth || doorstep || timeoutMeta || canForage)) {
    const enemyCx = enemies.reduce((s, e) => s + e.position.x, 0) / enemies.length;
    const enemyCy = enemies.reduce((s, e) => s + e.position.y, 0) / enemies.length;
    const selfToEnemies = Math.hypot(self.position.x - enemyCx, self.position.y - enemyCy);
    let bestPickup = null;
    let bestScore = -Infinity;
    for (const p of powerups) {
      if (_s.pickupClaims[p.id] && _s.pickupClaims[p.id] !== input.selfId) continue;
      const pDistZone = Math.hypot(p.position.x - zx, p.position.y - zy);
      if (pDistZone > zr - (zr > 550 ? 40 : 80)) continue;          // v57: shrink-aware margin
      const pDist = Math.hypot(p.position.x - self.position.x, p.position.y - self.position.y);
      const ticksToReach = pDist / SPEED;
      if (p.expiresAtTick && tick + ticksToReach + 5 > p.expiresAtTick) continue;
      if (obstDist(p.position.x, p.position.y) < 2) continue;       // v43 Gate A: clearance (not cornered)
      let minEnemyToPickup = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.position.x - p.position.x, e.position.y - p.position.y);
        if (d < minEnemyToPickup) minEnemyToPickup = d;
      }
      // v56 B1: DIRECTIONAL safety — if stepping toward the pickup raises nearest-enemy dist, it's a safe grab.
      const _ux = (p.position.x - self.position.x) / (pDist || 1), _uy = (p.position.y - self.position.y) / (pDist || 1);
      const _ndAfter = Math.hypot(self.position.x + _ux * SPEED - nearestEnemy.position.x,
                                  self.position.y + _uy * SPEED - nearestEnemy.position.y);
      const awayFromEnemy = _ndAfter > nearestDist;
      if (minEnemyToPickup < 120) continue;                  // never walk ONTO an enemy
      if (!awayFromEnemy) {                                  // toward-enemy: contest caution
        const _enTk = minEnemyToPickup / SPEED;
        if (_enTk < ticksToReach - 2) continue;
        if (_enTk <= ticksToReach + 2 && self.health < 40) continue;
        const pToEnemyCentroid = Math.hypot(p.position.x - enemyCx, p.position.y - enemyCy);
        if (pToEnemyCentroid < selfToEnemies * 0.55) continue;
      }
      if (_lone && pDist > 200) continue;                    // lone-safety: don't isolate (death_lone #1)
      const _allyNearP = allies.some(a => Math.hypot(a.position.x - p.position.x, a.position.y - p.position.y) < CONVERGE_RADIUS * 1.5);
      if (pDist > 360 && !_allyNearP && !_numAdv && !timeoutMeta) continue;  // far + would isolate -> skip
      const myMetric = (p.type === 'health') ? self.health : ammo;
      let skipForAlly = false;
      for (const a of allies) {
        if (Math.hypot(a.position.x - p.position.x, a.position.y - p.position.y) > 250) continue;
        const allyMetric = (p.type === 'health') ? a.health : (a.ammo !== undefined ? a.ammo : 999);
        if (allyMetric < myMetric) { skipForAlly = true; break; }
      }
      if (skipForAlly) continue;
      let score = 0;
      if (p.type === 'ammo' && needsAmmo) {
        score = 100 - pDist * 0.05;                                 // v59: TRAVEL for needed ammo (passed reachability/safety gates) - gentle dist penalty, no veto
        if (ammo === 0) score += 50;
      } else if (p.type === 'health' && needsHealth) {
        score = 140 - pDist * 0.05;                                 // v59: TRAVEL for needed health
        if (self.health < 35) score += 50;
      } else if (p.type === 'health' && timeoutMeta) {
        score = 150 - pDist * 0.2;
      } else if (canForage && ((p.type === 'health' && self.health < 85) || (p.type === 'ammo' && ammo < 4))) {
        score = (p.type === 'health' ? 45 : 35) - pDist * 0.15;   // v55: forage useful-but-not-critical, allow farther
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
      if (canAbility && nearestDist <= ABL_RANGE && pDist > 50) {
        const lead = clusterAim(nearestEnemy, 2);
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
  if (zr < 500) {
    const zoneCeiling = Math.min(zr * 0.9, 320);
    if (distToCenter > zoneCeiling) {
      if (canAbility && nearestDist <= ABL_RANGE) {
        const lead = clusterAim(nearestEnemy, 2);
        if (alliesInBlast(lead) <= 1) {
          cd.abl = tick;
          return { type: 'ability', targetPosition: lead };
        }
      }
      if (canAttack && nearestDist <= ATK_RANGE) {
        cd.atk = tick;
        return { type: 'attack', targetId: nearestEnemy.id };
      }
      return safeMove(navCenter());
    }
  }
  // v58 melee-pursuit: clearly AHEAD + healthy + ammo-dry + zone large + enemy reachable -> finish
  // survivors with free melee instead of huddling. Gated to grouped bots (ally<400u) -> lone-safe.
  if (ammo <= 1 && self.health > 40 && zr > 600 && allTeam.length >= enemies.length + 2
      && nearestDist <= ABL_RANGE && allies.some(a => dist(self, a) < 400)) {
    if (canAttack && nearestDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: nearestEnemy.id }; }
    return safeMove(dirTo(self, nearestEnemy));
  }
  if (ammo === 0 && !needsHealth) {
    const totalHP = allTeam.reduce((s, b) => s + b.health, 0) || 1;
    const teamCenter = {
      x: allTeam.reduce((s, b) => s + b.position.x * b.health, 0) / totalHP,
      y: allTeam.reduce((s, b) => s + b.position.y * b.health, 0) / totalHP,
    };
    const zoneW = zr < 400 ? 0.95 : (zr < 600 ? 0.80 : 0.65);
    const teamW = 1.0 - zoneW;
    const waitDir = {
      x: (teamCenter.x - self.position.x) * teamW + (zx - self.position.x) * zoneW,
      y: (teamCenter.y - self.position.y) * teamW + (zy - self.position.y) * zoneW,
    };
    if (nearestDist < 256) {
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
  function alliesInBlast(pos) {
    return allies.filter(a =>
      Math.hypot(a.position.x - pos.x, a.position.y - pos.y) <= ABL_RADIUS
    ).length;
  }
  // v54 CF-1: enemies a cast at `pos` would catch (mirrors clusterAim's hit test —
  // leadPosition(e,2), ABL_RADIUS — so enemiesInBlast(clusterAim(...)) == clusterAim's bestHits).
  function enemiesInBlast(pos) {
    let n = 0;
    for (const e of enemies) {
      const l = leadPosition(e, 2);
      if (Math.hypot(l.x - pos.x, l.y - pos.y) <= ABL_RADIUS) n++;
    }
    return n;
  }
  // v54 CF-1 gate: a single-target ability cast is worth it only if the enemy is OUT of melee
  // range (ranged poke) OR it lands a multi-hit (>=2). Single-hit at melee range -> melee wins.
  function abWorth(lead) {
    return nearestDist > ATK_RANGE || enemiesInBlast(lead) >= 2;
  }
  if (isStuck && canAbility && nearestDist <= ABL_RANGE) {
    const lead = clusterAim(nearestEnemy, 2);
    if (alliesInBlast(lead) <= 1) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: lead };
    }
  }
  if (distToCenter > zr - 50) {
    if (canAbility && !criticalHP && nearestDist <= ABL_RANGE) {
      const lead = clusterAim(nearestEnemy, 2);
      if (alliesInBlast(lead) <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    return safeMove(navCenter());
  }
  const closestAlly = allies.length > 0 ? allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b) : null;
  const allyDist = closestAlly ? dist(self, closestAlly) : 9999;
  const inAoEDanger = allyDist < HARD_SPREAD;
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
  const localEnemyCount = enemies.filter(e => dist(self, e) < 400).length;
  const survivalInstinct = tick > 10 && isolated && (localEnemyCount >= 2 || beingAttacked);
  if (!packFormed && allies.length > 0 && allTeam.length >= 3 && (nearestDist >= 300 || survivalInstinct)) {
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = clusterAim(nearestEnemy, 2);
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
    const myRingPos = _s.surroundActive && _s.ringPosition[input.selfId];
    if (myRingPos) {
      const ringDist = Math.hypot(self.position.x - myRingPos.x, self.position.y - myRingPos.y);
      if (ringDist < 50) {
        const sTarget = enemies.find(e => e.id === _s.surroundTargetId);
        if (sTarget) {
          const ang = Math.atan2(sTarget.position.y - self.position.y, sTarget.position.x - self.position.x);
          const orbOff = (input.botNumber * 1.31) - 2.62;
          const tDir = { x: sTarget.position.x - self.position.x, y: sTarget.position.y - self.position.y };
          const tMag = Math.hypot(tDir.x, tDir.y) || 1;
          return safeMove({
            x: Math.cos(ang + orbOff) * 0.29 + (tDir.x / tMag) * 0.71,
            y: Math.sin(ang + orbOff) * 0.29 + (tDir.y / tMag) * 0.71,
          });
        }
      }
      const zoneW = nearZoneEdge ? 0.35 : 0.15;
      const ringW = 1.0 - zoneW;
      return safeMove({
        x: (myRingPos.x - self.position.x) * ringW + (zx - self.position.x) * zoneW,
        y: (myRingPos.y - self.position.y) * ringW + (zy - self.position.y) * zoneW,
      });
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
  function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 300).length + 1;
    const nearEdge = Math.hypot(e.position.x - zx, e.position.y - zy) > zr - 100;
    const hpPriority = d < 300 ? (100 - e.health) * 6 : (100 - e.health) * 3;  // v35a: ×2 focus fire (was *3/*1)
    const distPenalty = d > 300 ? 200 : d * 0.1;
    const inPair = _s.enemyPairs.some(p => p.a.id === e.id || p.b.id === e.id);
    const pairBonus = inPair ? 20 : 0;
    let zonePenalty = 0;
    if (zr < 600 && distToCenter > zr * 0.55 && d > 0) {
      const toTgt = { x: e.position.x - self.position.x, y: e.position.y - self.position.y };
      const toZn = { x: zx - self.position.x, y: zy - self.position.y };
      const dot = toTgt.x * toZn.x + toTgt.y * toZn.y;
      const zoneDir = dot / (d * Math.max(distToCenter, 1));
      zonePenalty = Math.max(0, -zoneDir) * 40 * Math.min(1, (distToCenter - zr * 0.55) / (zr * 0.45));
    }
    return -hpPriority - alliesNear * 25 + distPenalty - (nearEdge ? 30 : 0) - pairBonus + zonePenalty;
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
  if (target && dist(self, target) > 700) {
    target = nearestEnemy;
  }
  if (!target) target = nearestEnemy;
  const targetDist = dist(self, target);
  if (canAbility && !criticalHP) {
    let bestPos = null;
    let bestScore = -999;
    let isMultiHit = false;
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
        isMultiHit = true;
      }
    }
    if ((!bestPos || bestScore < 1) && (ammoReserveOk || numericalAdvantage || survivalInstinct)) {
      if (nearestDist <= ABL_RANGE) {
        const lead = clusterAim(nearestEnemy, 2);
        if (alliesInBlast(lead) <= 1 && abWorth(lead)) {   // v54 CF-1: skip single-hit cast at melee range -> melee fallthrough below
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
      const lead = clusterAim(enemyOnWounded, 2);
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
  if (canAttack && targetDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: target.id }; }
  if (canAttack && nearestDist <= ATK_RANGE) { cd.atk = tick; return { type: 'attack', targetId: nearestEnemy.id }; }
  if (enemies.length <= 2 && (lateGame || allies.length === 0 || numericalAdvantage)) {
    const myDistToEnemy = dist(self, nearestEnemy);
    const closerAllies = allies.filter(a => dist(a, nearestEnemy) < myDistToEnemy);
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
      const lead = clusterAim(nearestEnemy, 3);
      if (alliesInBlast(lead) <= 1) {
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    if (closerAllies.length >= 2 && myDistToEnemy > 300) {
      const nearFighter = closerAllies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
      let convergeDir = dirTo(self, nearFighter);
      if (nearZoneEdge) {
        convergeDir.x = convergeDir.x * 0.59 + (zx - self.position.x) * 0.41;
        convergeDir.y = convergeDir.y * 0.59 + (zy - self.position.y) * 0.41;
      }
      return safeMove(convergeDir);
    }
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
    let chaseDir = dirTo(self, nearestEnemy);
    if (nearZoneEdge) {
      chaseDir.x = chaseDir.x * 0.59 + (zx - self.position.x) * 0.41;
      chaseDir.y = chaseDir.y * 0.59 + (zy - self.position.y) * 0.41;
    }
    return safeMove(withGravity(chaseDir));
  }
  if (_s.idleTicks[input.selfId] >= 10) {
    _s.idleTicks[input.selfId] = 0;
    return safeMove(navCenter());
  }
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
    if (survivalInstinct && allies.length > 0) {
      const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
      if (canAbility && nearestDist <= ABL_RANGE) {
        const lead = clusterAim(nearestEnemy, 2);
        if (alliesInBlast(lead) <= 1) {  // v33: add missing alliesInBlast check
          cd.abl = tick;
          return { type: 'ability', targetPosition: lead };
        }
      }
      const zoneW = nearZoneEdge ? 0.3 : 0.1;
      const allyW = 1.0 - zoneW;
      return safeMove({
        x: (nearestAlly.position.x - self.position.x) * allyW + (zx - self.position.x) * zoneW,
        y: (nearestAlly.position.y - self.position.y) * allyW + (zy - self.position.y) * zoneW,
      });
    }
    if (canAbility && nearestDist <= ABL_RANGE) {
      const lead = clusterAim(nearestEnemy, 2);
      if (alliesInBlast(lead) <= 1) {  // v33: add missing alliesInBlast check
        cd.abl = tick;
        return { type: 'ability', targetPosition: lead };
      }
    }
    return safeMove(dirTo(self, nearestEnemy));
  }
  if ((isolated || distToTeam > CONVERGE_RADIUS) && nearestDist > ATK_RANGE) {
    if (survivalInstinct && allies.length > 0) {
      const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
      const zoneW = nearZoneEdge ? 0.3 : 0.1;
      const allyW = 1.0 - zoneW;
      return safeMove({
        x: (nearestAlly.position.x - self.position.x) * allyW + (zx - self.position.x) * zoneW,
        y: (nearestAlly.position.y - self.position.y) * allyW + (zy - self.position.y) * zoneW,
      });
    }
    return safeMove({
      x: (teamCenter.x - self.position.x) * 0.61 + (target.position.x - self.position.x) * 0.39,
      y: (teamCenter.y - self.position.y) * 0.61 + (target.position.y - self.position.y) * 0.39,
    });
  }
  if (canAbility && targetDist > ATK_RANGE && targetDist <= ABL_RANGE) {
    const lead = clusterAim(target, 2);
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
    return safeMove(withGravity(moveDir));
  }
  const angle = Math.atan2(target.position.y - self.position.y, target.position.x - self.position.x);
  const orbitOffset = (input.botNumber * 1.31) - 2.62;
  const toTarget = dirTo(self, target);
  const mag2 = Math.hypot(toTarget.x, toTarget.y) || 1;
  let orbitMove = {
    x: Math.cos(angle + orbitOffset) * 0.29 + (toTarget.x / mag2) * 0.71,
    y: Math.sin(angle + orbitOffset) * 0.29 + (toTarget.y / mag2) * 0.71,
  };
  if (allyDist < HARD_SPREAD) {
    const sd = spreadDir();
    orbitMove.x = orbitMove.x * 0.71 + sd.x * 0.29;
    orbitMove.y = orbitMove.y * 0.71 + sd.y * 0.29;
  }
  return safeMove(withGravity(orbitMove));
}