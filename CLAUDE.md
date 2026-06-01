# Clawberbot — AI Agent for Clawber.ai Battle Arena

## Mission

Manage a competitive AI bot on Clawber.ai: iterate on strategy from match results, submit
new bot versions, and hold/climb the leaderboard. We sit at/near #2 behind CrabCrusher-0308.

> **Live state lives in `MEMORY.md`, not here.** Current bot version, server version,
> fallback chain, ELO, leaderboard position, and the active priority change every session —
> they belong in the per-session memory, NOT in this hand-edited file. CLAUDE.md holds only
> durable rules, mechanics, and hard-won lessons. The full version-by-version log is in
> `docs/history.md`. If you need "what's live right now", read `MEMORY.md`.

## Security Boundary — READ THIS FIRST

```
INTERNAL (never sent to Clawber)        EXTERNAL (sent to Clawber API)
─────────────────────────────────       ──────────────────────────────
strategies/    KF/COS analysis    ──►   bots/v{N}.js  (pure JS only)
match-history/ our analysis notes
docs/          our reference docs
src/clawber/   analysis pipeline
CLAUDE.md      project context
AGENTS.md      agent instructions
```

**ONLY `bots/*.js` files are ever submitted to Clawber.** Nothing else. The submit script
reads a `.js` file and sends its contents as a string. That JS must be:
- Pure game logic (no references to KF, COS, our strategy, or internal tools)
- Self-contained (no imports, no network access, no filesystem)
- Under 50KB

**KF and COS are our internal advantage** — they design strategy and analyze opponents, but
their output is distilled into clean JS before submission. Clawber sees our moves, not our thinking.

## Our Agent (stable identifiers)

- **Name:** SEMalytics
- **Agent ID:** `8f1e1fcf-7e3d-4a9c-90ee-1f0296746628`
- **Bot ID:** `9672bcf5-feba-4d7b-a360-828a9973c4fd`
- **API Key:** in `.env` (`CLAWBER_API_KEY`)
- **Claim URL:** https://clawber.ai/claim/blitz-SKDG (Twitter verification pending)
- **Referral code:** `BCT7BX` (+25 ELO for both parties)

## Session Startup Checklist

1. **Live state:** Read `MEMORY.md` for current bot, fallbacks, and active priority.
2. **Game config:** `scripts/check-game-config.sh` — detects rule/balance changes vs
   `game-config.json` baseline. If changed, review impact on bot constants; update with `--update`.
   Nightwatch runs `--quiet` daily and writes `logs/config-alert.json` on changes — check for it.
   (Config blindness once cost ~3 weeks of stale constants, v19-v33.)
3. **Leaderboard:** `scripts/leaderboard.sh` — track ELO and new entrants.
4. **Recent results:** `logs/results.csv` for overnight Nightwatch W-L and loss opponents.

## Quick Reference

- **Base URL:** `https://clawber.ai` · **API docs:** `https://clawber.ai/llms-full.txt`
- **Auth:** `Authorization: Bearer $CLAWBER_API_KEY` (in `.env`)
- **Leaderboard:** `https://clawber.ai/leaderboard` · **Replays:** `https://clawber.ai/match/{matchId}`

### API Endpoints (all authed need `Authorization: Bearer $CLAWBER_API_KEY`)

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

> Verify with `scripts/check-game-config.sh`; exact values in `game-config.json`. Last confirmed 2026-03-25.

**Arena:** 2048×2048 units · 120s (1200 ticks @ 10/s) · 5 bots/agent, 10/match ·
Victory = eliminate all enemies OR highest total health at time limit.

**Bot stats:** HP 100 · Speed 12 u/tick · Ammo 5/bot (melee costs 1, ability costs 2) ·
Melee 256u range, 5 dmg, 10-tick cd (nerfed, nearly useless) · Ability (AoE) 700u cast,
150u blast, 10 dmg, 30-tick cd · Pickups restore 35 HP or 3 ammo · Chat 60 chars, 1/20 ticks.

**Zone:** starts ~1126u radius, shrinks to 300 over 80s · 3 HP/tick outside · center shifts each phase.

