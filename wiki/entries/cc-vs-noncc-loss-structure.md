# CC losses have no fat exploitable cause; non-CC losses do (N=970)

**Accreted:** 2026-06-01 · **Source:** EPIC-3 lift report over the offload backfill (`src/clawber/{backfill,report,analyze}.mjs`). **Corpus:** 970 matches (166 vs CrabCrusher, 804 non-CC), authoritative win/loss via `winner` botId. **Decision type:** evaluative. **Staleness:** valid for v40–v49-era bots; re-run after any architecture change or CC resubmission.

## Method
Per-match boolean features (5 death-causes from `mining/deaths.mjs` + 8 thresholded metrics). Lift = `P(feat|loss)/P(feat|win)`, ranked by `lift × p_loss`, with a per-feature support guard (min 5 in each class) so single-cell flukes can't top the ranking. Split ALL / vs-CC / non-CC.

## Robust findings (position/health-derived — reliable)

1. **Non-CC losses are dominated by FIXABLE decision-layer causes:** `bad_trade` lift 6.0, `first_death_early` 7.0, `lost_first_blood` 5.0, `focused` 4.4 (`behind_at_150` 14 is downstream/tautological — discount). These are engage/retreat + focus-fire problems → the spec's **engage/retreat gate (decision-formulas §3) is a high-EV general lever** that protects the #2-holding floor (804 of 970 matches are non-CC).

2. **CC losses have THIN, mostly non-actionable lift:** the same features sit at 1.0–1.7 vs CC — `bad_trade` 1.08 (≈flat), `focused` 1.18 (≈flat, present in 81% of CC *wins* too). Only `lost_first_blood` (1.7) and downstream `behind_at_150` (3.6) discriminate. **Quantitative support for the ~35% structural floor: CC beats us without a single exploitable failure mode.**

3. **Tighter formation correlates with CC WINS** — `mean_spread` win 432 vs loss 513; `spread_tight` lift 0.62. The "widen vs CC" hypothesis is not neutral, it's **backwards**. Reconfirms v39b's failure at N=166. → **Anti-pattern: do not widen spread vs CC.**

4. **Reducing damage TAKEN is the bigger CC swing than dealing more:** `dmg_taken` win 417 / loss 492 (Δ75) vs `dmg_dealt` win 488 / loss 451 (Δ38).

5. **First-death timing is NOT a CC lever:** `first_death_tick` win 88 vs loss 97 — our first bot dies *later* in losses. Reconfirms the v49 delay-first-blood falsification ([[v49-delay-firstblood-falsified]]).

6. **The one offensive CC signal is the first-BLOOD race** (landing the first kill), not avoiding first death — reframes v49's defensive target. `lost_first_blood` 75% of CC losses vs 44% of wins.

7. **Multi-hit is NOT a CC lever — validated on a correct metric (N=166).** `our_multihit` is identical in CC wins and losses (1.5 vs 1.5); `cc_multihit_on_us` is slightly *higher* in our wins (1.7 vs 1.6); `outshot_multihit` lift 0.83 vs CC (flat). **This definitively falsifies the old v36/v41 "multi-hit is the CC mover" belief.** Multi-hit IS a non-CC lever (`outshot_multihit` lift **2.46** vs non-CC) — improving it helps the general ladder, not CC. (Cast detection: an enemy/our bot losing ≥9 HP in one tick = an ability landed; multi-hit = co-damaged targets within one 150u blast. Damage-signature based — NOT ammo, which decrements by 1/shot.)

## Anti-patterns / caveats
- **Don't infer casts from ammo** — ammo decrements by **1 per shot** (melee and ability alike), so CLAUDE.md's "ability costs 2" is wrong and ammo-delta cast detection is degenerate. Use damage signatures (melee=5, ability=10, zone=3). Fixed in `combat.mjs` (bead clw-4s7.8, closed).
- Lift is association, not causation; thresholds are coarse (a priori). Any shipped fix needs offline A/B over version-submission windows (no `opponentId` harness available) before the ladder.

## Follow-up: the `bad_trade` lift is mostly effect, not cause (v50 validation, 2026-06-01)
Built v50 = v44 + a §3-style engage/retreat gate targeting `bad_trade` (lift 6.0). Offline validation **falsified it as a clean lever**: 71% of bad_trade deaths have an ally within 320u (NOT the lone 1v1 the gate assumes); v44 is already in `move` (maneuvering) at 92% of pre-death ticks; and v44's existing rally/survival/spread branches return before any low-placed gate is reached. So **v44 already performs the engage/retreat behavior the lift pointed at, and these bots die anyway** → `bad_trade` is largely effect-not-cause; a surgical gate is inert and a high-placement one is a pervasive rewrite. Not shipped (v50 retained). Lesson: a high lift on a *residual* classifier bucket (bad_trade is last in death-cause priority) can be a correlate of already-losing, not an actionable cause — verify the mechanism is absent in the base bot before building.

