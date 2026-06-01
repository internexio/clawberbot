# KnowledgeForge-CP Strategy Briefing: v39 Design

## What This Is

I'm building a competitive AI bot for **Clawber.ai**, a 5v5 bot arena. I need your help designing the next version of my targeting and coordination strategy. I'm currently **#2 on the leaderboard** (was #1 until a failed experiment), and my main rival is CrabCrusher-0308 (CC), who I'm 48% against head-to-head.

I have extensive replay data, analysis tooling, and 37 prior bot versions worth of lessons. I need a strategist to think through the v39 approach before I implement it.

---

## Game Rules

### Arena
- 2048 x 2048 unit playfield
- 120 seconds (1200 ticks at 10 ticks/second)
- 2 teams of 5 bots each (10 bots total)
- **Victory:** eliminate all enemy bots OR highest total HP at time limit

### Bot Stats
- **HP:** 100 per bot
- **Speed:** 12 units/tick
- **Ammo:** 5 per bot (25 total per team). Melee costs 1, ability costs 2.
- **Melee attack:** 256u range, 5 damage, 10-tick cooldown
- **Ability (AoE):** 700u cast range, 150u blast radius, 10 damage, 30-tick cooldown
- **Powerups:** spawn periodically, restore 35 HP or 3 ammo

### Battle Royale Zone
- Starts at ~1126u radius, shrinks to 300u over 80 seconds
- 3 HP/tick damage outside zone
- Center shifts slightly each phase

### Terrain
- Ground (normal speed), slow (2/3 speed), very_slow (1/2 speed), obstacle (impassable)

### Bot Code Constraints
- Each of 5 bots runs the same `update(input)` function independently
- They share a `_s` object (sandbox memory) for coordination
- 8 MB memory, 50ms decision time per tick, 50KB code size max
- No filesystem, network, or external API access
- Returns one action per tick: `move`, `attack` (melee), `ability` (AoE), or `idle`

### Input Available Per Tick
```
input.selfId      - UUID of this bot
input.teamBotIds  - Array of your 5 bot UUIDs
input.botNumber   - Index 0-4 (role assignment)
input.tick        - Current game tick (0-1200)
input.bots        - All bots: { id, position: {x,y}, health, alive, team }
input.zone        - { center: {x,y}, radius }
input.tiles       - Terrain grid
input.powerups    - Active powerup positions and types
```

**Key constraint:** You can see ALL bot positions and health on BOTH teams every tick. You can NOT see enemy ammo, cooldowns, or what action they're taking.

---

## Current Bot Architecture (v37, 43KB of 50KB limit = 7KB headroom)

### High-Level Code Flow (priority order — first match returns)
1. **Terrain escape** — if stuck on obstacle, BFS pathfind out
2. **Zone retreat** — if outside zone, move toward center
3. **Pickup collection** — if low ammo/health or near powerup, route to it
4. **Zone ceiling** — if zone small and near edge, push toward center
5. **Out of ammo** — stay with pack, wait for pickups
6. **Stuck handler** — fire ability if stuck
7. **Hard zone rule** — if very near zone edge, fire and retreat
8. **Buddy system** — if isolated from allies, rally to nearest ally (fire while moving)
9. **Pair detection** — find enemy pairs within 300u (for multi-hit AoE)
10. **HP-weighted target selection** — `scoreEnemy()` picks a team target, leader locks it for 17 ticks
11. **ABILITY-FIRST** — fire AoE at pair midpoints (multi-hit priority) or single target
12. **Soft spread** — if ally too close (<200u), spread out while attacking
13. **Distributed attack response** — if 3+ allies taking damage, converge to help weakest
14. **Melee assault** — melee the locked target or nearest enemy
15. **Endgame pursuit** — chase last enemies
16. **Movement** — approach target while staying near team center

### Key Mechanisms

