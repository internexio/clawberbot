# Post-mortem: v38, v39, v39b — Three Failed Approaches to Breaking 48% vs CC

**Date:** 2026-05-26
**Context:** SEMalytics is #2 at ~2170 ELO (was #1). CrabCrusher-0308 is #1 at ~2220. v37-cascade-fire is restored as active bot. All three experiments today failed to improve CC h2h from the 48% baseline.

**Purpose of this document:** Full findings for KF-CP review. Requesting strategic guidance on whether to attempt a fourth approach or accept the architectural ceiling.

---

## 1. The Three Experiments

### v38 — Coordinated Ability Targeting (sv87, 20h live)
**Hypothesis:** Our ability fire uses `nearestEnemy` per-bot (independent). CC coordinates 70-75% of volleys. If we use the existing `scoreEnemy()` + leader lock to aim abilities, we'll match CC's coordination.

**Change:** At ABILITY-FIRST single-target fallback (line ~800), for tick ≤ 120: fire at `target` from scoreEnemy()+lock instead of `nearestEnemy`. Fall back to nearestEnemy if target out of range.

**Results (n=9 vs CC): 3W-6L (38%)**

| Metric (losses) | v37 baseline | v38 | Direction |
|-----------------|-------------|-----|-----------|
| Our focus2% | 7.4% | **12.3%** | Improved (mechanism worked) |
| Our first death | tick 79 | **tick 68** | 11 ticks earlier (worse) |
| CC 4-alive DPBT | 0.62 | **1.30** | CC cascade 2x stronger |
| Our victims/hit (wins) | 1.61 | **1.45** | Multi-hit dropped |
| Aimed at top attacker | 32% | 36% | ~same (not ignoring threats) |

**Root cause analysis:**
- The coordination WORKED mechanically (focus2% up 67%)
- But coordinating aim subtly tightened formation — all bots orient toward the same target
- Tighter formation → CC's AoE multi-hits us more → earlier cascade → loss
- "Signal addition" pattern violated: this was actually a routing change (aim site read movement target)

**Diagnostic data collected:**
- 6 CC loss replays, 3 CC win replays in `match-history/v38-cc-*`
- Per-match: 3 losses had our focus at 14%, 18%, 20.7% while CC was 2.5-5.6% — we massively out-focused CC and still lost
- CC aimed 83% of abilities at our first-dead bot in 50 ticks before death (was 77% in v37)
- CC's behavior was identical between v37 and v38 — CC didn't change, WE got worse

### v39 — Reactive Weakness Targeting (sv89, 2h live)
**Hypothesis:** CC aims 77% of abilities at our lowest-HP bot (reactive vulnerability targeting). We don't. Adding `scoreEnemyForAim()` — HP-heavy variant used only at the ability-fire site — would let each bot independently aim at the weakest in-range enemy.

**Design (from full KF-CP chain: Expert → Strategist → Builder → Critic):**
- New function `scoreEnemyForAim(e)`: HP×12 (if <70HP) or HP×4 (if ≥70), no alliesNear, no nearEdge, no pairBonus, NaN guard
- Triple-gated: (1) any enemy <100HP, (2) weakest in ABL_RANGE, (3) no multi-hit pair found (`bestPos === null`)
- Per-bot, per-tick, no shared state — convergence from identical observations
- No movement coupling — aim only

**Results (n=4 vs CC): 1W-3L (25%)**

| Metric (losses) | v37 baseline | v39 | Direction |
|-----------------|-------------|-----|-----------|
| weak_aim_rate | ~25% (est) | **48-61%** | Mechanism fired |
| focus2% | 7.4% | **6.6%** | Back to v37 range (no clustering) |
| Our first death | tick 79 | **tick 59** | **20 ticks earlier** |
| Our 5-alive DPBT | 0.65 | **0.56** | Lower opening damage |
| formation spread | baseline | stable | No tightening (v38 trap avoided) |

**Root cause analysis:**
- The mechanism fired correctly (weak_aim 48-61%, no formation tightening)
- But redirecting shots from nearestEnemy to weakest-in-range costs opening DPS
- The weakest enemy is often NOT the nearest — it's farther away, making each shot less damage-efficient
- nearestEnemy is always the most damage-efficient aim target (closest = least travel time, best clusterAim positions)
- Damage margins were tight (475v485, 525v480, 480v525) but first-death at tick 59 is fatal

