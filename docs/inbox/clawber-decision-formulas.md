# Clawber Decision Formulas & Loss Mining

Companion to `clawber-analytics-pipeline.md`. Covers the real-time decision layer
(escape, pickup EV, engage/retreat) and the external loss-mining tool.
All in-bot code is deterministic and sandbox-safe (≤50ms/tick, errors → idle).

---

## 1. Escape geography — cached safety field

**Principle:** map is static within a match; the 5 bots share memory. Compute the
terrain-weighted distance-to-safety field ONCE per zone state, cache it, descend the
gradient per bot. O(cells) once, O(1) per tick. Routes around pits/pockets instead of
sliding into walls.

```javascript
// ---- shared, cached across the 5 bots and across ticks ----
const F = (globalThis.__F ||= { field: null, key: null, w: 0, h: 0, ts: 0 });

function buildSafetyField(tiles, zone) {
  const { width: w, height: h, tileSize: ts, passable, movementCost } = tiles;
  const N = w * h;
  const dist = new Float32Array(N).fill(Infinity);
  // multi-source: every passable cell whose center is inside the safe zone
  const margin = 1; // tiles of buffer inside the radius
  const heap = []; // [d, idx] — small grid, simple binary heap
  const push = (d, i) => { heap.push([d, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let s = c; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === c) break; [heap[s], heap[c]] = [heap[c], heap[s]]; c = s; } } return top; };

  for (let i = 0; i < N; i++) {
    if (!passable[i]) continue;
    const x = (i % w) * ts + ts / 2, y = Math.floor(i / w) * ts + ts / 2;
    const dc = Math.hypot(x - zone.centerX, y - zone.centerY);
    if (dc <= zone.radius - margin * ts) { dist[i] = 0; push(0, i); }
  }
  const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const cx = i % w, cy = (i / w) | 0;
    for (const [dx, dy] of nbr) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!passable[ni]) continue;
      const step = ts * (movementCost[ni] || 1); // terrain-weighted edge cost
      if (dist[i] + step < dist[ni]) { dist[ni] = dist[i] + step; push(dist[ni], ni); }
    }
  }
  return dist;
}

function safetyField(tiles, zone) {
  if (!tiles) return null;
  const key = Math.round(zone.radius / 32); // rebuild only when radius bucket changes
  if (F.field && F.key === key) return F.field;
  F.field = buildSafetyField(tiles, zone); F.key = key; F.w = tiles.width; F.h = tiles.height;
  return F.field;
}

const cellIdx = (x, y, tiles) => (Math.floor(y / tiles.tileSize)) * tiles.width + Math.floor(x / tiles.tileSize);

// follow gradient toward safety; bias away from enemy centroid (dynamic layer)
function escapeDir(self, tiles, zone, enemies) {
  const field = safetyField(tiles, zone);
  if (!field) return { x: zone.centerX - self.position.x, y: zone.centerY - self.position.y };
  const w = tiles.width, h = tiles.height, ts = tiles.tileSize;
  const ci = cellIdx(self.position.x, self.position.y, tiles);
  const cx = ci % w, cy = (ci / w) | 0;
  // enemy centroid for repulsion
  let ex = 0, ey = 0; for (const e of enemies) { ex += e.position.x; ey += e.position.y; }
  if (enemies.length) { ex /= enemies.length; ey /= enemies.length; }
  let best = null, bestScore = Infinity;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const ni = ny * w + nx;
    if (!tiles.passable[ni] || !isFinite(field[ni])) continue;
    const wx = nx * ts + ts / 2, wy = ny * ts + ts / 2;
    // primary: lower safety distance; secondary: farther from enemy centroid
    const threat = enemies.length ? -0.15 * Math.hypot(wx - ex, wy - ey) : 0;
    const score = field[ni] + threat;
    if (score < bestScore) { bestScore = score; best = { x: wx - self.position.x, y: wy - self.position.y }; }
  }
  return best || { x: zone.centerX - self.position.x, y: zone.centerY - self.position.y };
}

// urgency: are we going to eat zone damage before we can get out?
const SPEED = 12, ZONE_DPS = 3, SHRINK_TICKS = 800; // ~80s
function escapeUrgent(self, tiles, zone, tick) {
  const dc = Math.hypot(self.position.x - zone.centerX, self.position.y - zone.centerY);
  const field = safetyField(tiles, zone);
  const pathCost = field ? field[cellIdx(self.position.x, self.position.y, tiles)] : Math.max(0, dc - zone.radius);
  const exitTicks = (isFinite(pathCost) ? pathCost : dc) / SPEED;
  // linear shrink: radius drops ~ (1126-300)/800 per tick; ticks until radius passes us
  const shrinkRate = (1126 - 300) / SHRINK_TICKS;
  const ticksUntilExposed = dc <= zone.radius ? (zone.radius - dc) / shrinkRate : 0;
  return exitTicks >= ticksUntilExposed; // can't make it -> escape NOW
}
```

---

## 2. Pickup opportunity cost

