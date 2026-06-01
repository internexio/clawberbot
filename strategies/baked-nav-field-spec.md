# Baked Nav-Field — design spec (Sunken Reef escape routing)

**Date:** 2026-06-01 · **Targets:** terrain entrapment ≈ 34% of losses (137 high-confidence stuck-into-zone deaths), opponent-independent — the top fixable lever ([[terrain-entrapment-loss-driver]]). **Supersedes:** v45/v46 runtime BFS (precomputes it; they become the drift fallback).

## Purpose
v44's terrain escape is **shallow** — bounded by the 50 ms/tick budget, it does local lookahead steering and oscillates against concave reef pockets (the `y=318` pin). The map is **static** (`sunken_reef`, all 726 matches). So the optimal escape routing can be **precomputed once, offline, with no runtime budget limit, and baked into the bot** as a constant the bot reads in O(1).

## Core idea — a center-ward flow field
The zone always collapses toward the arena center (~1024,1024). So for every passable cell, precompute the **first-step direction along the terrain-weighted shortest path to the central safe core**. A bot anywhere reads its cell → gets the globally-optimal next step toward safety, **routing around every reef** — no runtime BFS, no oscillation.

- Compute: terrain-weighted **Dijkstra** from the central safe region outward over the 64×64 passable grid → per-cell distance → per-cell flow direction (gradient descent on distance).
- Encode: 64×64 cells × 8-direction (3 bits) ≈ 1.5 KB; plus a 64×64 passability bitmap (512 B) for the drift hash. A few KB total — far under the 50 KB bot limit.

## PREREQUISITE — capture the EXACT grid (not the vision grid)
The baked field must use the **real** game terrain, or the bot routes into wrong/phantom obstacles. The vision-extracted grid (`scouting/sunken_reef-grid.json`) is good enough for *our analysis* (0.3% bot overlap) but **NOT** for baking a bot that paths on it. Capture the exact grid via a **one-time `say`-dump**: a throwaway bot version emits `input.tiles` (the exact 64×64 passability) across the early `say` messages; decode from that match's replay chat → exact grid. *[reckoning]*

## Bot integration (gated; combat untouched)
Use the flow field **only for center-ward / escape movement** — the existing `safeMove({x: zx-self.x, y: zy-self.y})` calls (zone retreat, terrain escape, regroup-toward-center). Replace "head straight at center" (which walks into reefs) with "follow the flow-field step toward center" (routes around them). **Do NOT** use it for combat chase/orbit (dynamic, not center-ward) — that stays v44. Triple-gate: (1) bot needs to move center-ward, (2) a reef lies between bot and center (flow dir ≠ straight-line dir), (3) on `sunken_reef` with drift-check passed. *[evaluative]*

## Drift detection + fallback *[predictive — assumes map may change]*
At tick 0, hash live `input.tiles.passable` and compare to the baked passability hash.
- **Match** → use baked flow field.
- **Mismatch (drift)** → fall back to v45/v46-style runtime BFS, AND emit `say:"MAPDRIFT"` (lands in replay chat → we detect offline and re-bake). Self-healing + monitored. Also re-screenshot the arena periodically and diff as a second drift signal.

## Build & validation pipeline
1. Capture exact grid (say-dump) → `maps/sunken_reef.tiles.json`.
2. Offline: Dijkstra → flow field → encode → bake constant into `bots/v51-baked-nav.js`.
3. **Faithful validation** (now possible with the exact grid — the vision-grid sim was inconclusive): re-run the escape micro-sim (`/tmp/escape_sim.mjs`) on the **137 entrapment positions** using the real grid; require the baked-nav bot to escape toward center where v44 oscillates. *[gate — do not ship if it doesn't unstick them]*
4. Diff-harness: confirm non-`sunken_reef` / drift path is byte-identical to v44 fallback.
5. Gated live ship → measure entrapment-death rate via `src/clawber/terrain_overlay.mjs` on fresh replays (expect the 34% to drop); revert on regression.

## Risk & reversibility
- **Not a movement-vector zone-pull** (the proven dead end). This is terrain *navigation* (the proven-good lever, v16e) made optimal+global; it improves center-ward pathing, doesn't blend a degrading force into combat.
- Drift-check fails safe to runtime BFS; v44 is the fallback. Fully reversible. *[high reversibility]*
- Residual risk: baked field wrong if capture/encode bug → mitigated by step-3 faithful validation gate + drift-check.

## Why this over just re-shipping v45/v46
v45/v46 do the BFS **at runtime** (budget-limited, can be shallow under load). Baking precomputes the **globally optimal** routing with zero runtime cost — strictly better given a static map. v45/v46's runtime BFS is retained as the **drift fallback**. (If capture/build proves heavy, a gated live re-ship of v46 is the faster interim — it already passed a 10W-0L gate.)
