# Clawber Bot Analytics & Tuning Pipeline

Reference spec for instrumenting, logging, and tuning a Clawber battle-royale bot.
Target consumer: Claude Code session. All decisions and rationale embedded.

---

## 0. Load-bearing constraints

| Constraint | Implication |
|---|---|
| **No network egress from sandbox** (8MB / 50ms / 50KB) | Cannot POST telemetry mid-match. Replay JSON is primary data source. |
| **`botVersion` carried on every match result** | Use it as the experiment key. Join outcomes → configs on `botVersion`. |
| **Ladder uses latest submission until you resubmit** | Each version naturally batches N matches at one config. Resubmit = advance sweep step. |
| **`say` channel: 60 chars, 1/20 ticks, per bot** | Only in-band channel. Use for tick-0 config stamp + end-of-match internal-counter digest. |
| **Shared sandbox memory across your 5 bots** | Accumulate team telemetry in module scope; each `botNumber` emits its own slice. |
| **Doc coordinate inconsistency** (pos 0–2048 vs zone center 4096 vs tiles 64×128) | Read arena bounds, zone, tile dims from tick 0 of first replay. Never hardcode. |

**Replay schema is undocumented.** Discover it: fetch one completed match's `replayUrl`, dump raw JSON, inspect, then write the parser against observed shape. The parser below is defensive against unknown structure.

---

## 1. Metrics catalog

### Outcome (the tuning labels — slow signal, high variance)
- `won` (bool), `placement` (1|2), `elo_delta`
- `team_survivors_end`, `team_health_end` (tiebreak driver)

### Combat / tempo (fast signal — tune on these first)
- `realized_dps` = `damage_landed / available_attack_windows` (theoretical max = 5 dmg / 10-tick window)
- `attack_landed_rate` = landed / attempted
- `ability_roi` = `avg_targets_hit_per_cast` (must be ≥2 to beat single-target DPS over its 30-tick cooldown)
- `ability_waste` = casts hitting 0 targets
- `overkill` = damage dealt to bots already at ≤0 HP
- `trade_ratio` = damage_dealt / damage_taken per engagement
- `cooldown_utilization` = attacks_made / attack_windows_available

### Spatial / grid (the levers your thresholds control)
- `occupancy_heatmap` — visits per grid cell (camping center vs edge-hugging vs getting cornered)
- `terrain_exposure` — ticks on `ground` / `slow` / `very_slow`; correlate slow-terrain time with deaths
- `stuck_rate` — failed-move events (position unchanged while `move` issued) → pathfinding quality
- `mean_dist_to_center` and `p90_dist_to_center` over the 80s shrink window
- `panic_moves` — large corrective vectors issued late in shrink (reactive, not anticipatory)
- `engagement_range_hist` — range bucket (point-blank / mid / 256-max) at moment of dealing/taking damage

### Macro / BR
- `survival_curve` — death tick by `botNumber` (which role dies first = role failure)
- `pickup_economy` — HP restored vs (zone + combat) damage taken; `contested_pickup_win_rate`
- `first_blood`, `last_alive` rates
- `time_to_first_contact`

---

## 2. Parameter taxonomy → metric it must move

Every knob is bound to the metric a sweep should read to judge it. These are your "divisible by 5/10" variables — listed with integer sweep ranges.

| Param | Default | Integer sweep | Metric it moves | Failure mode if wrong |
|---|---|---|---|---|
| `HEALTH_PICKUP_THRESHOLD` | 45 | 30–60 step 5 | HP restored, attrition deaths | Too high = wasteful detours; too low = die before topping up |
| `AMMO_PICKUP_THRESHOLD` | 1 | 0–3 step 1 | ability/attack uptime | Out of ammo mid-fight |
| `ZONE_EDGE_BUFFER` | 300 | 200–500 step 50 | ticks_outside_zone, zone deaths | Too small = zone chip damage; too large = passive, low kills |
| `ABILITY_MIN_TARGETS` | 1 | 1–3 step 1 | ability_roi | Wasting 30-tick cooldown on single targets |
| `TARGET_SELECTION` | lowest_hp | {nearest, lowest_hp, focus} | focus_fire_index, overkill, time_to_kill | Spreading damage = no kills |
| `PICKUP_CHASE_MAX_TICKS` | 4 | 2–10 step 2 | wasted_chase_rate | Chasing pickups that expire first |
| `FORMATION_SPACING` | — | 100–400 step 50 | AoE vulnerability vs your-AoE value | Clustered = eat enemy ability; spread = can't focus fire |
| `ROLE_SPLIT[botNumber]` | tank/4×dps | enumerate | per-role survival + damage | Wrong bot tanking |

