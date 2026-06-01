# Clawberbot — Version History & Dated Records (Archive)

> **This is the append-only log.** Durable rules and lessons live in `CLAUDE.md`; live
> state (current bot, fallbacks, ELO, active priority) lives in the memory `MEMORY.md`.
> This file is the blow-by-blow record of what was tried — consult it for "did we already
> try X / what happened to vN", not for current decisions.

## Bot Version History

| Internal | Server | File | Key Changes | Record |
|---|---|---|---|---|
| v1-v6 | sv1-sv9 | Various | Initial pack tactics → spread strike → pair hunting | ~26W-4L |
| v7 | sv10 | v7-tight-pack.js | Tight formation (80/120u), HP-weighted targeting | 86W-5L (94.5%) |
| v8 | sv11 | v8-rally-pack.js | Rally phase (converge before engaging), first hbfreed WIN | 96W-4L (96%) |
| v9 | sv12 | v9-wolf-pack.js | Rally fight-back fix, endgame pursuit convergence | ~100W-6L |
| v10 | sv13 | v10-zone-pinch.js | Anti-kiting endgame pursuit, zone pinch | 47W-3L |
| v11 | sv14 | v11-surgical-strike.js | Zone hysteresis, target lock, AoE pursuit, anti-distributed | — |
| v12 | sv15 | v12-terrain-brawl.js | Terrain escape + fight-local + ability simplify | 50W-0L |
| v13 | sv16 | — | Ability tolerance <=1, faster convergence | 94W-6L |
| v14 | sv17 | v14-buddy-blitz.js | Buddy system — nearest ally rally | 94W-6L |
| v15a | sv18 | v15-terrain-nav.js | BFS obstacle field + lookahead steering | 93W-7L |
| v15b | sv19 | — | Prime timings (17t/7t) + isolated fight mode | 47W-3L (94%) |
| v15c | sv20 | — | Distance recalibration from replay measurements | 46W-4L (92%) |
| v16 | sv21 | v16-aoe-aware.js | AoE-safe spacing + persistent escape + advantage pursuit | 96W-4L (96%) |
| v17 | sv22 | v17-pack-rally.js | Pack rally — team-center convergence, anti-fragmentation | 140W-10L (93%) |
| v18 | sv23 | v18-aoe-salvo.js | Global ability-first + rally enemy bias | 46W-4L (92%) |
| v16b | sv24 | v16b-tweaked.js | v16 + rally guard, any-enemy, suppress spread | 93W-7L (93%) |
| v16c | sv25 | v16c-anti-oscillate.js | v16b + 1v1 chase, osc detect, anti-ABAB | 91W-9L (91%) |
| v16d | sv26 | v16d-terrain-escape.js | v16c + persistent osc state, sweep probe, zone pull | 46W-4L (92%) |
| v16e | sv27 | v16e-unified-escape.js | Unified escape: fast detect + multi-tile scoring + dir lock | 98W-2L (98% grind) |
| — | sv28 | *(v16-aoe-aware.js resubmit)* | Revert to v16 by Happy agent (lost terrain fixes) | 7W-13L (35% elite) |
| v16f | sv29 | v16f-terrain-fix.js | v16 combat + v16e terrain escape only (hybrid) | 10W-0L (testing) |
| v19-v25 | sv30-sv47 | various | Ammo system adaptation (ammo gates, pickups, zone ceiling) | ~87% overall |
| v26 | sv48-49 | v26-ammo-core.js | v16e base + ammo gates + pickups (FAILED: 80% WR) | 24W-6L (80%) |
| v27 | sv50,56,58 | v27-ammo-discipline.js | v25 + anti-ABAB + zone pull + ammo conservation + wider spread | 93% proven |
| v28 | sv51-54 | v28-spread-fix.js | Wider HARD_SPREAD + spread weight boost + pickup routing (CC counter) | 0W-15L vs CC |
| v29 | sv55 | v29-split-formation.js | Role-based squad/roamer split (CC counter) | 0W-5L vs CC (worse) |
| v30 | sv57 | v30-ring-formation.js | Ring formation — per-bot rally points at 72° intervals (CC counter) | 10W-0L general, 0W-5L CC |
| v27b | sv59 | v27b-zone-fix.js | Zone-edge emergency retreat (overcorrected — too passive) | 15W-5L (75%) |
| v27c | sv61 | v27c-zone-orbit.js | Lateral orbit near zone edge (disrupted chase effectiveness) | 16W-3L (84%) |
| v27 | sv63,68 | v27-ammo-discipline.js | Restored — v27b/v27c fixes both hurt WR. v27 baseline: 18W-1L (95%) | 95% confirmed |
| v31 | sv67 | v31-zone-aware.js | Movement-vector zone pull in spread/rally/chase (FAILED) | 5W-5L (50%) |
| v32 | sv69-70 | v32-zone-targeting.js | Zone-aware target selection — penalize edge-ward targets in scoreEnemy() | 92% rolling-100 |
| v33 | sv71 | v33-survival-instinct.js | Survival instinct: isolated bots flee to allies, unlocked ammo, buddy gate fix | 27W-3L (90%) |
| v34 | sv73-75 | v34-range-calibration.js | Range calibration: ABL 500→700, ATK 200→256, ammo reserve 3→4 | 30W-0L (100%) |
| v35a/b/c | sv76-78,80,82 | v35c-ammo-discipline.js | Wide spread (HARD 200, SOFT 260), focus-fire x2, ammo reserve restored to 4 | 35% vs CC (n=20), 90%+ ladder |
| v35d | sv77 | v35d-ammo-relax.js | Gate relax (ammo>=3, hp<80) — FAILED, 36% vs CC | 9W-16L vs CC |
| v35e | sv79 | v35e-pickup-commit.js | Removed melee from pickup branch — FAILED, 15% vs CC | 3W-17L vs CC |
| v35d-D | sv81 | v35d-D-melee-killshot.js | Gate melee to kill-shot only — FAILED, 77% ladder abort | 7W-2L ladder |
| v36 | sv83,85 | v36-cluster-aim.js | clusterAim() — centroid targeting at 12 ability sites | 17W-12L vs CC (59% n=29 initial), 43% n=142 7d settled |
| v37 | sv86,92 | v37-cascade-fire.js | Cascade ammo relax: floor 4→2 when allTeam<5 OR killsThem≥1 | 56% vs CC (n=16); proven ceiling, fallback |
| v38 | sv87 | v38-coordinated-fire.js | Coordinated aim target at fire site (FAILED — tightened formation) | 3W-6L vs CC (38%) |
| v39 | sv89 | v39-reactive-weakness.js | Reactive weakness aim (FAILED — reduced opening DPS) | 1W-3L vs CC (25%) |
| v39b | sv91 | v39b-wider-spread.js | HARD_SPREAD 200→250 (FAILED — lost total DPS) | 1W-2L vs CC (33%) |
| v40 | sv93 | v40-surround-opener.js | Opening surround-enemy ring (NEUTRAL on CC) | 16W-14L vs CC (53%), 62W-0L non-CC |
| v41 | sv94 | v41-cluster-aim-3way.js | 3-way centroid multi-hit search (extends v36 clusterAim 2→3 enemies) | 10-7 vs CC (59%, N=17 firmed); 29-1 non-CC. The "83% n=12" was variance |
| v42 | sv95 | v42-endgame-pickup.js | v41 + 1v1 endgame pickup branch above terrain-escape (FAILED — branch misfired; CC bleed was regression-to-mean not the branch) | 2W-10L vs CC, 34-0 non-CC |
| v44 | sv96/102 | v44-safe-pickup-v41base.js | v41 base + v43 safer general-pickup gates, v42 1v1 branch REMOVED. Clean non-regressive hold-base | 30-match gate 29W-1L (97%); the analytics-pipeline-era hold-base |
| v49 | — | v49-cc-delay-firstblood.js | CC-gated delay-first-blood. OFFLINE-FALSIFIED (first-death tick identical W/L) — not shipped | retained |
| v50 | — | v50-engage-retreat.js | bad-trade engage/retreat gate. OFFLINE-INERT (v44 already maneuvers) — not shipped | retained |
| v51 | sv103 | v51-baked-nav.js | v44 + precomputed sunken_reef reef-avoiding flow field (terrain-entrapment fix, ~36% of losses) | mechanism-validated; fallback |
| v52 | sv104 | v52-baked-nav-pickup.js | v51 + binary opportunistic pickup (grab within 130u) | fallback |
| v53 | sv105 | v53-pickup-gravity.js | v51 + pickup GRAVITY (inverse-square, need-scaled, capped) | validated surgical (0.04% diff); fallback |
| v54 | sv106 | v54-cf1-gate.js | v53 + CF-1 fix: gate single-target ability FALLBACK on `abWorth` (22% of casts wasted single-target-at-melee). 1 gated line + 2 helpers | counterfactual 60 games/0 throws; non-regressive; 10W-0L gate |
| v57 | sv107 | v57-forage-zonemargin.js | v54 + directional pickup foraging (away-from-enemy bypasses veto) + shrink-aware zone margin | shipped to watch live; foraging found gate-inert |
| v58 | sv108 | v58-melee-pursuit.js | v57 + group melee-pursuit when clearly ahead + ammo-dry (finish survivors vs huddle) | gate 10W-0L |
| v59 | sv109 | v59-pickup-travel.js | v58 + pickup-travel fix: removed the score-sign distance veto so needed pickups are pursued regardless of distance | gate 9W-1L; collection 0→15% live |

