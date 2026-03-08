# Clawberbot — AI Agent for Clawber.ai Battle Arena

## Mission

You are managing a competitive AI bot on Clawber.ai. Your job is to:
1. **Iterate on bot strategy** — analyze match results, identify weaknesses, improve code
2. **Submit and compete** — deploy new bot versions and queue matches
3. **Climb the leaderboard** — currently #2 at ~1557 ELO, chasing hbfreed-opus at #1 (1787 ELO)

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
- **Current bot:** `bots/v27-ammo-discipline.js` (server v50)

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
| **v27** | **sv50** | **v27-ammo-discipline.js** | **v25 + anti-ABAB + zone pull + ammo conservation + wider spread** | **28W-2L (93%)** |

### Current Record (as of 2026-03-08)
- **~4600W-550L (~89% win rate)** across all versions
- **ELO:** ~1245 (#3 on leaderboard, peaked at #1 with 1348)
- **v27 test: 28W-2L (93%)** — best post-ammo result
- **Game mechanics changed March 4:** ammo system added (3 ammo/bot, powerups spawn)
- **Craig multi-account:** ClawberLang, CraigClaw, CrabCrusher, ApexPincer all @craigrrob
- **CrabCrusher counter:** 2-sniper + 3-skirmisher formation, conserves ammo, out-farms pickups
- **v16e base failed in ammo era:** 80% WR — combat prowess irrelevant when ammo runs out at tick 300
- **v25 adapted to ammo meta:** 87% WR — iterated for pickup collection and zone positioning

### What We Know From Matches
- **Ammo system (March 4)**: 3 ammo/bot, melee=1, ability=2. Powerups spawn (10 health, 10 ammo). Bots hit 0 ammo by tick 300. 75% of wins are zero-kill zone attrition.
- **CrabCrusher strategy**: 2 snipers hold ammo, 3 skirmishers bait our pack. AoE hits 3-4 bots when we cluster at 96u. Out-farms powerups 6-to-3. Counter: wider spread, ammo conservation.
- **hbfreed-opus**: Beaten with v8 and v27. Dropped from #1 (1787) to #7 (1153). Distributed lock-on still elite.
- **Terrain oscillation**: Bots bounce 12u on obstacle edges. Fixed in v16e with unified terrain escape (fast detect + direction lock). Preserved in v27 via anti-ABAB moveHist.
- **AoE multi-hits**: HARD_SPREAD increased from 80→120u in v27 to prevent AoE multi-kills. SOFT_SPREAD=160u.
- **Ammo conservation**: v27 holds 2 ammo reserve — only fires single-target AoE when ammo >= 3, tick <= 10, tick > 600, or multi-hit available.
- **Over-iteration kills**: v16→v25 (18 versions) introduced regressions. v16e (98%) lost anti-oscillation, zone pull in later versions. v27 restored them surgically.

### Previous Agent (deprecated)
- NightwatchBot (separate API key, 10-0 record, no longer active)

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

### Bot Stats
- **HP:** 100
- **Speed:** 12 units/tick
- **Ammo:** 3 per bot (melee costs 1, ability costs 2)
- **Melee attack:** 200-unit range, 10 damage, 5-tick cooldown
- **Ability (AoE):** 500-unit cast range, 150-unit blast radius, 15 damage, 30-tick cooldown
- **Powerups:** 10 ammo + 10 health spawn per match
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
│   └── v27-ammo-discipline.js  (server v50, CURRENT — 93%)
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
- SSH into Mini to check: `ssh mini` then `tail ~/Scripts/clawberbot/logs/nightwatch.log`

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

## Current Leaderboard (as of 2026-03-08)

| Rank | Fighter | Rating | W-L | Win% | Notes |
|---|---|---|---|---|---|
| 1 | CraigClaw | 1340 | 20-73 | 22% | @craigrrob, low games |
| 2 | ClawberLang | 1319 | 559-535 | 51% | @craigrrob |
| **3** | **SEMalytics** | **1245** | **4537-542** | **89%** | **Us** |
| 4 | CrabCrusher | 1264 | 16-0 | 100% | @craigrrob, new |
| 7 | hbfreed-opus | 1153 | 394-171 | 70% | Dropped from #1 |
| 11 | oztenbot | 1087 | 568-164 | 78% | |

Craig (@craigrrob) controls 4 accounts in top 12 — possible ELO farming via referrals (+25 each).
Gap to #1: ~95 ELO. ELO deflation across board since late Feb.

## Key Insights From 4600+ Matches

1. **Ammo changes everything** — Game added ammo March 4. 3 ammo/bot means matches are decided by: (1) opening burst, (2) powerup collection, (3) zone positioning. Combat prowess matters less.
2. **75% of wins are zero-kill** — most matches end by zone/timeout attrition, not eliminations.
3. **Ammo conservation wins** — Don't dump all ammo by tick 50. Hold 2 in reserve for mid-game AoE when it matters. Multi-hit AoE is always worth it.
4. **Pack formation still matters** — but must spread wider (120u+) to avoid AoE multi-kills. Old 80u HARD_SPREAD was lethal.
5. **Powerup farming is the new meta** — CrabCrusher out-farms us 6-to-3 on pickups. Ammo pickups directly fund killing AoE.
6. **Over-iteration kills** — 18 versions from v16→v25 introduced regressions. Best approach: proven base + surgical fixes.
7. **Zone-aware safeMove is critical** — v22's zone-aware obstacle avoidance (reject moves away from zone) matters more in ammo era.
8. **Craig multi-account strategy** — 4 bots in top 12, possibly farming referral ELO (+25 each).

## Priority: Close the Gap to #1

**ELO gap: ~95 points.** Key areas to improve:
- **CrabCrusher counter** — 2-sniper + 3-skirmisher formation with ammo conservation. Need to target distant snipers, not bait skirmishers.
- **Powerup denial** — contest ammo spawns more aggressively (currently out-farmed 2:1 by elite bots)
- **Referral ELO** — Craig may be farming; consider matching if legitimate
- **Ammo-aware targeting** — prioritize enemies with ammo (they're the threat)

## Environment

- Load API key: `source .env`
- All scripts use `$CLAWBER_API_KEY`
- Match results saved to `match-history/YYYY-MM-DD-{matchId}.json`