**scoreEnemy() — Target Selection (line 734):**
```javascript
function scoreEnemy(e) {
    const d = dist(self, e);
    const alliesNear = allies.filter(a => dist(a, e) < 300).length + 1;
    const nearEdge = /* is enemy near zone edge */;
    const hpPriority = d < 300 ? (100 - e.health) * 6 : (100 - e.health) * 3;
    const distPenalty = d > 300 ? 200 : d * 0.1;
    const pairBonus = inPair ? 20 : 0;
    const zonePenalty = /* penalize targets away from zone center */;
    return -hpPriority - alliesNear * 25 + distPenalty - (nearEdge ? 30 : 0) - pairBonus + zonePenalty;
}
```
Lower score = better target. Factors: low HP (×6 close, ×3 far), allies nearby (×25 per ally), distance penalty (200 if >300u), pair bonus, zone penalty.

**Target lock:** Leader bot (sorted ID[0]) picks target every 17 ticks via scoreEnemy(). All bots read `_s.lockedTarget`. BUT: this target is only used for movement/chase — ability targeting uses `nearestEnemy` (per-bot, independent).

**clusterAim() — AoE Targeting (line 188):**
When 2+ enemies fit in one 150u blast radius, aims at their centroid instead of single target's predicted position. Never worse than baseline (falls back to single-target lead). Applied at 12 ability-fire sites.

**cascadeTrigger — Ammo Gate (line 147):**
```javascript
const cascadeTrigger = allTeam.length < 5 || (5 - enemies.length) >= 1;
const ammoReserveOk = cascadeTrigger ? ammo >= 2 : (ammo >= 4 || tick > 600);
```
Normally holds 4 ammo in reserve. When team size drops or we score a kill, relaxes to 2 ammo reserve. This was the v37 lever — matched CC's mid-cascade fire rate.

**Spread constants:**
- HARD_SPREAD = 200u (minimum ally distance — push apart if closer)
- SOFT_SPREAD = 260u (ideal spacing)
- These prevent AoE multi-kills on our team

---

## What We Know From Data (5700+ matches, 37 bot versions)

### CC-0308's Strategy (our main rival, ~48% h2h)
- **5 independent chasers** converging toward zone center
- **Ability-only** (zero melee usage)
- **Explicit coordinated fire:** 70-75% of ability volleys are aimed within 200u of each other
- **Reactive vulnerability targeting:** CC aims 77% of abilities at our LOWEST-HP bot
- **CC's multi-hit is superior:** 1.75-2.02 victims per ability hit vs our 1.57-1.67
- **CC fires from 700u** while many of our shots come from <500u (we chase closer)

### What Determines Win/Loss vs CC (from replay analysis, n=21)

**In our WINS:**
- Our first death: tick 75. CC first death: tick 67 (we kill them first)
- Our casts: 20.2. CC casts: 14.6 (CC dies before firing much)
- Our focus2%: 12.4%. CC focus2%: 7.6%
- Our 5-alive DPBT: 0.63. CC: 0.39 (we dominate opening)

**In our LOSSES:**
- Our first death: tick 79. CC first death: tick 106 (CC kills us 27 ticks earlier)
- Our casts: 18.4. CC casts: 21.6 (CC lives longer, fires more)
- Our focus2%: 7.4%. CC focus2%: 11.1%
- CC aimed 77% of pre-death abilities at our weakest bot

**Key finding:** Whoever gets first kill triggers a cascade — the surviving team has more firepower and snowballs. First kill is decided by tick 67-106. The opening 80 ticks decide the match.

### Proven Dead Ends (DO NOT suggest these)
1. **Movement-vector zone pulls** — 4 attempts, all regressed (v27b 75%, v27c 84%, v31 50%, v33 failed)
2. **Melee restrictions** — melee is load-bearing, removing it regresses (v35e 15% vs CC, v35d-D 77% ladder)
3. **Offensive focus-fire coordination** (v38) — we tried making all bots aim at the same scored target in the opening. Focus2% improved 7.4%→12.3% but we died 11 ticks EARLIER because it subtly tightened our formation, making us more vulnerable to CC's AoE multi-hits. **Offense alone doesn't work if it compromises defense.**
4. **Ammo gate tweaking without cascade awareness** — v35d failed, only v37's cascade-state gate worked