### v39b — Wider Spread Constants (sv91, 30 min live)
**Hypothesis:** Our formation (496u avg pairwise) is ~180u tighter than CC's (681u). When our spread <300u, CC hits 2.4 victims/cast. Widening HARD_SPREAD 200→250 and SOFT_SPREAD 260→310 should reduce CC's multi-hit advantage.

**Change:** Two constants. No logic changes.

**Results (n=3 vs CC): 1W-2L (33%)**

| Metric (losses) | v37 baseline | v39b |
|-----------------|-------------|------|
| Our total damage | ~470 avg | 375, 440 |
| CC total damage | ~480 avg | 495, 490 |
| Damage deficit | ~-10 | **-80 to -120** |

**Root cause:** Bots spend more time pushing apart and less time fighting. The DPS loss from wider spacing exceeds the multi-hit reduction.

---

## 2. Deep Diagnostic Findings

### 2.1 CC fires from CLOSER range than us

The pre-experiment scouting note said "CC fires from 700u." This was wrong.

| Metric | Us | CC |
|--------|----|----|
| Avg fire range | **342u** | **284u** |
| Fires <300u | 47% | **62%** |
| Fires 500-700u | **18%** | 2% |
| Opening (t0-29) | 473u | 367u |

CC is a close-range AoE brawler. They close fast and fire point-blank. We fire from farther because we converge slower (pack formation → buddy system → then engage).

### 2.2 Multi-hit gap is entirely formation-driven

| When CC fires at us | CC victims/cast | n |
|--------------------|----------------|---|
| Our spread <300u | **2.37-2.44** | 41-45 |
| Our spread 300-500u | **1.80-2.16** | 25-54 |
| Our spread 500+u | **1.55-1.68** | 58-85 |

CC's multi-hit advantage (1.87 vs our 1.56) comes from firing into our tight formation. When we're spread >500u, their multi-hit drops to our level. But our formation is tight BY DESIGN — it enables pack melee, buddy system, team convergence.

**Asymmetry:** CC's 5-chaser spread (681u) means we rarely catch 2+ of them per AoE. Their architecture is AoE-resilient; ours isn't.

### 2.3 Defensive positioning correlates with W/L

| Our weakest bot | Losses | Wins | Delta |
|----------------|--------|------|-------|
| Nearest enemy | 331u | 347u | +16u (farther in wins) |
| **Nearest ally** | **318u** | **249u** | **69u closer in wins** |
| **Exposed** (enemy closer than ally) | **53%** | **47%** | **6pp less exposed** |

When our wounded bot has an ally 69u closer, the match outcome flips. CC's weakest bot shows the inverse: 68% exposed when CC loses vs 51% when CC wins.

### 2.4 CC's targeting is identical regardless of our strategy

CC aimed 74-83% of abilities at our lowest-HP bot across all experiments. CC's code is fixed — their behavior doesn't adapt to our changes. The variable is always on our side.

---

## 3. Meta-Pattern Analysis

### What has worked (all-time)
| Version | Change type | What changed | Layer | Result |
|---------|-----------|--------------|-------|--------|
| v32 | Signal addition | Zone-aware penalty in scoreEnemy | Target scoring | 92% ladder |
| v36 | Signal addition | clusterAim() centroid at existing aim sites | AoE targeting | Took #1 |
| v37 | Signal addition | cascadeTrigger gate at existing fire site | Ammo gating | +13pp vs CC |

### What has failed (2026-05-26)
| Version | Change type | What changed | Layer | Result | Why |
|---------|-----------|--------------|-------|--------|-----|
| v38 | Routing change | Aim reads movement target | Aim site | 38% | Formation tightened |
| v39 | Targeting redirect | Aim reads HP-scored target | Aim site | 25% | DPS loss (farther target) |
| v39b | Constant change | HARD_SPREAD wider | Spread params | 33% | DPS loss (less fighting time) |

### The pattern
**Every successful change added a NEW SIGNAL at an EXISTING decision site without changing what the site READS.**
- v32: added zone penalty to scoreEnemy (new term in existing formula)
- v36: added cluster detection to existing aim output (new calculation, same call site)
- v37: added cascade state to existing ammo gate (new condition, same gate)

**Every failed change REDIRECTED an existing signal or changed WHAT the site reads.**
- v38: ABILITY-FIRST read `target` instead of `nearestEnemy` (changed what site reads)
- v39: ABILITY-FIRST read `weakestInRange` instead of `nearestEnemy` (changed what site reads)
- v39b: Spread logic read a larger constant (changed parameter)