**Coarse-to-fine rule:** Decimal precision is below the noise floor until a param's integer response curve is clearly monotone and the best region is localized. Only then refine to decimal *within that local region*. Decimals before that = fitting noise.

---

## 3. Tuning methodology

1. **Proxy-first.** Optimize continuous per-bot-per-tick metrics (DPS, ability_roi, ticks_outside_zone). Signal in ~10–30 matches/config because variance is low.
2. **Outcome-last.** Validate the proxy-winning config on `won`/`elo_delta`. Needs hundreds of matches to separate small win-rate gaps — do it once, on the finalist, not on every grid point.
3. **Control the opponent.** During tuning, queue with `opponentId` against one fixed baseline bot so config deltas aren't confounded by random opponent ELO. Reserve random ladder for final validation.
4. **One knob at a time (coordinate descent)** until interactions are suspected, then small joint grids. Full grid over 8 params is combinatorially hopeless; coordinate descent is the 80/20.
5. **Sample budget per config:** ≥30 matches for proxy ranking, ≥150 for win-rate confirmation. Record N so external analysis can weight by confidence.

---

## 4. Architecture

```
sweep plan ──▶ generate bot code (config baked as constants)
            ──▶ POST /bot/submit ──▶ botVersion
            ──▶ registry.jsonl: {botVersion, config_id, config, submitted_at}
            ──▶ accumulate matches (ladder auto, or N× queue w/ fixed opponentId)
poll heartbeat / GET match/{id} ──▶ completed matches (botVersion, stats, replayUrl)
            ──▶ fetch replayUrl ──▶ parse ──▶ rows tagged with botVersion+config_id
            ──▶ append to matches.jsonl + ticks.parquet  (offload dataset)
external analysis ──▶ regress metrics on config ──▶ next sweep step
```

`botVersion` is the join key end to end. No mid-match logging required.

---

## 5. Code

### 5a. In-bot config + telemetry (baked into submitted code)

