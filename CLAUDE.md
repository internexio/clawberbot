# Clawberbot — AI Agent for Clawber.ai Battle Arena

## Mission

You are managing a competitive AI bot on Clawber.ai. Your job is to:
1. **Iterate on bot strategy** — analyze match results, identify weaknesses, improve code
2. **Submit and compete** — deploy new bot versions and queue matches
3. **Climb the leaderboard** — currently 45 fighters, top bot "hbfreed-opus" at 85% win rate (1821 ELO)

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
- **Current bot:** `bots/v1-pack-tactics.js` (v1)

### Current Record (as of 2026-02-25)
- **26W-4L (87% win rate)**
- **ELO:** ~1078
- **Losses to:** hbfreed-opus (#1), SpaceDust (#2), CrabCrusher (x2)
- **Undefeated against:** everything else (PackLeader, CenterMass, DeepClaw, SigmaGrind, VortexReaper, etc.)

### What We Know From Matches
- **hbfreed-opus** destroyed us: 0 kills, 525 dmg taken. Elite coordination.
- **SpaceDust** (Craig Robinson's bot): beat us 5-2. Strong but not unbeatable.
- **CrabCrusher**: beat us 5-2 twice. Consistent top-tier.
- **Everyone else:** we win decisively, often 5-0 perfects.
- **Our weakness:** top 3 bots exploit something in our pack tactics — likely kiting or superior focus-fire.

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
│   ├── v1-pack-tactics.js
│   └── ...
├── scripts/           ← Shell scripts for API operations
│   ├── register.sh
│   ├── submit.sh       ← Reads a .js file, sends code string to Clawber
│   ├── queue-match.sh
│   ├── match-status.sh
│   ├── leaderboard.sh
│   └── heartbeat.sh
├── match-history/     ← Match result JSONs (INTERNAL)
├── strategies/        ← KF/COS analysis and strategy docs (INTERNAL)
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

### Remote Management
This project runs on Mac Mini via Happy (Claude Code). You can:
- Queue matches and check results autonomously
- Iterate on strategy between matches
- Send heartbeats every 4 hours to stay active
- Track ELO progression in match-history/

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

## Current Leaderboard (as of 2026-02-25)

| Rank | Fighter | Rating | W-L | Win% |
|---|---|---|---|---|
| 1 | hbfreed-opus | 1821 | 185-32 | 85% |
| 2 | SpaceDust | 1637 | 250-186 | 57% |
| 3 | SwarmLogic | 1274 | 23-200 | 10% |
| 4 | PackLeader | 1271 | 14-202 | 6% |
| 5 | HiveMind | 1228 | 19-158 | 11% |

Most bots below rank 2 have <12% win rate. The gap between #1-2 and the rest is massive — good strategy wins here.

## Key Insights From 30 Matches

1. **Clear tier gap** — Top 3 (hbfreed-opus, SpaceDust, CrabCrusher) crush us. Everyone else loses.
2. **hbfreed-opus only took 95 dmg** while killing all 5 of ours — superior coordination, not just targeting.
3. **Our pack tactics work** against bots that don't coordinate — focus fire + zone awareness handles 87% of opponents.
4. **Zone control matters** — 3 HP/tick outside zone adds up fast, many opponents die to zone.
5. **5 bots share sandbox** — use shared state for coordination (global vars persist across `update()` calls for the same team).
6. **AoE ability is powerful** — 15 dmg in 150-unit radius vs 10 dmg single target melee.
7. **To beat the top 3** we likely need: better kiting, predictive targeting, terrain awareness, or adaptive behavior.

## Priority: Beat the Top 3

Analyze the 4 loss replays in `match-history/` to understand what top bots do differently. Key questions:
- Are they kiting us (staying just outside attack range)?
- Are they splitting to bait our pack, then converging?
- Are they using terrain/obstacles we ignore?
- Are they using abilities more effectively (we rarely trigger AoE)?

## Environment

- Load API key: `source .env`
- All scripts use `$CLAWBER_API_KEY`
- Match results saved to `match-history/YYYY-MM-DD-{matchId}.json`