**Implication:** nearestEnemy is load-bearing at the aim site. It's not just convenient — it's optimal. The nearest enemy is the highest-DPS target because: (a) shortest ability travel time, (b) best clusterAim centroids (nearby enemies cluster spatially), (c) no wasted approach movement.

---

## 4. The Structural Question

### Is 48% vs CC the architectural ceiling?

**Evidence for "yes":**
- Three orthogonal approaches (coordination, reactive targeting, spread) all failed
- CC's multi-hit advantage (1.87 vs 1.56) is structural (their spread vs our pack)
- nearestEnemy is provably optimal at the aim site — no redirect improves DPS
- CC's reactive targeting (77% on our weakest) is effective but when we copied it (v39), it hurt us
- The W/L difference is ally-proximity to wounded bot (249u wins vs 318u losses) — hard to control without movement changes, which are a proven dead end

**Evidence for "no":**
- We haven't tried defensive approaches (protecting wounded bot, screening)
- cascadeTrigger has room for tuning (currently fires 93% of match)
- clusterAim could potentially be improved (3-way centroids, wider search)
- CC's total damage (480-495) barely exceeds ours (440-475) — margins are razor-thin
- The game rules could change at any time (balance patch would reset everything)

### Remaining untested levers

1. **Protect our weakest bot (defensive):** Detect CC's focus target (lowest HP ally), route that bot toward nearest ally. Risk: movement-layer change. But it's DEFENSIVE movement (flee toward safety) not offensive (chase target). Different mechanism than the proven-dead-end category.

2. **More aggressive cascadeTrigger:** Current gate fires for 93% of a typical match (any bot dead on either side). Could test tighter windows — e.g., only relax for 60 ticks after first kill, or only when HP-ahead.

3. **Improve clusterAim:** CC hits 1.75-2.02 victims on us partly because we're tighter, but also possibly because their centroid calculation is better. Our clusterAim only considers 2-bot centroids. A 3-way centroid search might find higher multi-hit positions.

4. **Accept 48% and grind:** Hold #1/#2 via 100% vs non-CC. The ELO system means winning 45% of auto-ladder (which are all CC) while winning 100% of nightwatch (non-CC) produces a slow but steady ELO edge. The math: if 45% of matches are CC at ~48% WR and 55% are non-CC at ~100% WR, overall WR is ~76%, which is ELO-positive.

---

## 5. New Hypothesis: Surround Formation ("Ring of Fire")

After the three failures, we realized the core tension: **we need focused fire on one target AND spread to avoid AoE multi-hits, simultaneously.** These seem contradictory — but only if all bots approach from the same direction.

### The idea

Instead of rallying into a pack and THEN approaching a target (current v37 behavior), skip the rally and send each bot on a direct intercept course from a different angle around the most vulnerable CC bot.

```
Current v37 opening:                 Proposed surround:

  1  2                                  1
  3      →  rally to pack  →  12345     ↓  ↙
  4  5         (tick 0-40)     →→→T   2→ T ←5    each bot takes a different
              then approach            ↗  ↑      angle toward the target
              from ONE side          3    4
```

### Supporting data

**First CC death in our wins correlates perfectly with spawn isolation:**

| Match | First CC death | Was most-isolated bot? | Was closest to us? |
|-------|---------------|----------------------|-------------------|
| 07b8af4f | bot#3 at tick 82 | Yes | Yes |
| 333ae053 | bot#0 at tick 44 | Yes | Yes |
| 37d8a719 | bot#0 at tick 47 | Yes | Yes |
| 4191d84a | bot#0 at tick 57 | Yes | Yes |
| 6f11d0b4 | bot#1 at tick 59 | Yes | Yes |

5/5 — every win, the first CC kill is the bot that was both most isolated from CC allies AND closest to our team at spawn. This is the natural target for a surround.

**Approach timing:**

| Metric | Our Losses | Our Wins |
|--------|-----------|----------|
| Ticks to reach closest CC | 80 | **74** |
| Ticks to reach most-isolated CC | 97 | **79** |
| Our spawn spread | 1088u | 1135u |

In wins, the target is reachable 6-18 ticks faster. The surround would aim to exploit this by skipping the 40-tick rally phase and going direct.

**Kill math:** 5 bots × 2-3 abilities during 74-tick approach (30-tick cooldown) = 10-15 ability casts × 10 damage = 100-150 damage. CC bot has 100 HP. Even at 60% hit rate, that's a guaranteed kill before tick 80.

