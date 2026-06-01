# Clawberbot — AI Agent for Clawber.ai Battle Arena

## Mission

You are managing a competitive AI bot on Clawber.ai. Your job is to:
1. **Iterate on bot strategy** — analyze match results, identify weaknesses, improve code
2. **Submit and compete** — deploy new bot versions and queue matches
3. **Climb the leaderboard** — currently #3 at 1479 ELO, chasing CrabCrusher at #1 (1748 ELO)

## Security Boundary — READ THIS FIRST

```
INTERNAL (never sent to Clawber)        EXTERNAL (sent to Clawber API)
─────────────────────────────────       ──────────────────────────────
strategies/    KF/COS analysis    ──►   bots/v{N}.js  (pure JS only)
match-history/ our analysis notes
docs/          our reference docs
CLAUDE.md      project context
AGENTS.md      agent instructions
```

**ONLY `bots/*.js` files are ever submitted to Clawber.** Nothing else.

The submit script reads a `.js` file and sends its contents as a string. That JS must be:
- Pure game logic (no references to KF, COS, our strategy, or internal tools)
- Self-contained (no imports, no network access, no filesystem)
- Under 50KB

**KF and COS are our internal advantage.** They design strategy, analyze opponents, and iterate — but their output gets distilled into clean JS bot code before submission. Clawber never sees our thinking, only our moves.

## Our Agent

- **Name:** SEMalytics
- **Agent ID:** `8f1e1fcf-7e3d-4a9c-90ee-1f0296746628`
- **Bot ID:** `9672bcf5-feba-4d7b-a360-828a9973c4fd`
- **API Key:** in `.env` (`CLAWBER_API_KEY`)
- **Claim URL:** https://clawber.ai/claim/blitz-SKDG (Twitter verification pending)
- **Referral code:** `BCT7BX` (+25 ELO for both parties)
- **Current bot:** `bots/v44-safe-pickup-v41base.js` (server v96) — #2 as of 2026-05-30; v41 base + v43 pickup gates, v42 1v1 branch removed. 30-match gate 29W-1L (97%).

### Bot Version History
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
| v41 | sv94 | v41-cluster-aim-3way.js | 3-way centroid multi-hit search (extends v36 clusterAim 2→3 enemies) | 10-7 vs CC (59%, N=17 firmed) — within noise of the ~35% pooled ceiling; the 83% n=12 was variance; 29-1 non-CC |
| v42 | sv95 | v42-endgame-pickup.js | v41 + 1v1 endgame pickup branch above terrain-escape (FAILED — branch misfired; CC bleed was regression-to-mean not the branch) | 2W-10L vs CC, 34-0 non-CC |
| **v44** | **sv96** | **v44-safe-pickup-v41base.js** | **v41 base + v43 safer general-pickup gates, v42 1v1 branch REMOVED. Clean non-regressive hold-base.** | **30-match gate 29W-1L (97%), non-CC 28-0, lone loss CC** |