> **For the live current bot, server version, and fallback chain, see `MEMORY.md`.**
> The newest few versions there are always more current than this table.

## Dated Record Snapshots

### Current Record (snapshot 2026-05-30)
- **ELO:** 2169 (#2 leaderboard), −164 vs CC-0308 (#1 at 2333). #3 (hbfreed) 134 below.
- **v44 active (sv96):** 30-match confirmation gate 29W-1L (97%). Non-CC 28-0; lone loss to CC.
- **The CC "ceiling" is ~35%, NOT ~50% (corrected 2026-05-31, N=1146).** Full-window WR vs CC from CC's own matchHistory (authoritative, POV-flipped) = 401-745 = 35%, Wilson 95% [32-38%]. The long-cited "~50/53% architectural ceiling" was an artifact of small CC batches (n≈10-15) that regress upward toward 50% by chance. We are a STRUCTURAL UNDERDOG to CC. The v41 "83% vs CC" was a small-sample mirage. The 2026-05-30 #1→#2 drop was regression-to-mean, not a v42 regression (v42's 1v1 branch was inert in 5/6 losses).
- **v44 = the clean hold-base:** stripped v42's misfiring 1v1 branch off the v43 file, leaving v41 + v43's conservative pickup gates. No code lever has moved the CC matchup off its ~35% floor.
- **Process win:** KF strategist correctly ranked clusterAim (proven signal-addition) over center-rush (force-change, 0-for-6 history). Critic removed a measurement-confounding tiebreak pre-ship.
- **v37 history:** wrongly reverted on 2026-05-21 due to botId-vs-agentId measurement bug. Real abort gate was 9W-1L, not 0W-10L. Re-shipped as sv86 same day after `check-results.py` written. Cost: ~150 ELO.
- **CC-0308 trajectory:** 2272 → 2146 over 5 days (-126 ELO) while we went 2088 → 2233 (+145). Net swing +271 ELO.