### Why this is different from the three failures

| Experiment | Why it failed | Why surround avoids it |
|-----------|--------------|----------------------|
| v38 (coordinated aim) | Formation tightened — all bots converge from same direction | Bots approach from 72° angles — spread is natural |
| v39 (reactive weakness) | Redirected fire to farther target — lost DPS | Target IS nearestEnemy once in range (bots surround it) |
| v39b (wider spread) | Less fighting time — DPS dropped | Spread maintained by approach angle, not by pushing apart |

**Key insight:** v38 tightened formation because coordination + same-direction approach = convergence. Surround achieves coordination + multi-direction approach = maintained spread.

### Why this is NOT a "movement change" (the dead-end category)

The dead ends (v27b/c, v31, v33) all BLENDED zone-center pull into movement VECTORS — changing the physics of how bots move at every tick. The surround changes the movement DESTINATION during the opening rally phase (first ~80 ticks only), then hands off to existing combat logic. `safeMove()` is completely untouched.

More precisely: the current buddy system's rally destination is "nearest ally." The surround changes it to "assigned position around target." Same movement mechanics, different strategic goal.

### Implementation sketch

1. **Tick 0:** Snapshot all positions. Identify the CC bot that is both most-isolated (nearest CC ally is far) AND closest to our team center.
2. **Assign approach angles:** botNumber 0-4 → 0°, 72°, 144°, 216°, 288° around the target. Each bot's rally point is ~300u from the target at their assigned angle.
3. **Opening phase (tick 0 to ~80):** Replace buddy-system rally with "approach your assigned position." Fire abilities at the target when in range (it's nearestEnemy for most bots). Melee still fires at nearestEnemy (unchanged).
4. **Transition:** Once the target dies OR tick > 80, existing v37 logic takes over completely. Pack formation, buddy system, all normal.
5. **Abort:** If the target moves far from predicted position (>400u from original spot), abandon the surround and fall back to v37 rally.

**Code budget:** ~60-80 lines (~2KB). Well within 7KB headroom.

**Triple-gated:**
- Gate 1: tick < 80 (opening phase only)
- Gate 2: target still alive and within reachable distance
- Gate 3: abort if our bot count drops (we're losing the opening — don't commit to a failing surround)

### Risks

1. **Skipping buddy rally = isolated bots.** During approach, each bot is alone. CC could pick off a straggler. Mitigation: bots still fire abilities at target while approaching (deterrence), and approach takes ~74 ticks (fast).
2. **Target moves.** CC bots converge toward center. If the target moves toward CC allies, the surround collapses. Mitigation: abort gate at 400u deviation.
3. **Wrong target.** If the most-isolated CC bot is actually behind obstacles, the approach path is bad. Mitigation: use navGrid passability check at tick 0.
4. **Regression vs non-CC.** Non-CC opponents have different formations. Mitigation: the surround target selection naturally picks a vulnerable enemy regardless of opponent — isolated + close is always good.

---

## 6. What I Need from KF-CP

### On the postmortem:

1. **Is the "nearestEnemy is optimal at aim site" conclusion correct?** Or is there a subtlety we're missing — e.g., nearestEnemy is only optimal given the current single-direction approach?

2. **Is the formation paradox (tight = DPS but vulnerable, wide = safe but low DPS) truly unresolvable within the current architecture?** Or does the surround formation break the paradox?

### On the surround proposal:

3. **Does the surround formation fall into the "movement change" dead-end pattern, or is it genuinely a different category?** The argument for different: it changes rally DESTINATION, not movement VECTORS. safeMove() untouched. The argument against: it still changes WHERE bots go, which downstream affects formation geometry.

4. **Is the "skip buddy rally" risk acceptable?** The buddy system exists because isolated bots get picked off. Skipping it for 80 ticks is a significant commitment. What mitigations beyond the abort gate would you recommend?

5. **Should the surround formation persist past first kill, or hand off immediately to v37?** If the surround gives us positional advantage (spread around the enemy team), maintaining it past first kill could compound. But it also couples to movement layer longer.

6. **Is there a way to achieve the surround effect WITHOUT replacing the buddy rally?** E.g., modify scoreEnemy to heavily prefer the isolated CC bot so the existing target-lock + movement system naturally creates a converging approach — just from different directions because bots are already spread at spawn.

7. **What's the abort criteria?** The postmortem showed n=3 is too small for CC h2h. Should we require n=15 before concluding on the surround approach?