### What HAS Worked
1. **clusterAim()** (v36) — AoE centroid targeting. Changed WHAT we aim at. Multi-hit 1.25→1.73. Took us to #1.
2. **cascadeTrigger** (v37) — Ammo reserve relaxation after first kill. Changed WHEN we fire. +13pp vs CC.
3. **scoreEnemy() zone-aware targeting** (v32) — Changed which enemy to prioritize. First successful targeting change.
4. **All successful changes were DECISION layer** — changed what/when/which, never how-to-move.

---

## The v39 Hypothesis: Reactive Weakness Targeting + Defensive Awareness

### The Gap
CC targets our weakest bot (77% of abilities aimed at lowest-HP teammate). We don't — we target by proximity and ally-count, not by enemy vulnerability. In the opening when everyone is 100 HP, our scoreEnemy() is effectively random (no HP differential to exploit). 

CC's reactive targeting means: as soon as ANY of our bots takes damage, CC redirects fire to finish it off. We don't have this — we spread damage across healthy targets.

### What I Want v39 To Do
1. **Target the weakest enemy** — when an enemy drops below 100 HP, ALL our bots should prioritize it (reactive kill-securing, like CC does to us)
2. **Maintain defensive spacing** — HARD_SPREAD and SOFT_SPREAD must be preserved or slightly widened to prevent AoE multi-kills
3. **Don't cluster toward the target** — the v38 lesson: coordinating fire is good, but converging position is bad. We need to shoot at the same enemy WITHOUT all moving toward it
4. **Keep everything that works** — clusterAim(), cascadeTrigger, terrain escape, buddy system, pair detection

### Design Constraints
- **~7KB of code headroom** (43KB used of 50KB max)
- **Must be a DECISION change** — modify scoring, targeting, or state transitions. NOT movement vectors.
- **Triple-gate any behavioral change** — game phase, bot position, situation. If any gate fails, change does nothing.
- **Can use shared state** (`_s` object) for team coordination
- **5 bots run the same function** — coordination via shared state, not different code paths

### Specific Questions for the Strategist

1. **How should scoreEnemy() change?** Currently HP priority is `(100 - health) * 6` close, `* 3` far. Should we make this more aggressive? Add a "team is already shooting this target" bonus from shared state?

2. **Should ability targeting use the scored target instead of nearestEnemy?** v38 tried this and it subtly tightened formation. Can we use the scored target for AIMING but nearestEnemy for MOVEMENT to decouple offense from positioning?

3. **Should we track "who is attacking our weakest ally" and prioritize that enemy?** CC does this — they focus the bot killing our teammate. This creates a defensive focus-fire that doesn't require positional convergence.

4. **How do we prevent the v38 formation-tightening problem?** When all bots aim at the same target, they naturally drift toward it. Can we add a stronger spread force to counter this, or is there a way to coordinate fire without affecting movement?

5. **Should we detect CC's target and protect them?** If we can identify which of our bots CC is focusing (lowest HP), we could route that bot away from danger or have allies move to screen for it.

6. **What tick-range gate makes sense?** v38 used tick ≤ 120. Should reactive targeting apply all game, or only in specific phases?

7. **Can we improve our multi-hit rate?** CC averages 1.75-2.02 victims/hit vs our 1.57-1.67. Is there a better cluster-aim strategy, or is this a fundamental positioning difference?

### Available Measurements (from replay analysis tools)
- Per-tick bot positions, HP, alive status for all 10 bots
- Ability cast events with target positions
- Damage events with attacker/target IDs and amounts
- Death timing per bot
- Focus-fire density (% of ticks where 2+/3+/4+ bots target same enemy)
- Multi-hit rate (victims per ability hit)
- Damage per bot per tick by team size (DPBT)
- Aim error (distance from target position to actual victim position)
- Formation spread metrics

### Success Criteria
- CC h2h moves from 48% to 55%+ (Wilson CI lower bound > 45%)
- No ladder regression (maintain 100% vs non-CC)
- First-kill timing improves (our first death later, CC first death earlier)
- No formation-tightening side effect (spread metrics stable)

---

## What I Need Back

A concrete v39 design spec:
1. **Exactly what to change** in scoreEnemy() and ability targeting
2. **How to gate it** (tick range, conditions, fallbacks)
3. **How to avoid the v38 formation trap** (decouple targeting from positioning)
4. **What to monitor** in replays to verify it's working
5. **What the abort criteria should be**