### Current Record (as of 2026-05-30)
- **ELO:** **2169 (#2 leaderboard)**, −164 vs CC-0308 (#1 at 2333). #3 (hbfreed) is 134 below us — #2 hold is secure.
- **v44 active (sv96):** 30-match confirmation gate 29W-1L (97%). Non-CC 28-0; lone loss to CC (ceiling).
- **The CC "ceiling" is ~35%, NOT ~50% (corrected 2026-05-31, N=1146).** Full-window WR vs CC from CC's own matchHistory (authoritative, POV-flipped) = **401-745 = 35%, Wilson 95% [32-38%]**. The long-cited "~50/53% architectural ceiling" was an artifact of small CC batches (n≈10-15) that regress upward toward 50% by chance. We are a STRUCTURAL UNDERDOG to CC, not a coin-flip. The v41 "83% vs CC" was a small-sample mirage; firmed per-version windows (submit-time boundaries) put every recent version within noise of ~35% (only v37 N=40 @58% and v40 N=39 @49% even clear N≥30, and both have ±15pp CIs). The 2026-05-30 #1→#2 drop was **regression-to-mean, not a v42 regression** — v42's 1v1 branch was inert in 5/6 losses. Lesson: never act on a CC rate with N<~40; verify the changed code path was ACTIVE in the losses before attributing a swing to a deploy.
- **v44 = the clean hold-base:** built by stripping v42's misfiring 1v1 branch off the v43 file, leaving v41 + v43's conservative pickup gates. No code lever has moved the CC matchup off its ~35% structural floor (v44 itself has only N=9 vs CC — its justification is non-CC 100%, NOT a measured CC rate).
- **Process win:** KF strategist correctly ranked clusterAim (proven signal-addition) over center-rush (force-change, 0-for-6 history). Critic removed a measurement-confounding tiebreak pre-ship.
- **v37 history:** wrongly reverted on 2026-05-21 due to botId-vs-agentId measurement bug (see Measurement Trust Chain). Real abort gate was 9W-1L, not 0W-10L. Re-shipped as sv86 same day after `check-results.py` written. Cost: ~150 ELO from the panicked revert + 20-match force-CC self-inflicted batch.
- **v36 → v37 takeaway:** Cluster-aim (v36) brought damage parity but didn't move CC h2h structurally. v37's cascade-state ammo relax (floor 4→2 when allTeam<5 OR killsThem≥1) appears to fix the fire-rate gap during cascades (CC was firing 12.6 abilities/match in our losses vs our 8.2).
- **Movement-vector changes remain a dead end:** v27b (75%), v27c (84%), v31 (50%), v33 movement (rejected). Don't touch movement layer.
- **CC-0308 trajectory:** 2272 → 2146 over 5 days (-126 ELO) while we went 2088 → 2233 (+145). Net swing **+271 ELO**.
- **Craig multi-account:** ClawberLang, CraigClaw, CrabCrusher, ApexPincer, SpaceDust — all @craigrrob. CC-0308 is the only Craig bot that mattered.
- **hbfreed-opus:** #3 at ~1954, drops periodically. Secondary ladder loss source.
- **CFJBot fleet:** 6+ unclaimed LLM-generated bots, several in top 8.
- **Ladder matches:** Auto 1v1 every ~15-30 min. Now that we're #1, auto-ladder pairs us with CC almost exclusively (24h opponent breakdown was 100% CC).
- **Measurement bugs that cost ELO:** batch-results.sh damage-tiebreak (fixed 2026-03-14), daily-monitor.py results.csv-blind (fixed 2026-05-21), winnerId-is-botId-not-agentId (documented 2026-05-21). See Measurement Trust Chain section.

### What We Know From Matches
- **Current game balance (as of 2026-03-25)**: 5 ammo/bot (25 total), melee nearly useless (5 dmg, 10-tick cd), abilities are primary damage (10 dmg, 700u cast range, 150u blast). Pickups restore 35 HP or 3 ammo. See `game-config.json` for exact values.
- **CrabCrusher-0308 strategy (new)**: No split formation — 5 independent chasers converging to zone center. Ability-only (zero melee). Coordinated fire (2-3 bots targeting same position same tick). No pickup farming (doesn't need it with 25 starting ammo). See `scouting/crabcrusher-0308/`.
- **CrabCrusher (old) strategy**: Split formation (3+2) is obsolete. Old CC fell from #1 to #7. See `scouting/crabcrusher/analysis.md`.
- **CC-0308 root causes**: (1) They fire abilities from 700u while our ABL_RANGE=500 limits us to 500u — 200u free damage zone. (2) Faster center convergence gives positional advantage. (3) We dump ammo faster (15 remaining at t50 vs their 20-21). We're 2W-9L vs CC-0308.
- **Old CC counter failures (v28-v30)**: All failed (0W-20L+). Obsolete — old CC is no longer the threat.
- **hbfreed-opus**: Recovered to #2 (1535 ELO, 534W-260L). Beats us in ladder placement matches regularly. Main ELO bleed source.
- **Terrain oscillation**: Bots bounce 12u on obstacle edges. Fixed in v16e with unified terrain escape (fast detect + direction lock). Preserved in v27 via anti-ABAB moveHist.
- **AoE multi-hits**: HARD_SPREAD increased from 80→120u in v27 to prevent AoE multi-kills. SOFT_SPREAD=160u.
- **Ammo conservation**: v27/v33 holds 2 ammo reserve — only fires single-target AoE when ammo >= 3, tick <= 10, tick > 600, or multi-hit available. **Stale**: tuned for 3 starting ammo, actual is now 5. Over-conserving.
- **Over-iteration kills**: v16→v25 (18 versions), v28→v30 (CC counters), v27b→v27c (zone fixes), and v31 (zone pull) ALL made WR worse when they modified movement vectors. v32 succeeded by changing target SELECTION instead of movement — first successful zone fix in 4 attempts.
- **Movement vector zone fixes are a dead end**: v27b (75%), v27c (84%), v31 (50%) — three attempts to add zone-center pull to movement vectors, all degraded WR. Any pull toward center weakens chase/spread. v32 proves the right approach is changing DECISIONS (which target) not FORCES (how to move).
- **Small sample WR is unreliable**: 6W-4L (10 matches) looks like 60% WR but is just variance. Need 50+ matches for confidence. v27's "93%" from 28W-2L was too small; true rate is ~90-95%.
- **AdaptiveAI (8% WR) is a persistent nemesis**: Zone-center camping bot that outlasts us through positioning. Lost to it in both old and new replays. Accept as ~50/50 matchup.

### Previous Agent (deprecated)
- NightwatchBot (separate API key, 10-0 record, no longer active)

## Session Startup Checklist

Run these at the start of every conversation:
1. **Game config check:** `scripts/check-game-config.sh` — detects rule/balance changes. If changes found, review impact on active bot constants and update baseline with `--update`.
2. **Leaderboard check:** `scripts/leaderboard.sh` or API call — track ELO movement and new entrants.
3. **Recent results:** Check `logs/results.csv` for overnight Nightwatch performance (W-L, loss opponents).

Game config baseline is stored in `game-config.json`. The script parses `llms-full.txt` and compares against it. **Previous config blindness cost us ~3 weeks of running stale constants (v19-v33).**

**Automated:** Nightwatch runs `check-game-config.sh --quiet` daily. If changes detected, writes `logs/config-alert.json`. Check for this file at session start.

## Quick Reference

- **Base URL:** `https://clawber.ai`
- **API Docs:** `https://clawber.ai/llms-full.txt`
- **Auth:** `Authorization: Bearer $CLAWBER_API_KEY` (stored in `.env`)
- **Leaderboard:** `https://clawber.ai/leaderboard`
- **Watch replays:** `https://clawber.ai/match/{matchId}`

## API Endpoints

All authenticated endpoints require: `Authorization: Bearer $CLAWBER_API_KEY`

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v1/register` | POST | No | Create account → API key (`clw_*`) |
| `/api/v1/claim` | POST | Yes | Verify identity via Twitter |
| `/api/v1/bot/submit` | POST | Yes | Submit JS bot code (max 50KB) |
| `/api/v1/sprite/upload` | POST | Yes | Custom sprite (1024x1024 PNG) |
| `/api/v1/match/queue` | POST | Yes | Enter 1v1 match (5/min limit) |
| `/api/v1/match/{matchId}` | GET | No | Match status/results |
| `/api/v1/leaderboard` | GET | No | ELO-ranked agent list |
| `/api/v1/referral` | GET | Yes | Referral code (+25 ELO) |
| `/api/v1/heartbeat` | POST | Yes | Active status (every 4 hrs) |
| `/api/health` | GET | No | Service health |

## Game Mechanics

### Arena
- **Size:** 2048 x 2048 units
- **Duration:** 120 seconds (1200 ticks at 10 ticks/second)
- **Teams:** 5 bots per agent, 10 total per match
- **Victory:** Eliminate all enemy bots OR highest total health at time limit

### Bot Stats (updated 2026-03-25 — verify with `scripts/check-game-config.sh`)
- **HP:** 100
- **Speed:** 12 units/tick
- **Ammo:** 5 per bot (melee costs 1, ability costs 2)
- **Melee attack:** 256-unit range, 5 damage, 10-tick cooldown (nerfed — nearly useless)
- **Ability (AoE):** 700-unit cast range, 150-unit blast radius, 10 damage, 30-tick cooldown
- **Powerups:** restores 35 HP or 3 ammo per pickup
- **Chat:** 60 chars max, 1 message per 20 ticks

### Battle Royale Zone
- Starts at ~1126 unit radius, shrinks to 300 over 80 seconds
- 3 HP/tick damage outside zone
- Center shifts slightly each phase

### Terrain
| Type | Movement Cost | Effect |
|---|---|---|
| ground | 1.0 | Normal speed |
| slow | 1.5 | 2/3 speed |
| very_slow | 2.0 | 1/2 speed |
| obstacle | Infinity | Impassable |

### Sandbox Constraints
- **Memory:** 8 MB
- **Decision time:** 50 ms per tick
- **Code size:** 50 KB max
- **No** filesystem, network, or external API access

## Bot Code Structure

```javascript
// Each of your 5 bots runs this same function independently
// They share the sandbox memory for coordination
function update(input) {
  // input.selfId      - UUID of this bot
  // input.teamBotIds  - Array of your 5 bot UUIDs
  // input.botNumber   - Index 0-4 (use for role assignment)
  // input.tick        - Current game tick (0-1200)
  // input.bots        - All bots: { id, position: {x,y}, health, alive, team }
  // input.zone        - { center: {x,y}, radius }
  // input.tiles       - Terrain grid

  // Return one action:
  return { type: "move", direction: { x: 1, y: 0 } };
  // or: { type: "attack", targetId: "uuid" }
  // or: { type: "ability", targetPosition: { x, y } }
  // or: { type: "idle" }
  // Any action can include: say: "text" (60 chars, 1/20 ticks)
}
```

## Project Structure

```
clawberbot/
├── CLAUDE.md          ← You are here (INTERNAL — never shared)
├── AGENTS.md          ← Agent instructions (INTERNAL)
├── .env               ← CLAWBER_API_KEY=clw_...
├── bots/              ← Bot code versions (ONLY these get submitted)
│   ├── v1-pack-tactics.js through v6-pair-hunter.js (legacy)
│   ├── v7-tight-pack.js through v15-terrain-nav.js (legacy)
│   ├── v32-zone-targeting.js  (server v70, CURRENT — 92% rolling)
│   ├── v27-ammo-discipline.js  (server v68, FALLBACK)
│   ├── v28-spread-fix.js through v30-ring-formation.js (CC counters, all failed)
├── scripts/           ← Shell scripts for API operations (all use lib.sh)
│   ├── lib.sh          ← Shared constants, parse_match(), API helpers
│   ├── submit.sh       ← Reads a .js file, sends code string to Clawber
│   ├── queue-match.sh N [name] ← Queue N matches → pending file
│   ├── batch-results.sh [name] ← Check results from pending file
│   ├── match-status.sh
│   ├── download-replay.sh <id> [dir]
│   ├── measure-distances.py    ← Compare distances in win/loss replays
│   ├── leaderboard.sh
│   ├── heartbeat.sh
│   └── nightwatch-monitor.sh  ← Automated match monitoring (runs on Mini)
├── match-history/     ← Match result JSONs & replay analysis (INTERNAL)
│   ├── pending*.txt   ← Match ID batches for result checking
│   └── replay-*.json  ← Downloaded replay data for analysis
├── scouting/          ← Opponent analysis and replay data (INTERNAL)
│   └── crabcrusher/analysis.md  ← Full CC strategy breakdown
├── strategies/        ← KF/COS analysis and strategy docs (INTERNAL)
├── logs/              ← Nightwatch monitoring logs (on Mini)
└── docs/
    └── api-reference.md  (INTERNAL)
```

## Workflow

### First Time Setup
1. Run `scripts/register.sh` to create account and get API key
2. Save key to `.env`
3. Write initial bot in `bots/v1-pack-tactics.js`
4. Submit with `scripts/submit.sh bots/v1-pack-tactics.js`
5. Queue match with `scripts/queue-match.sh`

### Iteration Loop (KF/COS → JS pipeline)
```
match results → KF-debugger (diagnose) → KF-strategist (decide) → write JS → submit
                COS (profile opponent)    KF-critic (review)
```
1. Check recent match results — `scripts/match-status.sh <matchId>`
2. **KF-debugger**: Analyze losses — what went wrong? Root cause?
3. **COS**: Profile opponent behavior — aggressive? defensive? zone-focused?
4. **KF-strategist**: Decide next approach — trade-offs, priorities
5. Write improved bot version in `bots/v{N+1}-{strategy-name}.js`
6. **KF-critic**: Review the JS for edge cases before submitting
7. Submit and queue 3-5 matches to test
5. Review results, repeat

### Remote Management (Nightwatch on Mac Mini)
Automated monitoring runs on Mac Mini via launchd:
- **Hourly matches:** `com.semalytics.clawber-monitor` — queues matches, checks results, logs to `logs/`
- **2-hour heartbeats:** `com.semalytics.clawber-heartbeat` — keeps agent active
- **Logs:** `logs/nightwatch.log`, `logs/results.csv`, `logs/leaderboard-history.csv`
- **Script:** `scripts/nightwatch-monitor.sh`
- Always uses the latest submitted bot version on the server
- **Checkout path:** `~/Scripts` is a symlink → `~/Mini` (verified 2026-06-01), so `~/Scripts/clawberbot` and `~/Mini/clawberbot` are the SAME directory. There is no separate/stale copy; either path works. Canonical: `/Users/davidpedersen/Mini/clawberbot` (what the installed launchd plists reference).
- SSH into Mini to check: `ssh mini` then `tail ~/Mini/clawberbot/logs/nightwatch.log`

## Strategy Framework

### Use KnowledgeForge for systematic improvement:
- **kf-strategist**: Evaluate strategy trade-offs (aggression vs zone control, focus-fire vs spread)
- **kf-expert**: Deep-dive on specific tactics (kiting, flanking, baiting)
- **kf-critic**: Review bot code for gaps and edge cases
- **kf-debugger**: When matches go wrong, diagnose root cause from replays
- **kf-synthesizer**: Extract patterns from winning strategies across matches

### Use COS for opponent analysis:
- Analyze opponent bot behavior patterns (do they cluster? spread? focus fire?)
- Model opponent "personality" — aggressive, defensive, zone-focused
- Adapt strategy to counter specific opponents on the leaderboard

## Current Leaderboard (as of 2026-05-30)

| Rank | Fighter | Rating | Notes |
|---|---|---|---|
| 1 | CrabCrusher-0308 | 2335 | @craigrrob — sits at #1 because they beat us ~65% h2h (we win only ~35% vs CC over N=1146); auto-ladder pairs us heavily so this caps our ceiling |
| **2** | **SEMalytics** | **2203** | **Us — v44 sv100 (live, heartbeat-confirmed), ~35% vs CC (structural floor, N=1146), 100% non-CC** |
| 3 | hbfreed-opus | 2035 | @hbfreed, drops periodically |
| 4 | CFJBot--Opus46F-Velocity-Comet | 1890 | LLM-generated fleet |

Gap to #1: **−132**. We held #1 briefly on 2026-05-29 (under v41, +158) on a small-sample CC win streak, then regressed to the true ~35% CC floor and dropped back to #2 on 2026-05-30. Expect to oscillate around #1/#2: auto-ladder pairs us heavily with CC, so a ~35% CC rate caps our ceiling while non-CC dominance floors it. Reclaiming #1 durably means moving the CC rate up STRUCTURALLY, not winning a CC variance streak.

## Key Insights From 5700+ Matches

1. **Ammo and ability range define the meta** — 5 ammo/bot, abilities cast from 700u (melee is nearly useless at 5 dmg). Matches decided by: (1) ability aim + multi-hits, (2) zone positioning, (3) ammo management. Melee DPS is 0.5/tick vs ability's 0.33/tick but abilities hit AoE.
2. **75% of wins are zero-kill** — most matches end by zone/timeout attrition, not eliminations.
3. **Ammo conservation wins** — Don't dump all ammo by tick 50. Hold 2 in reserve for mid-game AoE when it matters. Multi-hit AoE is always worth it.
4. **Pack formation still matters** — but must spread wider (120u+) to avoid AoE multi-kills. Old 80u HARD_SPREAD was lethal.
5. **Powerup farming less critical with 5 ammo** — was meta when ammo was 3/bot. With 25 starting ammo, pickups are nice but not decisive. CC-0308 collects 0-1 pickups and still wins. Pickups still matter for health (35 HP restore is huge).
6. **Over-iteration kills** — v16→v25 (18 versions) and v28→v30 (3 CC counters) both introduced regressions. Best approach: proven base + surgical fixes. Never chase a specific opponent at the cost of general WR.
7. **Movement vector zone fixes are a proven dead end** — v27b (75%), v27c (84%), v31 (50%) all added zone-center pull to movement vectors, all degraded WR. The fix is changing DECISIONS (target selection) not FORCES (movement blending). v32 proved this.
8. **Craig multi-account strategy** — 5 accounts in top 28, likely farming referral ELO (+25 each). Steve (@doormat23) also referral-farmed to 1255 with 2% WR.
9. **CFJBot fleet** — 6+ unclaimed LLM-generated bots, several in top 11 (Opus46F at #6). v32 beats them consistently. Turtle at center strategy.
10. **Ladder matches cause asymmetric ELO bleed** — auto-matched every 15-30 min. Wins vs low-ELO give +2-3, losses to similar-ELO cost -15-30. Need high WR against ALL opponents, not just low-tier.
11. **Opponent scouting**: CFJBot = turtle at 170u, dump ammo in first 68 ticks, go passive. damxipo-bot = sacrifice 1 bot, camp center with 4, win on HP attrition.
12. **Cluster-aim is the multi-hit lever — confirmed twice** — v36 added `clusterAim()` (35%→59% vs CC). v41 extended it from 2-enemy midpoints to 3-enemy centroids (53%→83% vs CC, n=12). Multi-hit improvement is the ONE reliable CC-matchup mover. The diagnostic that found v36 (`aiming-quality.py`) measured "where did the ability hit relative to victim positions" — CC's "high aim error" was actually GOOD aim at cluster centroids. When stuck on CC, improve multi-hit, not movement/gates/targeting.
13. **The right LAYER matters more than the right idea** — three v35 iterations failed in the constants/gates/melee layer. v36 succeeded in the targeting layer. When stuck on a diagnosis loop, check what layer the failed iterations touched.

## Priority: Hold #2, treat the ~35% CC floor as the real (structural) problem

**Current focus:** v44-safe-pickup-v41base (sv100, live/heartbeat-confirmed) is the stable hold-base at #2 (~2203). The CC matchup sits at a **~35% structural floor (401-745, N=1146, Wilson [32-38%])** — NOT the ~50% previously documented — and NO code lever has moved it (v38/v39/v39b/v40 all 29-53% on small N; v41's 83% was variance; firmed per-version windows all sit within noise of ~35%). Reclaiming #1 requires a STRUCTURAL counter to CC's 5-chaser wide formation, not another parameter/branch iteration. Strategist pass opened 2026-05-30, reframed 2026-05-31 with corrected ceiling. Fallback: v41 sv94 (prefer over v42 sv95, which carries the misfiring 1v1 branch).

**DO NOT** attribute ELO swings to the latest deploy without first checking the changed code path was active in the losses (the 2026-05-30 v42 false-alarm and the 2026-05-21 v37 revert both came from this trap).

**Historical context below is from the v37 era (kept for reference):**

**v37 mechanism (was #1 at 2233, +87 over CC):**
- Cascade-aware ammo reserve: `cascadeTrigger = allTeam.length < 5 || (5-enemies.length) >= 1` drops the `ammoReserveOk` floor from `ammo>=4` to `ammo>=2`.
- Intent: match CC's mid-cascade fire rate (CC fires 12.6 ability/match in our losses; we were firing 8.2). Untouched: clusterAim() (carried from v36), movement vectors, melee, target selection.
- Built on v36's clusterAim() at 12 ability call sites — both mechanisms compose without interference.

**v37 evidence (n=30 / 48h, n=16 vs CC):**
- Total: 23W-7L (77%). All 7 losses to CC.
- vs non-CC: **14W-0L (100%)** — no ladder regression
- vs CC: **9W-7L (56%)** — Wilson 95% CI [33%, 76%], +13pp point-estimate over v36's 43% baseline (n=142). Direction-positive but not yet statistically conclusive on h2h alone — ELO trajectory (+92 in 24h, +87 ELO gap over CC) corroborates.

**Findings remaining (v38+ candidates):**
- **Finding C — First-blood:** 24-tick swing in first-death tick correlates with outcome. **v38 direction:** opening-80-tick defensive routing. Mostly suppressed by v37's damage parity but still appears in losses.
- **Tighter cascade gate:** v37's cascadeTrigger fires for ~93% of a typical match. Could test a bounded version (e.g. only relax for 60 ticks after first kill, or only when HP-ahead). Lower marginal value now that v37 is working.

**Fallbacks:** v36 at sv85 (proven baseline), v35c at sv82, v34 at sv75, v27 at sv68.

**Shelved (proven dead ends):**
- Movement vector zone fixes — v27b/c, v31, v33 all failed
- Restricting melee — v35e (15% vs CC), v35d-D (77% ladder) both failed
- Tweaking ammo gates without cascade-state guard — v35d (36% vs CC) showed no signal
- Old CC counter (v28-v30) — obsolete, old CC at rank ~9

**Lessons from the v37-revert incident (2026-05-21):**
- Don't compare `winnerId` (botId) against an agentId. Use `check-results.py` or `matchHistory.isWin` instead.
- Don't force-queue many vs-CC matches just to gather h2h data — it's -10 to -20 ELO per loss. Wait for auto-ladder.
- A 0W-N abort gate against bots we always beat should trigger "is my measurement broken?" before "is my bot broken?"

## Bot Change Protocol

1. **Identify the layer:** Is the problem in decisions (what to do) or execution (how to move)?
   - Decision problems → modify scoring, targeting, state transitions
   - Execution problems → modify movement vectors, terrain handling
   - **NEVER add zone-center pull to movement vectors** (proven dead end: v27b 75%, v27c 84%, v31 50%). Change DECISIONS not FORCES.

2. **KF pipeline for non-trivial changes:**
   `strategist (evaluate approaches) → critic (pre-code review) → builder (implement) → critic (final review)`
   The pre-code critic pass is more valuable than the post-code pass. It's cheaper to reject an approach than revert a deployment.

3. **Triple-gate any behavioral change:**
   - Gate 1: Game phase (tick range, zone size)
   - Gate 2: Bot position (distance from relevant feature)
   - Gate 3: Situation (enemy exists, ammo available, etc.)
   If any gate fails, change does NOTHING. Changes that do nothing 95% of the time are safer than changes that do a little bit 100% of the time.

4. **Gated deployment:**
   - Submit → 10 matches (abort only if <6W — catastrophic signal)
   - If passes → 20 more (total 30, need ≥88%)
   - **ALWAYS verify via winnerId** (batch-results.sh and other tools may have bugs)
   - Separate expected losses (CrabCrusher, Steve) from regression signals (losing to <10% WR bots)

5. **Revert protocol:**
   - v27-ammo-discipline.js at sv68 is always the safe fallback
   - Revert if WR < 85% over 30+ verified matches
   - After revert, save the failed version for analysis — don't delete

## Measurement Trust Chain

**Authoritative source:** `winnerId` from match API (`GET /api/v1/match/{id}`), correctly mapped through participants.

**Known bug classes:**
1. **winnerId vs placement/damage tiebreak** disagree in timeout matches.
2. **winnerId is a BOT id, not an AGENT id** (2026-05-21 incident). Comparing `winnerId == OUR_AGENT_ID` ALWAYS returns false — they are different field types. Correct lookup:
   ```python
   winner_bot = match["winnerId"]
   winner_agent = next(a["agentId"] for a in match["participants"]
                       if a["botId"] == winner_bot)
   we_won = (winner_agent == OUR_AGENT_ID)
   ```
   This bug caused a wrong revert of a 9W-1L v37 abort gate that reported as 0W-10L. Lost ~150 ELO and a working iteration.
3. **Cross-source check:** `/agent/{id}.matchHistory[].isWin` is from our agent's POV and is the safest single source of truth. If your custom code disagrees with matchHistory.isWin, your code is probably wrong.

| Tool | Status | Notes |
|------|--------|-------|
| `nightwatch-monitor.sh` | FIXED | Uses winnerId |
| `batch-results.sh` | FIXED 2026-03-14 | Was using damage tiebreak |
| `check-results.py` | CANONICAL 2026-05-21 | Correct botId→agentId mapping; use for ad-hoc batches |
| `daily-monitor.py` | FIXED 2026-05-21 | Was results.csv-only (auto-ladder blind); now uses matchHistory |
| `download-replay.sh` | CAUTION | Uses API result label, may disagree with winnerId |
| Heartbeat `recentMatches` | BROKEN | `won` field is ALWAYS false, use winnerId |

**Rule:** When results look surprisingly bad, verify with BOTH `check-results.py` AND `matchHistory.isWin` BEFORE reverting. Twice now we've almost-reverted (and once actually-reverted) working bots due to measurement bugs.

## Opponent Intelligence

### Fleet Tracking
| Operator | Accounts | Combined Losses | Strategy |
|----------|----------|-----------------|----------|
| @craigrrob | CrabCrusher, ClawberLang, CraigClaw, ApexPincer, SpaceDust | 57 | Split formation, pickup farming |
| CFJBot (unknown) | Sonnet45, Sonnet46, Opus45, GPT51C, GPT52, + more | 61 | Turtle at center, burst then passive |
| @DamCipolat | ClawMaster, damxipo-bot | 17 | Sacrifice 1, camp center, focus-fire |
| @doormat23 | Steve + ~8 feeders? | 8 | Zone attrition, referral-farmed ELO |

### ELO Anomaly Detection
High ELO + low WR = referral farming. Currently 9 agents with <10% WR above 1000 ELO.
Referral bonus: +25 per referral. 8 feeders = +200 free ELO.

### Scouting Files
- `scouting/crabcrusher/analysis.md` — CC strategy + replay data
- Loss replays saved at `match-history/replay-loss-{opponent}-{matchId}.json`

## Environment

- Load API key: `source .env`
- All scripts use `$CLAWBER_API_KEY`
- Match results saved to `match-history/YYYY-MM-DD-{matchId}.json`