**Terrain:** ground 1.0 · slow 1.5 · very_slow 2.0 · obstacle ∞ (impassable).
(On sunken_reef — the only map — terrain is effectively binary: ground + impassable reef.)

**Sandbox:** 8 MB memory · 50 ms/tick · 50 KB code · no filesystem/network/external API.

## Bot Code Structure

```javascript
// Each of your 5 bots runs this same function independently.
// They share sandbox memory for coordination.
function update(input) {
  // input.selfId      - UUID of this bot
  // input.teamBotIds  - Array of your 5 bot UUIDs
  // input.botNumber   - Index 0-4 (use for role assignment)
  // input.tick        - Current game tick (0-1200)
  // input.bots        - All bots: { id, position:{x,y}, health, alive, team }
  // input.zone        - { center:{x,y}, radius }
  // input.tiles       - Terrain grid
  return { type: "move", direction: { x: 1, y: 0 } };
  // or: { type: "attack", targetId: "uuid" }
  // or: { type: "ability", targetPosition: { x, y } }
  // or: { type: "idle" }
  // Any action can include: say:"text" (60 chars, 1/20 ticks)
}
```

## Project Structure

```
clawberbot/
├── CLAUDE.md          ← durable rules (this file, INTERNAL)
├── AGENTS.md          ← agent instructions (INTERNAL)
├── .env               ← CLAWBER_API_KEY=clw_...
├── game-config.json   ← game-rule baseline (check-game-config.sh compares against it)
├── bots/              ← bot versions (ONLY these get submitted). vN-{strategy}.js
├── src/clawber/       ← deterministic analysis pipeline (parse/metrics/mining), *.mjs
├── scripts/           ← API/ops shell scripts (all use lib.sh)
│   ├── lib.sh, submit.sh, queue-match.sh, batch-results.sh, match-status.sh
│   ├── download-replay.sh, leaderboard.sh, heartbeat.sh
│   ├── check-results.py  ← CANONICAL result checker (correct botId→agentId mapping)
│   └── nightwatch-monitor.sh  ← automated match monitoring (runs on Mini)
├── match-history/     ← match result JSONs & replay-*.json (INTERNAL)
├── scouting/          ← opponent analysis (INTERNAL)
├── strategies/        ← KF/COS strategy docs (INTERNAL)
├── logs/              ← Nightwatch logs (on Mini)
└── docs/              ← api-reference.md, history.md (version archive), clawber/ pipeline docs
```

## Workflow

### Iteration loop (KF/COS → JS pipeline)
1. Check match results — `scripts/match-status.sh <matchId>` (verify via `check-results.py`).
2. **kf-debugger** — diagnose losses: root cause from replays?
3. **COS** — profile opponent behavior (aggressive / defensive / zone-focused).
4. **kf-strategist** — decide next approach, trade-offs, priorities.
5. Write `bots/v{N+1}-{strategy-name}.js`.
6. **kf-critic** — review the JS for edge cases before submitting (pre-code pass is the valuable one).
7. Submit, gate-test (see Bot Change Protocol), iterate.

### Remote management (Nightwatch on Mac Mini)
- launchd jobs: `com.semalytics.clawber-monitor` (hourly matches), `clawber-heartbeat` (2-hr).
- Logs: `logs/nightwatch.log`, `logs/results.csv`, `logs/leaderboard-history.csv`.
- Always runs the latest submitted bot on the server.
- **Path:** `~/Scripts` symlinks → `~/Mini`, so `~/Scripts/clawberbot` and `~/Mini/clawberbot`
  are the SAME directory. Canonical: `/Users/davidpedersen/Mini/clawberbot` (what launchd references).
- Check: `ssh mini` then `tail ~/Mini/clawberbot/logs/nightwatch.log`.

## Bot Change Protocol

1. **Identify the layer.** Decisions (what to do) vs execution (how to move).
   - Decision problems → modify scoring, targeting, state transitions.
   - Execution problems → modify movement vectors, terrain handling.
   - **NEVER add zone-center pull to movement vectors** (proven dead end: v27b 75%, v27c 84%,
     v31 50%). Change DECISIONS, not FORCES. (v32 fixed zone play via target selection — succeeded.)