Think through the trade-offs carefully. I'd rather ship a smaller, well-gated change that moves the needle 3-5% than an ambitious rework that regresses.

---

## Full Bot Source Code (v37-cascade-fire.js — complete, unedited, 1106 lines)

This is the exact code currently running on the server. Your design spec should reference specific line numbers and functions.

```javascript
/**
 * v37 Cascade-Fire — v36 base + cascade-aware ammo reserve gate
 *
 * Hypothesis (from analyze-cc-losses.py + damage-dropoff.py on n=13 v36-vs-CC losses):
 *   CC fires 12.6 abilities/match in losses; we fire 8.2 (-53%).
 *   CC DPBT spikes 0.80 -> 1.09 the tick after first kill; ours stays at 0.80.
 *   Our `ammoReserveOk = ammo>=4` holds reserve precisely when CC is mid-cascade.
 *   Cluster-aim is firing fine in losses (multi-hit 1.52, tight 38%) — mechanism intact.
 *   The bottleneck is not aim. It is fire rate during the 4-alive / post-first-kill window.
 *
 * Change (3 lines @ line 135):
 *   Drop ammo reserve floor from 4 to 2 when cascadeTrigger fires.
 *   cascadeTrigger = (teammate lost) OR (we scored first kill).
 *
 *   Before: ammoReserveOk = ammo >= 4 || tick > 600;
 *   After:  cascadeTrigger = allTeam.length < 5 || (5 - enemies.length) >= 1;
 *           ammoReserveOk = cascadeTrigger ? ammo >= 2 : (ammo >= 4 || tick > 600);
 *
 * Triple-gated:
 *   - Gate 1: cascade state (team shrank OR first kill scored)
 *   - Gate 2: ammo available (>= 2)
 *   - Gate 3: existing canAbilityCd cooldown
 *
 * Same-layer-safe (per v36-cluster-aim-success.md meta-lesson):
 *   Modifies a decision gate. Does not touch melee, movement vectors, or target selection.
 *
 * Untouched (proven load-bearing or proven dead-end):
 *   - clusterAim() (the v36 lever — still firing at 12 ability sites)
 *   - Movement vectors (v27b/c, v31, v33 all failed)
 *   - Melee usage (v35e, v35d-D both failed restricting melee)
 *   - scoreEnemy / target selection (v35c baseline holds 90%+ on ladder)
 *
 * Carried forward from v36 (unchanged):
 *   - clusterAim() at 12 ability targetPosition sites
 *   - HARD_SPREAD 200, SOFT_SPREAD 260, focus fire x2
 *   - Pre-existing pair-centroid block at line ~770
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
    // v16f: terrain escape state
    myPrev: {},
    dispRing: {},
    posRing: {},
    escLock: {},
    moveHist: {},     // v27 Fix 1: anti-ABAB direction tracking from v16e
    // v19: pickup claiming
    pickupClaims: {},
    claimTick: -1,
  };
}

function update(input) {
  const ATK_RANGE = 256;
  const ATK_CD = 10;
  const ABL_RANGE = 700;
  const ABL_RADIUS = 150;
  const ABL_CD = 30;
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

  if (enemies.length === 0) return { type: 'idle' };

  // === v19: AMMO TRACKING ===
  const ammo = self.ammo !== undefined ? self.ammo : 999;
  const hasAmmo = ammo > 0;
  const hasAbilityAmmo = ammo >= 2;

  // === v19: POWERUPS ===
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

  // -- Cooldown tracking --
  if (!_s.cooldowns[input.selfId]) {
    _s.cooldowns[input.selfId] = { atk: -999, abl: -999 };
  }
  const cd = _s.cooldowns[input.selfId];
  const canAttack = tick - cd.atk >= ATK_CD && hasAmmo;
  const canAbilityCd = tick - cd.abl >= ABL_CD && hasAbilityAmmo;
  // v37: cascade-aware ammo reserve.
  // Normal state (no kills yet, full team): keep v35c/v36 floor of 4 to avoid early dump.
  // Cascade state (teammate lost OR we scored first kill): drop floor to 2 to match CC's mid-cascade fire rate.
  // Late game (tick > 600) always unlocks regardless.
  const cascadeTrigger = allTeam.length < 5 || (5 - enemies.length) >= 1;
  const ammoReserveOk = cascadeTrigger
    ? (ammo >= 2 || tick > 600)
    : (ammo >= 4 || tick > 600);
  const canAbility = canAbilityCd;  // gates checked at call sites with ammoReserveOk

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
  // v36: cluster-aim — when 2+ enemies fit in one blast, return centroid instead of point.
  // Guarantee: result always within ABL_RADIUS of primary's lead (never worse than baseline).
  function clusterAim(primary, ticks) {
    const primaryLead = leadPosition(primary, ticks);
    if (enemies.length < 2) return primaryLead;
    let bestPos = primaryLead;
    let bestHits = 1;
    const leads = [];
    for (const e of enemies) {
      leads.push({ id: e.id, lead: leadPosition(e, ticks) });
      if (e.id !== primary.id) {
        const el = leads[leads.length - 1].lead;
        if (Math.hypot(el.x - primaryLead.x, el.y - primaryLead.y) <= ABL_RADIUS) {
          bestHits++;
        }
      }
    }
    for (const el of leads) {
      if (el.id === primary.id) continue;
      const sep = Math.hypot(el.lead.x - primaryLead.x, el.lead.y - primaryLead.y);
      if (sep > ABL_RADIUS * 2) continue;
      const mid = { x: (primaryLead.x + el.lead.x) / 2, y: (primaryLead.y + el.lead.y) / 2 };
      if (Math.hypot(mid.x - primaryLead.x, mid.y - primaryLead.y) > ABL_RADIUS) continue;
      let hits = 0;
      for (const other of leads) {
        if (Math.hypot(other.lead.x - mid.x, other.lead.y - mid.y) <= ABL_RADIUS) hits++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestPos = mid;
      }
    }
    return bestPos;
  }

  // v16f: Per-bot position tracking for terrain detection
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

  // v16f: Fast terrain trap detection
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

  // -- Zone (declared BEFORE safeMove so it can reference zx/zy/zr) --
  const zone = input.zone;
  const zx = zone.centerX != null ? zone.centerX : (zone.center ? zone.center.x : 1024);
  const zy = zone.centerY != null ? zone.centerY : (zone.center ? zone.center.y : 1024);
  const zr = zone.radius || 1024;
  const distToCenter = Math.hypot(self.position.x - zx, self.position.y - zy);

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
        // v27 Fix 1: Anti-ABAB — skip offsets that reverse 2-ago direction
        const hist = _s.moveHist[input.selfId];
        const prev2 = hist && hist.length >= 2 ? hist[hist.length - 2] : null;
        for (const off of offs) {
          const ax = Math.cos(ba + off), ay = Math.sin(ba + off);
          const t1x = self.position.x + ax * SPEED;
          const t1y = self.position.y + ay * SPEED;
          if (isPassable(t1x, t1y) && obstDist(t1x, t1y) >= 2) {
            // v22: When outside zone, reject alternatives that move further out
            if (outsideZone && Math.hypot(t1x - zx, t1y - zy) > distToCenter) continue;
            // v27 Fix 1: Reject if this reverses the direction from 2 ticks ago
            if (prev2 && Math.abs(ax - prev2.x) < 0.2 && Math.abs(ay - prev2.y) < 0.2) continue;
            nx = ax; ny = ay; break;
          }
        }
      }
    }

    const dx = self.position.x + nx * SPEED;
    const dy = self.position.y + ny * SPEED;

    // v27 Fix 1: Record move direction for anti-ABAB
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
    // v22: When outside zone, try zone-ward directions first
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

  // HARD ZONE: if outside, immediately return toward center
  // v21: SKIP when terrainTrapped — fall through to terrain escape handler
  if (distToCenter > zr && !terrainTrapped) {
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

  // v27 Fix 2: Proactive zone pull from v16e — start retreating before trapped
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

  // v35c: Opening burst removed — at spawn enemies are 600-1800u apart,
  // opening shots are single-target max-range into full-HP bots (worst efficiency).
  // Normal ability logic with ammoReserveOk handles early engagements.

  // ======================================================
  // v16f: Unified terrain escape — HIGHEST PRIORITY
  // ======================================================
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

  // ======================================================
  // v19: PICKUP COLLECTION — HIGH PRIORITY
  // v25 fix #3: Always pursue health pickups in timeout meta
  // v25 fix #4: Increase nearPickup radius to 200u in late game
  // ======================================================
  const needsAmmo = ammo <= 2;
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
        // v25 fix #3: In timeout meta, pursue health pickups at ANY HP
        score = 150 - pDist * 0.2;
      } else {
        score = 30 - pDist * 0.3;
      }

      // v25: Late game health boost applies in timeout meta too
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

  // ======================================================
  // v22: ZONE CEILING
  // ======================================================
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
      return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
    }
  }

  // v19: Out of ammo, stay with pack and wait for pickups
  if (ammo === 0 && !needsHealth) {
    const totalHP = allTeam.reduce((s, b) => s + b.health, 0) || 1;
    const teamCenter = {
      x: allTeam.reduce((s, b) => s + b.position.x * b.health, 0) / totalHP,
      y: allTeam.reduce((s, b) => s + b.position.y * b.health, 0) / totalHP,
    };
    // v25 fix #5: Stronger zone centering — win the pickup spawn race
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

  // Fire ability even while stuck
  if (isStuck && canAbility && nearestDist <= ABL_RANGE) {
    const lead = clusterAim(nearestEnemy, 2);
    if (alliesInBlast(lead) <= 1) {
      cd.abl = tick;
      return { type: 'ability', targetPosition: lead };
    }
  }

  // -- HARD ZONE RULE --
  if (distToCenter > zr - 50) {
    if (canAbility && !criticalHP && nearestDist <= ABL_RANGE) {
      const lead = clusterAim(nearestEnemy, 2);
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

  // -- Team info (HP-weighted center) --
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

  // v33: Survival Instinct — isolated bots under threat regroup instead of fighting
  const localEnemyCount = enemies.filter(e => dist(self, e) < 400).length;
  const survivalInstinct = tick > 10 && isolated && (localEnemyCount >= 2 || beingAttacked);

  // ======================================================
  // BUDDY SYSTEM — converge to nearest ally
  // v33: survival instinct overrides nearestDist gate — isolated bots always rally
  // ======================================================
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
    const hpPriority = d < 300 ? (100 - e.health) * 6 : (100 - e.health) * 3;  // v35a: ×2 focus fire (was *3/*1)
    const distPenalty = d > 300 ? 200 : d * 0.1;
    const inPair = _s.enemyPairs.some(p => p.a.id === e.id || p.b.id === e.id);
    const pairBonus = inPair ? 20 : 0;
    // v32: penalize targets that require chasing AWAY from zone center
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

  // ======================================================
  // ABILITY-FIRST — fire ability ASAP, with pair targeting
  // v27 Fix 3: Only fire single-target AoE when ammo reserves OK
  //   Multi-hit (2+ enemies) always fires — that's efficient ammo use
  // ======================================================
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

    // v27: Single-target only when reserves OK or numerical advantage
    // v33: survival instinct unlocks ammo — dying isolated bots fire freely
    if ((!bestPos || bestScore < 1) && (ammoReserveOk || numericalAdvantage || survivalInstinct)) {
      if (nearestDist <= ABL_RANGE) {
        const lead = clusterAim(nearestEnemy, 2);
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

  // ======================================================
  // ALL 5 BOTS: MELEE ASSAULT
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
  // ENDGAME PURSUIT
  // ======================================================
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
    return safeMove(chaseDir);
  }

  // -- ANTI-IDLE --
  if (_s.idleTicks[input.selfId] >= 10) {
    _s.idleTicks[input.selfId] = 0;
    return safeMove({ x: zx - self.position.x, y: zy - self.position.y });
  }

  // ======================================================
  // MOVEMENT
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
    // v33: survival instinct — flee to nearest ally when outnumbered, don't charge solo
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
    // v33: survival instinct — rally to nearest ally, not team center blend
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

    return safeMove(moveDir);
  }

  // In melee range, on cooldown: tight orbit
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

  return safeMove(orbitMove);
}

```
