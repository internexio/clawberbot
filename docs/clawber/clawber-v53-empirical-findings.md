# Clawber v53 — empirical analysis of 10 replays (archived 2026-06-01)

Measured from the event log (server v105, 10W-0L sample). Supersedes the speculative §0.

## §0 RESOLVED (matches this session's reconciliation)
zone (1024,1024) const; arena 2048 / cellWorld 32 (tileSize≈32); ability blast 150 / cast 700;
ammo exists, max 5, −1/shot. v53 baked constants all correct; ammo path live (keep). **Replay
carries `events[]` per frame** (`zone_shrink`, `ability{botId,targetPosition}`, `damage{attackerId,
targetId,damage}`, `kill`, `powerup_spawn`) → read events directly; don't infer from health deltas.

## §1 SAMPLE BIAS (critical) — these 10 can't validate terrain/pickup fixes
12–43s blowouts: 0/50 bot-lives lost, 0/10 reached late zone phase, mean dur 239t (~24s), TTFK
~tick 63, 0 pickups collected by anyone (55 spawned). Entrapment (36% of v44 losses) + pickup
starvation are long-match/zone-phase/wounded phenomena that NEVER occur here. **0% collection is
correct (gravity dormant when healthy), NOT a regression; 0 zone deaths ≠ terrain fix validated.**
→ To validate v53's late-game fixes, need long/loss replays (duration>400 OR deaths>0) — we have
**635 v44-era on disk**; v53-era long/loss must accrue.

## §2 What the sample DOES prove — dominant early-game kill machine
First kill ~6.3s, full wipe 12–43s; several opponents dealt us 0 damage all match; toughest
(Bastion_v2) got a bot to 5 HP / dealt 140 but still lost 5-0. **Damage mix 59% ability / 41%
melee.** The opening (surround + centralized focus lock + AoE burst) is the moat — do NOT slow it.

## §3 CF-1 CONFIRMED (hard numbers, from 200 casts)
| pattern | count | % |
|---|---|---|
| multi-target (≥2) | 54 | 27% |
| single/zero | 146 | 73% |
| **CF-1 (single hit while ≤256 of an enemy)** | **40** | **20%** |
| ROI (avg targets/cast) | **1.29** | (break-even ≈1.5) |
**A1 fix:** gate the single-target ability FALLBACK on `nearestDist > ATK_RANGE`. The ~106
single-target casts at range 256–700 are fine (ranged poke) — DON'T touch. Only the 40 melee-range
ones leak (ability 10dmg/30t vs 3 melee 15dmg). Free; reinforces the burst (raises melee uptime).

## §4 Terrain speed tiers recoverable from kinematics (ask #1)
Occupancy can't see slow tiers (bots traverse them, occupied = looks like ground). But speed caps at
`12/movementCost` → **max observed step per cell inverts to cost**: ~12 ground, ~8 slow(1.5×),
~6 very_slow(2×). Validated on the 10 (medians 12.0) but too open/short to map reefs (518/520 cells
read ground). **Run the max-step-per-cell estimator over the full 726-match/4.4M-position corpus →
three-tier terrain map** (strictly more info than binary occupancy) → cost-weighted nav field. (=B2)
`tier: cost≤1.15 ground | ≤1.7 slow | >1.7 very_slow; need ≥~20 move-samples/cell; full corpus.`

## §5 Ceiling (ask #4) not observable from wins — mine losses
All 10 are 5-0; the ~35% exec-tier ceiling isn't here. Opponents that dealt real damage still got
wiped 5-0. The "unmovable behaviorally" claim is unproven from wins — characterize from LOSSES: if
`bad_trade`/`focused` dominate loss-lift, CF-2 (trade gate) is a behavioral lever. Validate vs losses.

## §6 Revised priority (data-driven)
1. **CF-1 fix (A1) — ship next.** 2. Get long/loss replays (validate terrain+pickup; see ceiling).
3. Full-corpus kinematic 3-tier terrain map (B2). 4. Rewrite parser/loss-miner on `events[]`.
5. CF-2 trade gate (validate vs losses). Pickup-gravity tuning is un-evaluable here (gravity correctly never fired — no bot hurt enough); re-ask vs long/loss.