```javascript
// ===== CONFIG (the swept variables — closest-integer pass) =====
const CFG = {
  id: "h45_z300_a1_tgt-lowhp",   // config_id — also stamped via say at tick 0
  HEALTH_PICKUP_THRESHOLD: 45,
  AMMO_PICKUP_THRESHOLD: 1,
  ZONE_EDGE_BUFFER: 300,
  ABILITY_MIN_TARGETS: 1,
  PICKUP_CHASE_MAX_TICKS: 4,
  TARGET_SELECTION: "lowest_hp", // nearest | lowest_hp | focus
};

// ===== SHARED TELEMETRY (module scope = shared across your 5 bots) =====
const T = (globalThis.__T ||= {
  branch: {}, attempts: 0, landed: 0, abilityCasts: 0, abilityTargets: 0,
  lastPos: {}, stuck: {}, started: false,
});
const bump = (k) => { T.branch[k] = (T.branch[k] || 0) + 1; };
const b36 = (n) => Math.min(n, 1295).toString(36).padStart(2, "0"); // 2-char cap

function update(input) {
  try {
    const self = input.bots.find(b => b.id === input.selfId);
    if (!self || !self.alive) return { type: "idle" };

    // tick-0 self-labeling stamp (belt-and-suspenders over botVersion join)
    let say;
    if (input.tick <= 1 && !T.started) { T.started = true; say = "cfg:" + CFG.id.slice(0, 55); }

    // stuck detection (failed move = pathfinding/terrain issue)
    const lp = T.lastPos[input.selfId];
    if (lp && Math.hypot(self.position.x - lp.x, self.position.y - lp.y) < 1) {
      T.stuck[input.selfId] = (T.stuck[input.selfId] || 0) + 1;
    }
    T.lastPos[input.selfId] = { x: self.position.x, y: self.position.y };

    const dc = Math.hypot(self.position.x - input.zone.centerX, self.position.y - input.zone.centerY);

    // --- zone safety ---
    if (dc > input.zone.radius - CFG.ZONE_EDGE_BUFFER) {
      bump("zone");
      return move(input.zone.centerX - self.position.x, input.zone.centerY - self.position.y, say);
    }

    // --- pickups ---
    const want = self.health <= CFG.HEALTH_PICKUP_THRESHOLD ? "health"
               : (self.ammo ?? 99) <= CFG.AMMO_PICKUP_THRESHOLD ? "ammo" : null;
    if (want) {
      const c = (input.powerups || []).filter(p => p.type === want);
      if (c.length) {
        const best = c.reduce((a, b) => d(a, self) < d(b, self) ? a : b);
        if (best.expiresAtTick - input.tick > CFG.PICKUP_CHASE_MAX_TICKS) {
          bump("pickup_" + want);
          return move(best.position.x - self.position.x, best.position.y - self.position.y, say);
        } else { bump("pickup_skip_expiry"); }
      }
    }

    // --- combat ---
    const teamIds = new Set(input.teamBotIds);
    const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));
    if (!enemies.length) { bump("idle_noenemy"); return { type: "idle", say }; }

    const target = pickTarget(enemies, self, CFG.TARGET_SELECTION);
    const dist = d(target, self);

    // ability if it would clear ABILITY_MIN_TARGETS in 150-radius
    if (dist <= 700) {
      const inAoe = enemies.filter(e => Math.hypot(e.position.x - target.position.x, e.position.y - target.position.y) <= 150).length;
      if (inAoe >= CFG.ABILITY_MIN_TARGETS) {
        T.abilityCasts++; T.abilityTargets += inAoe; bump("ability");
        return { type: "ability", targetPosition: { x: target.position.x, y: target.position.y }, say };
      }
    }
    if (dist <= 256) {
      T.attempts++; bump("attack"); // 'landed' confirmed from replay damage, not here
      return { type: "attack", targetId: target.id, say };
    }
    bump("chase");
    return move(target.position.x - self.position.x, target.position.y - self.position.y, say);
  } catch (e) {
    return { type: "idle" }; // sandbox-safe default
  }
}

function d(a, ref) { return Math.hypot(a.position.x - ref.position.x, a.position.y - ref.position.y); }
function move(dx, dy, say) { const a = { type: "move", direction: { x: dx, y: dy } }; if (say) a.say = say; return a; }
function pickTarget(en, self, mode) {
  if (mode === "nearest") return en.reduce((a, b) => d(a, self) < d(b, self) ? a : b);
  if (mode === "focus") { const m = self.__focus; if (m) { const f = en.find(e => e.id === m); if (f) return f; } const t = en.reduce((a, b) => a.health < b.health ? a : b); self.__focus = t.id; return t; }
  return en.reduce((a, b) => a.health < b.health ? a : b); // lowest_hp
}
```

> Optional end-of-match digest: near the final say window (tick ~1195) emit `b36(T.attempts)+b36(T.abilityCasts)+...` so the chat log in the replay carries internal counters the position/health stream can't show. Secondary — replay covers most of this.

### 5b. Experiment driver + registry (Node, out-of-band)

```javascript
const fs = require("fs");
const KEY = process.env.CLAWBER_KEY;
const BASE = "https://clawber.ai";
const H = { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" };

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: H, ...opts });
  if (r.status === 429) { const wait = +(r.headers.get("Retry-After") || 2); await sleep(wait * 1000); return api(path, opts); }
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function submitConfig(code, config) {
  const { version } = await api("/api/v1/bot/submit", { method: "POST", body: JSON.stringify({ code }) });
  fs.appendFileSync("registry.jsonl", JSON.stringify({
    botVersion: version, config_id: config.id, config, submitted_at: new Date().toISOString(),
  }) + "\n");
  return version;
}

// run N controlled matches vs a fixed baseline opponent (strips opponent variance)
async function runMatches(n, opponentId) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const body = opponentId ? JSON.stringify({ opponentId }) : "{}";
    const { matchId } = await api("/api/v1/match/queue", { method: "POST", body });
    ids.push(matchId);
    await sleep(13000); // <5/min rate limit
  }
  return ids;
}

async function collect(matchIds) {
  const out = [];
  for (const id of matchIds) {
    let m, tries = 0;
    do { m = await api(`/api/v1/match/${id}`); if (m.status !== "completed") await sleep(5000); }
    while (m.status !== "completed" && ++tries < 30);
    if (m.status === "completed") out.push(m);
  }
  return out;
}
```