Value falls linearly with terrain-weighted distance, hard-zeros at two cliffs
(unreachable in time, or enemy wins the 48-unit collection race). Benefit is capped
and marginal — a full-HP bot scores a health pickup at 0.

```javascript
const MAX_HP = 100, HEALTH_RESTORE = 35, AMMO_RESTORE = 3, COLLECT_R = 48;
const LOW_HP_GAIN = 1.5;   // urgency curve steepness
const TIME_COST = 0.30;    // value lost per tick of detour (tune integer→decimal)

// straight-line approx of terrain path cost; swap in field-based dist if budget allows
function travelTicks(a, b, tiles) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (!tiles) return d / SPEED;
  // sample movement cost along the segment (cheap, ~6 samples)
  let cost = 0, n = 6;
  for (let i = 1; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    const ci = cellIdx(x, y, tiles);
    cost += (tiles.movementCost[ci] || 1) / n;
  }
  return (d * cost) / SPEED;
}

function pickupValue(pu, self, enemies, tiles, tick) {
  let benefit;
  if (pu.type === "health") {
    const recoverable = Math.max(0, Math.min(HEALTH_RESTORE, MAX_HP - self.health));
    if (recoverable === 0) return -Infinity;
    const urgency = 1 + LOW_HP_GAIN * (1 - self.health / MAX_HP);
    benefit = recoverable * urgency;
  } else { // ammo
    const cur = self.ammo ?? 0;
    if (cur >= 5) return -Infinity;            // already stocked
    benefit = AMMO_RESTORE * (1 + (cur <= 1 ? 1.0 : 0)); // double value when nearly empty
  }
  const tt = travelTicks(self.position, pu.position, tiles);
  if ((pu.expiresAtTick - tick) <= tt) return -Infinity;          // CLIFF 1: unreachable in time
  // CLIFF 2: contest — closest alive bot within 48 collects
  for (const e of enemies) {
    if (travelTicks(e.position, pu.position, tiles) < tt) return -Infinity; // they win the race
  }
  return benefit - tt * TIME_COST; // linear decay in distance via tt
}

// choose: detour only if best pickup beats staying in the fight
function bestPickup(self, enemies, powerups, tiles, tick, combatValue) {
  let best = null, bestV = combatValue; // opportunity-cost baseline
  for (const pu of (powerups || [])) {
    const v = pickupValue(pu, self, enemies, tiles, tick);
    if (v > bestV) { bestV = v; best = pu; }
  }
  return best; // null => stay in fight
}
```

**"Value by distance" closed form (health):**
`value(d) = recoverable · (1 + k·(1 − hp/max_hp)) − (TIME_COST/SPEED)·d_terrain`,
valid only while `d_terrain/SPEED < (expiresAtTick − tick)` and you are the closest racer;
outside either bound, `value = 0`.

---

## 3. Engage / retreat — stop the suicides

Individual trade gate: equal-DPS 1v1 ends at `your_hp − their_hp`. Team gate: aimed-fire
concentration wins super-linearly, so compare squared local counts weighted by mean HP.

```javascript
const ATTACK_DPS = 0.5;        // 5 dmg / 10 ticks
const ABILITY_DPS = 0.33;      // 10 dmg / 30 ticks, when AoE lands
const CRIT_HP = 25;            // hard retreat floor
const ENGAGE_R = 320;          // "local" radius for force counting (range + buffer)

function selfDps(self) {
  let d = ATTACK_DPS;
  if ((self.ammo ?? 1) > 0) d += ABILITY_DPS * 0.5; // expected ability contribution
  return d;
}

// returns { action: "engage"|"retreat"|"finish", target }
function combatDecision(self, allies, enemies, tiles, zone) {
  if (!enemies.length) return { action: "retreat", target: null };

  // local force around me
  const near = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= ENGAGE_R;
  const allyLocal = allies.filter(a => near(a, self));
  const enemyLocal = enemies.filter(e => near(e, self));

  const meanHp = (arr, extra = 0) => (arr.reduce((s, x) => s + x.health, 0) + extra) / (arr.length + (extra ? 1 : 0) || 1);
  const myPower = Math.pow(allyLocal.length + 1, 2) * meanHp(allyLocal, self.health) * selfDps(self);
  const enPower = Math.pow(Math.max(1, enemyLocal.length), 2) * meanHp(enemyLocal) * ATTACK_DPS;

  const weakest = enemies.reduce((a, b) => a.health < b.health ? a : b);

  // FINISH: a kill is almost free and removes enemy DPS — take it even when behind
  if (weakest.health <= 10 && Math.hypot(weakest.position.x - self.position.x, weakest.position.y - self.position.y) <= 256)
    return { action: "finish", target: weakest };

  // HARD FLOOR: near-dead never walks into a healthier enemy
  if (self.health < CRIT_HP) {
    const onlyEnemyLeft = enemies.length === 1;
    if (!onlyEnemyLeft || weakest.health > self.health) return { action: "retreat", target: null };
  }

  // 1v1 trade gate: post-fight hp = my_hp - their_hp (equal dps)
  if (allyLocal.length === 0 && enemyLocal.length === 1) {
    return self.health > enemyLocal[0].health
      ? { action: "engage", target: weakest }
      : { action: "retreat", target: null };
  }

  // team fight: concentration heuristic
  return myPower >= enPower ? { action: "engage", target: weakest } : { action: "retreat", target: null };
}
```

