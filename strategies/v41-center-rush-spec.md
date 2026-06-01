# v41 Center-Rush — Spec (DRAFT, not submitted)

## Origin

v40 CC analysis (n=20 losses across two batches) found the decisive variable is the
**early zone-center race**. Time-resolved zone distance (both teams alive, tick 20-120):

| Tick | Wins: we're more central by | Losses: we're more central by |
|---|---|---|
| 20 | +47u | tie (CC +29) |
| 40 | +53u | tie (CC +13) |
| 120 | +177u | +62u |

In wins, we win the center race from tick 20 decisively. In losses it's a dead heat,
CC stays central, and CC's late-phase ability dump (7.0 abilities/match vs 2.0 in wins,
146 dmg vs 68) comes from that retained central position.

## Hypothesis

If we deliberately win the zone-center race in the opening (tick 0-40) — positioning our
5 bots in a wide ring AT zone center rather than around an enemy — we convert the random
"did our spawn win the center race" into a deliberate edge, denying CC the central
position that enables their endgame surge.

## The change (destination-only, opening-only)

Replace the v40 surround-opener block with a center-ring opener:

- **Ring center:** zone center `(zx, zy)` — NOT an enemy position.
- **Ring radius:** 280u (bots sit 280u from center; adjacent bots ~329u apart — outside the
  150u AoE blast radius, so friendly-fire safe and AoE-resilient).
- **Ring assignment:** same greedy nearest-slot match as v40 (5 slots at 72° spacing,
  deterministic via sorted teamBotIds). Angle anchor: arbitrary fixed (e.g. 0 rad) since
  there's no enemy to orient away from.
- **Active window:** tick 0-40 (shorter than surround's 0-80 — the race is won by t40).
- **Override point:** same as v40 — the buddy-rally branch (line 743-767), ring destination
  replaces rally destination while active. All combat logic (ability/melee/spread/cluster-aim)
  unchanged.

## Expire conditions (any → revert to v37 buddy-rally)

- `tick >= 40` (window closed)
- `lostBot` (allTeam.length < 5 — cascade started, surround/ring is moot)
- `earlyDamage` (tick < 25 AND any bot < 50 HP — we got jumped, abort to combat)
- Enemy within ABL_RANGE of our ring AND we have a multi-hit available (let combat take over)

## Carried forward unchanged

cascadeTrigger (v37), clusterAim (v36), all v40 combat/targeting/terrain/pickup logic.
The ONLY diff from v40 is the opening destination: zone center ring vs enemy surround.

## What this is NOT

- NOT a constant zone-center pull on all movement (that's v27b/c/v31, proven dead ends).
  The ring is a fixed destination for ≤40 ticks, then normal logic resumes.
- NOT a turtle (we don't camp center the whole match; we engage normally after t40).
- NOT a targeting/aim change (nearestEnemy remains the aim target — avoids the v38/v39 DPS loss).

## Key risks (for KF review)

1. **Non-CC regression.** We are 100% vs non-CC. Several non-CC bots (CFJBot fleet) turtle
   AT center. Rushing center could walk our pack into their turtle, taking damage we currently
   avoid by engaging on our terms. This is the single biggest risk — non-CC dominance is the
   entire basis for holding #1.
2. **Re-discovering the zone-pull dead end.** Three prior attempts to add center-gravity failed.
   Is "opening-only destination" genuinely different, or the same mistake in a costume?
3. **Cause vs effect unproven.** The center-race correlation may be an EFFECT of winning
   (winners naturally end up central) rather than a cause. Forcing center may not transfer.
4. **CC also rushes center.** If both teams rush center, we collide at t20-30 in a tight
   space — exactly the formation-compression / AoE-multi-hit scenario that loses.

## Candidate alternatives for v41 (for strategist to rank)

- **A: Center-rush** (this spec)
- **B: Protect-weakest** — detect the bot taking focus fire, bias its movement away from the
  threat to delay first-death (the tick 70-90 cascade trigger). Movement-layer risk.
- **C: Hold v40, do nothing** — accept 53%, ride non-CC dominance. Current standing: #1, +85 ELO.
- **D: clusterAim multi-hit improvement** — we get 1.56-1.71 multi-hit, CC gets 1.67-1.89.
  3-way centroid search. Pure aim-quality, no movement change. Lowest blast-radius risk.