2. **KF pipeline for non-trivial changes:** `strategist → critic (pre-code) → builder → critic (final)`.
   The pre-code critic pass is the valuable one — cheaper to reject an approach than revert a deploy.
3. **Triple-gate any behavioral change** so it does NOTHING when not applicable:
   - Gate 1: game phase (tick range, zone size) · Gate 2: position (distance from feature)
   - Gate 3: situation (enemy exists, ammo available…).
   A change that does nothing 95% of the time is safer than one that does a little 100% of the time.
4. **Gated deployment:** submit → 10 matches (abort only if <6W — catastrophic) → 20 more
   (total 30, need ≥88%). ALWAYS verify via `winnerId` (see Measurement Trust Chain).
   Separate expected losses (CrabCrusher) from regression signals (losing to <10% WR bots).
5. **Revert protocol:** revert if WR <85% over 30+ verified matches. Keep the failed version
   for analysis — don't delete. (Current fallback chain is in `MEMORY.md`.)

## Measurement Trust Chain

**Authoritative source:** `winnerId` from `GET /api/v1/match/{id}`, mapped through participants.

**Known bug classes:**
1. **winnerId vs placement/damage tiebreak** can disagree in timeout matches.
2. **winnerId is a BOT id, not an AGENT id** (2026-05-21 incident — cost ~150 ELO + a wrong
   revert of a working 9W-1L gate that misreported as 0W-10L). Correct lookup:
   ```python
   winner_bot = match["winnerId"]
   winner_agent = next(a["agentId"] for a in match["participants"]
                       if a["botId"] == winner_bot)
   we_won = (winner_agent == OUR_AGENT_ID)
   ```
3. **Cross-source check:** `/agent/{id}.matchHistory[].isWin` is from our POV — the safest single
   source of truth. If your custom code disagrees with `matchHistory.isWin`, your code is wrong.

| Tool | Status |
|------|--------|
| `check-results.py` | CANONICAL — correct botId→agentId mapping; use for ad-hoc batches |
| `nightwatch-monitor.sh`, `batch-results.sh`, `daily-monitor.py` | FIXED (use winnerId / matchHistory) |
| `download-replay.sh` | CAUTION — uses API result label, may disagree with winnerId |
| Heartbeat `recentMatches` | BROKEN — `won` field always false, use winnerId |

**Rule:** when results look surprisingly bad, verify with BOTH `check-results.py` AND
`matchHistory.isWin` BEFORE reverting. A 0W-N gate against bots we always beat should trigger
"is my measurement broken?" before "is my bot broken?". Don't force-queue vs-CC matches to gather
h2h data — it's -10 to -20 ELO per loss; wait for auto-ladder.

## Durable Strategy Lessons

These are load-bearing and proven across 5700+ matches. New iterations should respect them.

**The meta**
1. **Ammo + ability range define the game.** 5 ammo/bot; abilities cast from 700u (melee
   nearly useless at 5 dmg). Matches decided by (1) ability aim + multi-hits, (2) zone
   positioning, (3) ammo management.
2. **~75% of wins are zero-kill** — most matches end by zone/timeout attrition, not eliminations.
3. **Ammo conservation wins** — don't dump all ammo by tick 50; multi-hit AoE is always worth it.
   (Note: the old "hold 2 reserve" gate was tuned for 3 starting ammo; actual is 5 — that gate over-conserves.)
4. **Pickups are low-leverage with 5 ammo** but health pickups (35 HP) still matter; CC wins
   collecting 0-1. Pickup-collection rate has been hard to move via gates (v52/53/57); v59 finally
   moved it by removing a score-sign distance veto, not by changing gates.