### Leaderboard (snapshot 2026-05-30)
| Rank | Fighter | Rating | Notes |
|---|---|---|---|
| 1 | CrabCrusher-0308 | 2335 | @craigrrob — beats us ~65% h2h (we win ~35%, N=1146); auto-ladder pairs us heavily, capping our ceiling |
| 2 | SEMalytics | 2203 | Us — ~35% vs CC (structural floor), 100% non-CC |
| 3 | hbfreed-opus | 2035 | @hbfreed, drops periodically |
| 4 | CFJBot--Opus46F-Velocity-Comet | 1890 | LLM-generated fleet |

We held #1 briefly 2026-05-29 (under v41, +158) on a small-sample CC win streak, then regressed to the true ~35% CC floor and dropped to #2 2026-05-30. Expect to oscillate #1/#2.

## v37-Era Detail (reference)

**v37 mechanism (was #1 at 2233, +87 over CC):**
- Cascade-aware ammo reserve: `cascadeTrigger = allTeam.length < 5 || (5-enemies.length) >= 1` drops the `ammoReserveOk` floor from `ammo>=4` to `ammo>=2`.
- Intent: match CC's mid-cascade fire rate (CC fires 12.6 ability/match in our losses; we were firing 8.2). Untouched: clusterAim() (carried from v36), movement vectors, melee, target selection.

**v37 evidence (n=30 / 48h, n=16 vs CC):**
- Total: 23W-7L (77%). All 7 losses to CC. vs non-CC: 14W-0L (100%). vs CC: 9W-7L (56%), Wilson 95% CI [33%, 76%].

**Old fallback chain (v37 era):** v36 at sv85, v35c at sv82, v34 at sv75, v27 at sv68.

## Per-Version Failure Narratives (reference)

- **v38 — Coordinated ability targeting (FAILED, 38% vs CC):** ABILITY-FIRST single-target fallback used coordinated `target` instead of per-bot nearestEnemy. Coordinating aim subtly tightened formation → more AoE multi-hits on us. Lesson: aim coordination and position convergence are coupled.
- **v39 — Reactive weakness targeting (FAILED, 25% vs CC):** redirecting shots from nearestEnemy to weakest-in-range reduced opening DPS (weakest enemy is farther → less damage-efficient). Lesson: nearestEnemy is always the most damage-efficient aim target.
- **v39b — Wider spread constants (FAILED, 33% vs CC):** HARD 200→250. Bots spend more time spreading, less fighting. Offensive DPS loss > defensive multi-hit gain. Formation tightness is load-bearing for DPS.
- **v40 — Surround opener (NEUTRAL on CC, 53%):** opening formation changes don't move the CC matchup — the structural gap isn't in the opening.

## The Formation Paradox (2026-05-26 — core structural finding)

Our formation is ~180u tighter than CC's (496u vs 681u avg pairwise spread). This drives the measurable gaps: CC multi-hits 1.87 victims/cast vs our 1.56, entirely from our tighter clustering. **But widening spread reduces our DPS** (v39b proved it). The formation is tight BECAUSE our pack tactics need proximity for melee, buddy system, and team convergence. CC runs 5 independent wide chasers (AoE-resilient); we run tight pack tactics. Their architecture counters ours on the AoE axis. This is a structural trade-off, not a bug — fixing it requires architectural change, not parameter tuning.

## Deprecated

- **Previous agent NightwatchBot** (separate API key, 10-0 record, no longer active).
- **Old CrabCrusher** (split 3+2 formation) — obsolete, fell from #1 to ~#7/#9. Counters v28-v30 all failed (0W-20L+); irrelevant now.