Wire it: `retreat` → move along `escapeDir` toward the ally cluster (lowest field +
toward ally centroid); `engage`/`finish` → attack/ability/chase `target`. Converting a
losing 1v1 into a 2v1 by retreating toward allies is the highest-yield fix for the
"near-dead charging a full-HP enemy" pattern you're seeing.

---

## 4. External loss-mining tool

You already log match IDs in the experiment driver. Mine them: filter `won === false`,
parse replays, tag each of your bot deaths with a primary cause, then rank causes by
**lift over wins** — not raw frequency.

```javascript
const fs = require("fs");

// per-bot death classifier over the parsed tick rows of one match
function classifyDeaths(rows, myBotIds, zoneByTick) {
  const byBot = {};
  for (const r of rows) (byBot[r.bot_id] ||= []).push(r);
  const deaths = [];
  for (const id of myBotIds) {
    const seq = (byBot[id] || []).sort((a, b) => a.tick - b.tick);
    const di = seq.findIndex((r, i) => i > 0 && seq[i - 1].alive && !r.alive);
    if (di < 0) continue; // survived
    const death = seq[di], win = seq.slice(Math.max(0, di - 30), di);
    const z = (t) => zoneByTick[t] || zoneByTick[death.tick];

    const outside = win.filter(r => { const zo = z(r.tick); return zo && Math.hypot(r.x - zo.cx, r.y - zo.cy) > zo.radius; }).length;
    const posVar = variance(win.map(r => r.x)) + variance(win.map(r => r.y));
    const attackers = new Set(); // distinct enemies within 256 during window
    for (const r of win) for (const e of (r._enemiesInRange || [])) attackers.add(e);
    const ammoZero = win.some(r => r.ammo === 0);
    const engagedHealthier = death._engageTargetHpAtStart != null && death._engageTargetHpAtStart > (win[0]?.health ?? 100);

    let cause = "unknown";
    if (outside > win.length * 0.5) cause = "zone";
    else if (posVar < 50 && (win.at(-1)?.dmg_taken ?? 0) > 0) cause = "trapped";
    else if (attackers.size >= 2) cause = "focused";
    else if (ammoZero) cause = "starved";
    else if (engagedHealthier) cause = "bad_trade";

    deaths.push({ match_id: death.match_id, bot_id: id, death_tick: death.tick, cause });
  }
  return deaths;
}
const variance = (a) => { if (!a.length) return 0; const m = a.reduce((s, x) => s + x, 0) / a.length; return a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length; };

// aggregate lift: which causes/features are over-represented in losses vs wins
function liftReport(matches) { // matches: [{won, features:{focused:1,zone:0,...}}]
  const wins = matches.filter(m => m.won), losses = matches.filter(m => !m.won);
  const rate = (set, k) => set.length ? set.filter(m => m.features[k]).length / set.length : 0;
  const keys = [...new Set(matches.flatMap(m => Object.keys(m.features)))];
  return keys.map(k => {
    const pl = rate(losses, k), pw = rate(wins, k);
    return { feature: k, p_loss: +pl.toFixed(3), p_win: +pw.toFixed(3), lift: +(pl / (pw || 1e-6)).toFixed(2), n: losses.length };
  }).sort((a, b) => b.lift - a.lift);
}
```

```sql
-- duckdb equivalent over flattened match_features.jsonl
SELECT feature,
       AVG(CASE WHEN NOT won THEN present END)                                   AS p_loss,
       AVG(CASE WHEN won     THEN present END)                                   AS p_win,
       AVG(CASE WHEN NOT won THEN present END)
         / NULLIF(AVG(CASE WHEN won THEN present END),0)                         AS lift
FROM match_features
GROUP BY feature
HAVING SUM(CASE WHEN NOT won THEN 1 END) >= 30   -- enough losses to trust it
ORDER BY lift DESC;
```

**Read it:** the cause with the highest `lift × p_loss` is your dominant failure mode.
If `zone` tops it, tune `ZONE_EDGE_BUFFER` and ship the safety field. If `bad_trade`,
the engage gate in §3 is the fix. If `focused`, your formation is too loose — tighten
`FORMATION_SPACING` and retreat toward allies sooner.

---

## Note

The safety field (§1), the pickup contest race (§2), and the local-force gate (§3) all
reuse the same two primitives: terrain-weighted distance and local entity counts within
a radius. Compute both once per tick into shared memory and every formula reads from
them — keeps you well inside the 50ms budget and keeps the three decisions consistent
(escape, pickup, and engage all agree on where the threats are).
