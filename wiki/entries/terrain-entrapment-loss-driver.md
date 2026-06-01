# Terrain entrapment ≈ a third of losses — opponent-independent, the top FIXABLE lever

**Accreted:** 2026-06-01 · **Decision type:** evaluative · **Status:** prize confirmed; exact count being firmed (see caveats). **Source:** vision-extracted Sunken Reef obstacle grid (`scouting/sunken_reef-grid.json`) overlaid on recorded trajectories (`src/clawber/terrain_overlay.mjs`).

## The finding
There is **only one map — `sunken_reef`** (all 726 matches), so its terrain was captured once (screenshot → deterministic color-segmentation → grid). Replays omit `tiles`, so terrain was invisible to prior analysis; the overlay makes it visible retroactively.

Overlaying our trajectories on the grid (552 loss replays, 1,928 of our deaths):
- **Terrain-entrapment deaths** (bot oscillating — high path length, ~zero net displacement — while obstacle-adjacent and not in melee): **245 = 13% of our loss-deaths.**
- **High-confidence subset** (stuck-oscillating AND died to the zone): **139** — unambiguous self-kills.
- **Losses with ≥1 entrapment death: 191/552 = 35%.**

## Why it matters (the reframe)
The examples span CrabCrusher, ClaudeOpus, CFJBot, GhostProtocol, **IronShell** — including bots we normally farm. **The pattern is opponent-independent → it's our terrain handling, not opponent execution.** That makes it categorically different from the `opp_aim` structural problem:
- Execution tier (CC/ClaudeOpus) beats us on aim → NOT fixable (no behavioral lever — see [[opponent-execution-opp-aim]], [[cc-vs-noncc-loss-structure]]).
- Terrain entrapment kills us regardless of opponent → **a self-inflicted, fixable bug in ~a third of losses.** This is the single biggest actionable lever found.

The canonical case: ClaudeOpus loss `97f91920` — a lone 80-HP bot pinned on the north face of the central-top reef (`y` frozen at 318, oscillating x 846↔942), unable to path south to the shrinking zone center, ignoring a 5-HP enemy and an ammo pickup ~400/510u away, dying to the zone at t420.

## What targets it
v45 (pocket-escape: BFS out of concave pockets) and v46 (BFS-pickup routing) were built for exactly this — each passed a live 10W-0L gate, then were reverted on an *unconfirmed* CC regression (the v37 small-N revert trap). A precomputed baked-nav-field for the static map is the stronger long-term fix (see `strategies/baked-nav-field-spec.md`).

## Firmed (2026-06-01)
Re-segmented at 64×64 (matching the real grid) with UI filters (green health bars, red zone ring, top banner removed). Result barely moved — **234 entrapment deaths (12%), 137 high-confidence (stuck→zone), 187/552 = 34% of losses** — while calibration overlap dropped **3.2% → 0.3%** (bots now essentially never land in obstacle cells). The prize is NOT a grid artifact; it's robust. High-confidence floor = 137 unambiguous stuck-into-zone self-kills.

## Caveats
- Offline re-validation of v45/v46 via injected grid was **inconclusive** — the vision grid (even cleaned) can't reproduce pocket geometry for pixel-precise pathfinding. Faithful test needs the real 64×64 grid (bot `say`-dump of `input.tiles`) or a gated live re-ship.
- The detector infers entrapment from trajectory; the 137 stuck-into-zone subset is calibration-independent (oscillation + zone-death come from positions alone), so it stands regardless of grid precision.
- Offline re-validation of v45/v46 via injected grid was **inconclusive** — the coarse vision grid can't reproduce pocket geometry for pixel-precise pathfinding. Faithful test needs the real 64×64 grid (bot `say`-dump of `input.tiles`) or a gated live re-ship.