### 5c. Replay discovery + defensive parser

```javascript
// STEP 1 (run once): discover the schema
async function dumpReplay(replayUrl) {
  const raw = await (await fetch(replayUrl)).json();
  fs.writeFileSync("replay_sample.json", JSON.stringify(raw, null, 2));
  console.log("top keys:", Object.keys(raw));
  return raw; // INSPECT THIS, then harden parseReplay() against observed shape
}

// STEP 2: parse to analysis rows. Defensive — handles tick-array OR frame-object shapes.
function parseReplay(raw, meta) {
  const frames = raw.ticks || raw.frames || raw.states || [];
  const rows = [];
  let prevHealth = {};
  for (const f of frames) {
    const tick = f.tick ?? f.t ?? rows.length;
    const bots = f.bots || f.entities || [];
    for (const b of bots) {
      const id = b.id ?? b.botId;
      const hp = b.health ?? b.hp ?? null;
      const dmgTaken = (prevHealth[id] != null && hp != null) ? Math.max(0, prevHealth[id] - hp) : 0;
      prevHealth[id] = hp;
      rows.push({
        match_id: meta.matchId, bot_version: meta.botVersion, config_id: meta.config_id,
        tick, bot_id: id, x: b.position?.x ?? b.x, y: b.position?.y ?? b.y,
        health: hp, alive: b.alive, action: b.action?.type ?? b.action ?? null,
        dmg_taken: dmgTaken,
      });
    }
  }
  return rows;
}

// per-match aggregate row (outcome labels)
function matchRow(m, cfg) {
  const me = m.participants.find(p => p.botVersion === cfg.botVersion) || m.participants[0];
  return {
    match_id: m.matchId, bot_version: cfg.botVersion, config_id: cfg.config_id,
    won: m.winnerId === me?.botId, placement: me?.placement,
    kills: me?.stats?.kills ?? null, damage_dealt: me?.stats?.damageDealt ?? null,
    completed_at: m.completedAt,
  };
}
```

### 5d. Offload dataset (analysis-ready)

Two files, joinable on `bot_version` → `config_id` via `registry.jsonl`:

- **`matches.jsonl`** — one row per match (outcome labels): `match_id, bot_version, config_id, won, placement, kills, damage_dealt`
- **`ticks.parquet`** (or jsonl) — one row per bot per tick: `match_id, bot_version, config_id, tick, bot_id, x, y, health, alive, action, dmg_taken`

Derive everything in §1 from these two tables downstream (pandas/duckdb). Keep raw replays in cold storage keyed by `match_id` so you can recompute new metrics without re-fetching.

---

## 6. Analysis recipe (external)

```sql
-- proxy-first ranking: realized DPS per config (fast signal)
SELECT config_id,
       COUNT(DISTINCT match_id)                         AS n_matches,
       SUM(CASE WHEN action='attack' THEN 1 END)        AS attacks,
       SUM(dmg_dealt) * 1.0 / NULLIF(SUM(windows),0)    AS realized_dps,
       AVG(CASE WHEN dist_to_center IS NOT NULL THEN ticks_outside END) AS ticks_outside_zone
FROM ticks JOIN registry USING (bot_version)
GROUP BY config_id
HAVING n_matches >= 30
ORDER BY realized_dps DESC;
```

Then: take top-3 proxy configs → run ≥150 random-ladder matches each → compare `won` rate with a two-proportion z-test → that finalist gets the decimal-refinement pass on its single most sensitive param.

---

## Pattern note

This is the third "tune variables from match data" framing in your work surface — it's a hyperparameter-optimization-over-a-black-box problem, structurally identical to the COS validation A/B phasing. Same template applies: **config registry keyed by an immutable version id, proxy metrics for fast iteration, outcome metrics for slow confirmation, controlled comparison to strip confounders.** Worth lifting into a reusable experiment-tracking module rather than rebuilding per game/product.
