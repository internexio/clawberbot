# v54+ iteration — Phase 0 probe report

**Date:** 2026-06-01 · **Task:** external-agent brief "Iterate Clawber bot v53 → v54+". Read-only. **Stops here for review** (brief rule 7: spec-commit before implementation).

## What exists (mostly in place from this session's pipeline work)
| Item | Status |
|---|---|
| v53 source (baseline) | ✅ `bots/v53-pickup-gravity.js` (server v105, live). 47,238 B / 50KB limit — **~4KB headroom (tight)** |
| Analyzers | ✅ `src/clawber/{terrain_overlay,pickup_analysis,build_nav_field,build_occupancy_grid,parse}.mjs` |
| Grid artifacts | ✅ `scouting/sunken_reef-occupancy.json` (64×64, authoritative), `-navfield.json`, `-grid.json` |
| Match corpus | ✅ `match-history/` — **699 unique sunken_reef matches** |
| `bd` CLI | ✅ present (server-mode Dolt, prefix `clw`; EPIC-0/1/3/4 beads from prior phases) |
| Node / Python | ✅ Node v25, Python 3.11 + Pillow |
| KF core | ✅ `~/Scripts/knowledgeforge*` + `~/.claude/skills` |

## Corrections / confirmations vs the brief's assumptions
1. **`opponentId` + house bots ARE supported (corrects a prior-session finding).** Live `llms-full.txt`: `POST /match/queue {opponentId}` targets a specific agent; `GET /leaderboard?houseBots=true` lists house bots (`isHouseBot`, **no ELO**). → The brief's controlled-A/B vs a fixed house bot is **feasible and ELO-safe** (house bots have no rating). *(My earlier `01_architecture.md` decision D5 assumed this was impossible — that was wrong; the controlled regression harness is buildable.)*
2. **`events[]` log is rich and exact — adopt it.** Per-frame `events[]` in the **replay** (S3 JSON, not the match-meta response) carries `zone_shrink`, `ability{botId,targetPosition}`, `damage{attackerId,targetId,damage}`, `powerup_spawn`, `kill`. The brief is right: build the harness on this, not the health-delta/ammo inference my analyzers used (it fixes cast detection exactly — explicit ability casts + attributed damage + explicit kills). Sample (ClaudeOpus loss): 38 abilities, 148 damage, 8 kills, 420 zone_shrink.
3. **Validation corpus already on disk (Phase 0.5 largely satisfied for the baseline).** sunken_reef matches with `duration>400 OR loss`: **635** (444 long, 526 losses). No API pull needed to establish the v44-era late-game baseline. *Caveat:* v53-specific long/loss matches are few (v53 just deployed, and its wins are fast) — those accrue over time / can be force-queued vs a house bot.
4. **Env var is `CLAWBER_API_KEY`** (brief says `CLAWBER_KEY`). `/api/health` → ok (verified earlier).

## Gaps / blockers for review
1. **MISSING: the two referenced analysis docs** — `clawber-v53-empirical-findings.md` and `clawber-v53-analysis.md` are **not in the repo or the Drive bundle**. They hold the full CF-1/CF-2/ERA detail + the unified-pickup design (§2) + innovation ranking. The brief's *inline* summaries are enough to implement A1 (CF-1 gate), A2 (ROI predicate), B1 (unified pickup w/ time-race contest gate), B2 (terrain tiers), C1 (trade gate), D1 (online adaptation) — but the source docs would remove ambiguity. **Provide them, or I proceed from the brief's inline specs.**
2. **Budget (50KB):** v53 is at 47.2KB. The brief sequences correctly — B1 *deletes* the dual pickup system (frees bytes) and must precede D1 (which adds code). A1/A2 are net-neutral/small. Confirm headroom per bead before D1.
3. **Harness data source:** events[] lives in the replay (S3). The harness must read saved replays (we have 699) and/or fetch replayUrl per match. botVersion (the join key) is in the match-meta response, not the replay — join on matchId.

## Recommendation (tagged)
- The plan is **executable as written**; the one earlier blocker (no controlled A/B) is dissolved. *[reckoning]*
- **Phase 0.5 is mostly done**: the 635-match long/loss baseline exists; the new work is (a) a small house-bot A/B driver via `opponentId`, and (b) accruing v53-era long/loss matches. *[evaluative]*
- **Phase 1 harness should be rebuilt on `events[]`** (supersedes my inference-based analyzers — more accurate, enables CF-1/CF-2/ROI directly). *[evaluative — high value]*
- Proceed order per brief: 0.5 corpus split → 1 harness (events[]-based) → A1 (CF-1, ship first) → A2 → B1/B2 → C1 → D1. One change per botVersion.

**STOP — awaiting review.** Open question for sign-off: provide the two analysis .md files, or proceed from the brief's inline specs?
