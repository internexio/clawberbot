# Clawberbot — AI Agent for Clawber.ai Battle Arena

## Mission

You are managing a competitive AI bot on Clawber.ai. Your job is to:
1. **Iterate on bot strategy** — analyze match results, identify weaknesses, improve code
2. **Submit and compete** — deploy new bot versions and queue matches
3. **Climb the leaderboard** — currently 45 fighters, top bot "hbfreed-opus" at 85% win rate (1821 ELO)

## Quick Reference

- **Base URL:** `https://clawber.ai`
- **API Docs:** `https://clawber.ai/llms-full.txt`
- **Auth:** `Authorization: Bearer clw_YOUR_API_KEY` (stored in `.env`)
- **Our agent name:** Set during registration
- **Leaderboard:** `https://clawber.ai/leaderboard`

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
├── CLAUDE.md          ← You are here
├── AGENTS.md          ← Agent-specific instructions
├── .env               ← CLAWBER_API_KEY=clw_...
├── bots/              ← Bot code versions (JS files)
│   ├── v1-pack-tactics.js
│   └── ...
├── scripts/           ← Shell scripts for API operations
│   ├── register.sh
│   ├── submit.sh
│   ├── queue-match.sh
│   ├── match-status.sh
│   ├── leaderboard.sh
│   └── heartbeat.sh
├── match-history/     ← Match result JSONs
├── strategies/        ← Strategy analysis and iteration notes
└── docs/
    └── api-reference.md
```

## Workflow

### First Time Setup
1. Run `scripts/register.sh` to create account and get API key
2. Save key to `.env`
3. Write initial bot in `bots/v1-pack-tactics.js`
4. Submit with `scripts/submit.sh bots/v1-pack-tactics.js`
5. Queue match with `scripts/queue-match.sh`

### Iteration Loop
1. Check recent match results — `scripts/match-status.sh <matchId>`
2. Analyze: What went wrong? What patterns does the opponent exploit?
3. Write improved bot version in `bots/v{N+1}-{strategy-name}.js`
4. Submit and queue 3-5 matches to test
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

## Key Insights for Strategy

1. **hbfreed-opus dominates at 85%** — likely using sophisticated coordination
2. **SpaceDust (Craig's bot) is #2** — ask Craig about his approach at the meetup
3. **Most bots are bad** — basic pack tactics should beat the bottom 40
4. **Zone control matters** — 3 HP/tick outside zone adds up fast
5. **5 bots share sandbox** — use shared state for coordination (global vars persist across `update()` calls for the same team)
6. **AoE ability is powerful** — 15 dmg in 150-unit radius vs 10 dmg single target melee

## Environment

- Load API key: `source .env`
- All scripts use `$CLAWBER_API_KEY`
- Match results saved to `match-history/YYYY-MM-DD-{matchId}.json`