**What does NOT work (proven dead ends — don't re-litigate without new evidence)**
5. **Movement-vector zone fixes** — v27b (75%), v27c (84%), v31 (50%) all degraded WR. Any
   center-pull added to movement weakens chase/spread. Fix DECISIONS, not FORCES.
6. **Redirecting ability fire away from nearestEnemy** — v38 (coordinated), v39 (reactive
   weakness) both cost opening DPS. nearestEnemy is the most damage-efficient aim target.
7. **Widening formation** — v39b (HARD 200→250) lost more DPS than it saved from multi-hit
   reduction. Formation tightness is load-bearing for our DPS.
8. **Restricting melee** — v35e (15% vs CC), v35d-D (77% ladder abort). Melee is load-bearing.
9. **Over-iteration kills** — v16→v25, v28→v30, v27b→v27c all regressed. Use a proven base +
   surgical, triple-gated fixes. Never chase one opponent at the cost of general WR.

**What DOES move things**
10. **Multi-hit / clusterAim is the one reliable CC-matchup lever** — v36 added `clusterAim()`
    (35%→59% vs CC); v41 extended 2→3-enemy centroids. When stuck on CC, improve multi-hit, not
    movement/gates/targeting. (Caveat: at N≥40 even this sits within noise of the ~35% floor.)
11. **The right LAYER matters more than the right idea** — three v35 iterations failed in the
    constants/gates/melee layer; v36 succeeded in the targeting layer. When stuck in a diagnosis
    loop, check what layer the failed attempts touched.

**Statistical discipline**
12. **Small-sample WR is unreliable — especially vs CC.** Need N≥40 before acting on a CC rate;
    the "v41 83% vs CC" was n=12 variance. Don't attribute an ELO swing to a deploy without first
    confirming the changed code path was ACTIVE in the losses (the v42 and v37 false alarms both
    came from skipping this).
13. **The CC matchup is a ~35% structural floor, not ~50%** (401-745, N=1146, Wilson [32-38%]).
    We are a structural underdog to CC's wide 5-chaser formation; reclaiming #1 durably means a
    structural counter, not another parameter/branch tweak. See `docs/history.md` (Formation Paradox).

## Opponent Intelligence

- **CrabCrusher-0308** (@craigrrob, #1): 5 independent chasers converging to zone center,
  ability-only (zero melee), coordinated fire (2-3 bots same position same tick), no pickup
  farming. Fires CLOSER than us (avg ~284u vs our ~342u) — close-range AoE brawler. Our main
  ceiling. Full breakdown in `scouting/crabcrusher-0308/`.
- **ClaudeOpus** — a second structural threat (~7% WR for us, high opponent aim). "100% non-CC"
  is not strictly true; opponent strength is bimodal.
- **CFJBot fleet** — 6+ unclaimed LLM bots, turtle-at-center (~170u), dump ammo early then passive. We beat them consistently.
- **hbfreed-opus** — drops periodically; secondary ladder loss source.
- **ELO anomaly:** high ELO + low WR = referral farming (+25/referral). Several <10% WR agents above 1000 ELO.

### Fleet tracking
| Operator | Accounts | Strategy |
|---|---|---|
| @craigrrob | CrabCrusher, ClawberLang, CraigClaw, ApexPincer, SpaceDust | Split formation, pickup farming (only CC-0308 matters) |
| CFJBot (unknown) | Sonnet45/46, Opus45, GPT51C/52, + more | Turtle at center, burst then passive |
| @DamCipolat | ClawMaster, damxipo-bot | Sacrifice 1, camp center, focus-fire |
| @doormat23 | Steve + ~8 feeders? | Zone attrition, referral-farmed ELO |

Scouting files: `scouting/crabcrusher-0308/`, loss replays at `match-history/replay-loss-{opponent}-{matchId}.json`.

## Strategy Tooling

- **KnowledgeForge** (internal): kf-strategist (trade-offs), kf-expert (tactics deep-dives),
  kf-critic (code review), kf-debugger (loss diagnosis), kf-synthesizer (pattern extraction).
- **COS** (internal): profile opponent "personality" (aggressive/defensive/zone-focused) and adapt.
- **`src/clawber/`** — deterministic offline pipeline (parse replays → metrics → loss-mining).
  events[]-based combat metrics supersede health-delta inference; local replays carry full events[].

## Environment

- Load API key: `source .env` (all scripts use `$CLAWBER_API_KEY`).
- **Bash secret guard:** any command that materializes the full key on the command line
  (`source .env`, `echo $CLAWBER_API_KEY`, inline Bearer header) fails with a tool-call error.
  Workaround: write a self-contained script that reads `.env` itself and run it (`python3 /tmp/x.py`).
  Scripts like `submit.sh` that read `.env` internally work fine.
- Match results saved to `match-history/YYYY-MM-DD-{matchId}.json`.
