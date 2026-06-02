# v61 CC-Mirror — Builder Spec (PDIA) + Critic

## Purpose
Break the ~35% CC structural floor (N=1146) by switching, **only vs CrabCrusher**, from our tight-pack
archetype to a **wide independent-chaser** archetype that mirrors CC's. Rationale + evidence:
- CC beats our pack on the **AoE multi-hit axis**: they hit **1.43 of our bots/cast vs our 1.10** (blast_colocation.mjs). This asymmetry IS the floor.
- Mirroring CC's width neutralizes that asymmetry → matchup regresses toward a ~50% mirror.
- We then hold a measured **zone/nav edge**: CC overstays the shrink **~5×** (0.61% vs 0.11% out-of-zone ticks) and **zone-dies ~10×** more (7.3% vs 0.5% of deaths) — zone_nav_edge.mjs. That tips a neutralized matchup **>50%**.
- All six prior CC levers this session were closed (spread/exposure/target-convergence/team-split/precision/first-shot); a **gated archetype** is the only path the evidence leaves open, and the standard "structural change risks non-CC base" objection is **void** because the gate makes non-CC byte-identical.

## Design
- **Gate:** `VS_CC = enemies.some(e => e.id.startsWith('edae262d-…'))` — CC's stable bot-id prefix (proven across 895 instances / 838 games non-CC-safe in v47/v49).
- **Placement:** branch inserted *after* the out-of-zone retreat (`distToCenter>zr → navCenter()`) and the `terrainTrapped` escape, *before* the pack/pickup logic. → the mirror **inherits our nav/zone discipline for free** and never falls through to pack tactics.
- **Mirror policy (self-contained, returns its own action):**
  1. Ability: `clusterAim(nearestEnemy)` when in `ABL_RANGE` + `alliesInBlast≤1` (keep v60 combat).
  2. Melee: when in `ATK_RANGE` (load-bearing, lesson #8).
  3. Critical HP: retreat = `navCenter()*0.7 + away-from-enemy*0.3`.
  4. Movement: **independent chase** of own `nearestEnemy` (unit) **+ wide ally repulsion** (`MIRROR_SPREAD=400`≈CC's 408u, weight `MIRROR_REPEL=1.0`) **+ zone-edge bias** to center when `nearZoneEdge` (preserve the edge).
- **Non-CC:** `VS_CC` false → entire branch skipped → byte-identical v60.

## Implementation
`bots/v61-cc-mirror.js`, 49179 B (<50KB; line comments stripped to fit, provenance in docs/history.md).
Constants `CC_BOT_PREFIX / MIRROR_SPREAD / MIRROR_REPEL`; `VS_CC` after `enemies`; branch after escLock cleanup.

## Assessment (validation)
- **Non-CC byte-identical:** 554,647 decisions, 0 divergence, 0 throws ✅ (gate-safety proven).
- **No throws:** 620K decisions total ✅.
- **Mirror engages vs CC:** 66.8% of decisions diverge (movement-dominated); combat actions mostly retained ✅.
- **Sane behavior:** sampled bot issues moves + abilities + melees, not degenerate fleeing ✅.
- **UNVERIFIABLE offline:** CC win-rate — replays have fixed v60-era positions, can't simulate CC reacting to our new width. **Live-gated test only.**

## Critic findings (severity-ranked)
- **[MEDIUM] Mirror skips foraging.** Branch returns before the pickup block → mirror bots don't collect health packs (35 HP). This **undercuts the zone-attrition thesis** (victory at timeout = highest total HP; the >50% edge depends on outlasting CC on HP). Fix options: (a) place branch after pickup block so it inherits foraging, or (b) add a health-pickup grab inside the mirror. Caveat: pack-tuned `_lone`/ally-convergence pickup gates may self-suppress foraging under wide spacing anyway.
- **[LOW] MIRROR_SPREAD/REPEL untuned** — calibrated to CC's 408u but repel weight is a guess; whether bots settle at ~400u vs oscillate is unverified offline. Tune in v2 if promising.
- **[LOW] Lost buddy/rally survival** — by design (independent archetype); a low-HP isolated mirror bot relies only on criticalHP center-retreat. May raise early picks.
- **[INFO] Core thesis unfalsifiable offline** — dominant uncertainty; the test IS the live gated CC run.

## Test plan
Submit → non-CC stays identical (ladder safe) → gather **CC-specific** WR to N≥40 → success = beat 35% floor (ideally >50%). Downside bounded (CC can't go much below the floor we accept); reversible to v60 in one resubmit.
