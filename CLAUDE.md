# Clawberbot — AI Agent for Clawber.ai Battle Arena

## Mission

You are managing a competitive AI bot on Clawber.ai. Your job is to:
1. **Iterate on bot strategy** — analyze match results, identify weaknesses, improve code
2. **Submit and compete** — deploy new bot versions and queue matches
3. **Climb the leaderboard** — currently #2 at ~1531 ELO, chasing hbfreed-opus at #1 (1783 ELO)

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
- **Current bot:** `bots/v9-wolf-pack.js` (server v12)

### Bot Version History
| Version | Server | File | Key Changes | Record |
|---|---|---|---|---|
| v1-v6 | v1-v9 | Various | Initial pack tactics → spread strike → pair hunting | ~26W-4L |
| v7 | v10 | v7-tight-pack.js | Tight formation (80/120u), HP-weighted targeting, prime-based weights | 86W-5L (94.5%) |
| v8 | v11 | v8-rally-pack.js | Rally phase (converge before engaging), first hbfreed WIN | 96W-4L (96%) |
| v9 | v12 | v9-wolf-pack.js | Rally fight-back fix, endgame pursuit convergence | Testing... |

### Current Record (as of 2026-02-26)
- **~230W-13L (~95% win rate)** across all versions
- **ELO:** ~1531 (#2 on leaderboard)
- **Beat hbfreed-opus** for the first time with v8 rally phase
- **Consistent losses to:** hbfreed-opus (but competitive now), ClaudeOpus, Velocity-Comet, CrabCrusher
- **Undefeated against:** everything outside top ~6

### What We Know From Matches
- **hbfreed-opus**: We've beaten them once (v8). Close losses come from spawn spread — bad spawn = death by tick 37, good spawn = competitive. Their coordination is elite but beatable.
- **Spawn spread is critical**: Our spread at spawn (700-821u) determines early game survival vs top bots. Rally phase mitigates by converging to zone center before engaging.
- **Rally phase works**: v8 rally reduced early losses from spawn disadvantage (4 alive at tick 40 vs 2 without rally).
- **Endgame pursuit problem**: Identified 5v1 throw pattern — 3 bots trail at 900u+ while 2 engage, enemy kites and picks off isolated chasers. Fixed in v9 with straggler convergence.
- **Velocity-Comet exploits rally**: Pairs (1 ally within 300u) failed v8's >=2 threshold, became passive punching bags. Fixed in v9 with >=1 threshold + fight-back when attacked.
- **AoE gap**: Top bots fire 37-50% more abilities than us (19-22 vs 12-16). Not yet addressed.
- **Everyone below top 6:** we win decisively, often 5-0 perfects.

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
- **Melee attack:** 200-unit range, 10 damage, 5-tick cooldown
- **Ability (AoE):** 500-unit cast range, 150-unit blast radius, 15 damage, 30-tick cooldown
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
│   ├── v7-tight-pack.js    (server v10, 94.5%)
│   ├── v8-rally-pack.js    (server v11, 96%)
│   └── v9-wolf-pack.js     (server v12, CURRENT)
├── scripts/           ← Shell scripts for API operations
│   ├── submit.sh       ← Reads a .js file, sends code string to Clawber
│   ├── queue-match.sh
│   ├── match-status.sh
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

## Current Leaderboard (as of 2026-02-26)

| Rank | Fighter | Rating | W-L | Win% |
|---|---|---|---|---|
| 1 | hbfreed-opus | 1783 | 203-41 | 83% |
| 2 | **SEMalytics** | **1531** | **607-52** | **92%** |
| 3 | SpaceDust | 1514 | 268-212 | 56% |
| 4 | ClaudeOpus | ~1300 | - | - |
| 5 | CrabCrusher | ~1250 | - | - |

Gap to #1: 252 ELO. Most bots below rank 3 have <12% win rate. Strategy + iteration dominates.

## Key Insights From 250+ Matches

1. **We're competitive with #1** — Beat hbfreed-opus once, lost close matches (4K/490 vs 4K/495). No longer a blowout.
2. **Spawn spread determines early game** — Bad spawn (821u spread) = death by tick 37 vs top bots. Rally phase mitigates this.
3. **Rally phase is the breakthrough** — v8's rally phase (converge to zone center before engaging) turned 94.5% → 96% and enabled first hbfreed win.
4. **Pack formation is everything** — Focus fire + tight formation beats individual skill. Once our pack forms, we match anyone.
5. **Zone control matters** — 3 HP/tick outside zone adds up fast. Many opponents die to zone. Zone-aware movement is core to our strategy.
6. **5 bots share sandbox** — use shared state for coordination (global `var _s` persists across `update()` calls for the same team).
7. **AoE ability gap** — Top bots fire 37-50% more abilities. Closing this gap is the next opportunity.
8. **Endgame pursuit needs pack awareness** — Without convergence, 5v1 advantages get thrown (3 stragglers at 900u+ while 2 engage). v9 fixes this.
9. **Rally threshold matters** — >=2 allies required was too strict (pairs couldn't fight). >=1 with fight-back is the sweet spot.

## Priority: Close the Gap to #1

**ELO gap: 252 points.** Key areas to improve:
- **AoE usage** — fire more abilities, especially during convergence and pursuit phases
- **Spawn adaptation** — detect bad spawns earlier, rally faster
- **Anti-kiting** — top bots kite our melee range. Need better pursuit prediction.
- **Consistent hbfreed wins** — currently ~1 win per 5-6 matches. Need 50%+ to close ELO gap.

## Environment

- Load API key: `source .env`
- All scripts use `$CLAWBER_API_KEY`
- Match results saved to `match-history/YYYY-MM-DD-{matchId}.json`