## Follow-up 2: refined classifier — `death_lone` is mostly cascade EFFECT (2026-06-01)
Split `bad_trade` by lone-ness and added mechanistic dimensions (`death_lone`, `death_outnumbered`). **`death_lone` became the #1 CC discriminator** (lift 3.14; 85% of CC losses vs 27% of wins have a bot dying with no ally within 320u). Causality probe (`/tmp/lone_causality.mjs`, pre-cascade only — all 5 alive, tick 20–60): isolation IS modestly higher in losses before any death (CC lone-bots/tick 1.71 loss vs 1.46 win, Δ0.25; max-gap 392 vs 346, Δ46) — so partly causal, NOT pure effect. BUT the pre-cascade seed is **small and identical to the known exposure-gap signal** (the one v49 targeted and barely moved); the large death-time lift is cascade amplification. **Conclusion: no large clean causal lever exists in the loss data.** The only genuine causal signal is small early scatter (~Δ46u), overlapping v49, addressable only via a movement-layer change (the documented dead end). Triangulated 3 ways now (v49 falsified, v50 inert, this decomposition). → strongest play is data accrual (B1.7 win-capture) + holding v44, not another movement iteration.

## Follow-up 3: `lost_first_blood` is mostly a MARKER, not a cause (2026-06-01)
Tested first blood as an offensive lever (`/tmp/firstblood_causal.mjs`): measured team-HP differential just BEFORE the first kill (still 5v5), then conditioned on an even pre-FB state. Result: **89–91% of the time we got first blood we were ALREADY HP-ahead** (mean pre-FB lead +53 CC / +119 non-CC). Conditioning on an even start, non-CC got-FB WR collapses 69%→21% (vs lost 12%, +9pp residual) — marker. CC shows a +29pp even-state residual but n=12 (below the N≥40 trust rule). → first blood is downstream of the early damage exchange; **not a buildable lever** (seeking it invites the overextension failure modes). 

## CONVERGENT CONCLUSION (4 independent levers, 4 correlates)
v49 (delay first-death → timing flat), v50 (bad_trade → effect, v44 already maneuvers), `death_lone` (mostly cascade effect), `lost_first_blood` (mostly marker). All decompose to **downstream of the early HP/damage differential**, which v44 already optimizes (clusterAim, spread, ability timing). There is no clean causal loss-lever in the data that v44 doesn't already address. v44 is at/near the tunable ceiling; CC is a ~35% structural floor. The standing recommendation — hold v44, accrue cleaner matched data (B1.7), re-evaluate only against a fresh baseline or a CC strategy change — is now quadruple-confirmed.

## Follow-up 4: WIN-mining (KF prompted) — wins & losses have IDENTICAL controllable inputs (2026-06-01)
Loss-mining is structurally biased (death-based features over-sample losses; blind to the 75% zero-kill wins). Mined the WINS instead (`/tmp/win_signature.mjs`, `/tmp/win_mechanism.mjs`, `/tmp/early_spread.mjs`). Found a LARGER, DIFFERENT signal than loss-mining: the win lever is DEFENSE, not offense — in non-CC wins we deal EQUAL early damage (119 vs 123) but take HALF (43 vs 100); top win-signature `low_early_taken` win-lift 2.48. **But the mechanism check killed it as a lever:** early range (442/425), ability-exposure (0.85/0.86), spread (874.8/874.7), clustering (1.43/1.34) are ALL identical in wins vs losses — only damage-TAKEN differs (ability-hits-on-us 3.6 win vs 7.2 loss). Same positioning/spacing/engagement/damage-dealt, just hit less → **opponent aim/execution variance, not a replicable behavior.** `low_early_taken` is a marker of facing a weaker/unluckier opponent.
**Capstone:** across every measured controllable dimension, our wins and losses are indistinguishable → outcome variance vs non-CC is OPPONENT-driven; there is no behavioral gap between our wins and losses to exploit. (Caveat: "measured dimensions" — micro-dodge/target-selection quality unmeasured, but all natural levers are flat.) KF's methodological push materially strengthened the conclusion: not just "no loss-lever" but "we play wins and losses identically." Definitively supports hold-v44 + data-flywheel; ELO gains now come only from a regime change (CC shift / new entrant), surfaced automatically by the pipeline.

## Strategist recommendation (decision-typed)
- **Build the general engage/retreat + focus-fire decision-layer fix** (targets `bad_trade`/`focused`, the fat non-CC lift) — *evaluative, high-reversibility*. Highest EV; protects/raises the floor holding #2.
- **Deprioritize CC-specific counters** — *predictive, low EV*: CC lift is thin; only the offensive first-blood race is untested (and distinct from the falsified v49). 
- **Shelve permanently for CC:** widen-vs-CC (finding 3), delay-first-death (finding 5), multi-hit tuning (finding 7 — now confirmed flat on a valid metric). Multi-hit improvement is reassigned to the **non-CC** lever set.

See [[clawber-pipeline-spec]], [[cc-structural-floor-accepted]].
