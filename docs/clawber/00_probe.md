# Clawber Integrated Analysis & Strategy System — Phase 0 Probe Report

**Date:** 2026-06-01
**Status:** READ-ONLY probe complete. No pipeline files written. Stops here for review per master-spec rule #3.
**Source specs:** `docs/inbox/clawber-{claude-code-prompt,analytics-pipeline,decision-formulas,opponent-scouting}.md`
**Scope decision (from operator):** v44 stays the live ladder bot. Build the deterministic **analysis pipeline** around it. Do NOT adopt the greenfield CFG-bot as the ladder entry.

---

## 1. What exists (not greenfield)

| Area | Finding |
|---|---|
| Repo | Mature Clawber project at `/Users/davidpedersen/Mini/clawberbot` (mirror at `~/Scripts/clawberbot`). 49 bot versions (`bots/v1…v49`), v44 live (server sv100/102), holding #2 ~2203 ELO. |
| Bot architecture | v44 = pack tactics + 3-way `clusterAim` + surround opener + cascade-aware ammo + unified terrain escape (~1227 lines). Beats non-CC ~100%; ~35% vs CrabCrusher (structural floor, N=1146, reconfirmed 2026-05-31). |
| Existing analysis | ~40 ad-hoc `scripts/*.py` + `/tmp/*.mjs` re-derive metrics per question (first-death tick, spread, multi-hit, fire-per-opportunity, lift-style W/L). This pipeline supersedes them. |
| Replay corpus | **1,844 JSON files; 1,017 parseable frame-replays; 179 vs-CC.** Immediate backfill source — clears the spec's N≥30 lift gate and approaches N≥150 outcome gate without queuing. |
| `bd` CLI | ✅ `~/.local/bin/bd`. Verbs: `create` (batch from markdown/graph JSON), `link`, `gate`, `children`, `q`, `promote`, etc. Real syntax to be captured fully at Phase 2 start. |
| KnowledgeForge | ✅ `~/Scripts/knowledgeforge{,-3.2,-cc,-research}` + `~/.claude/skills` (kf-* modes). KF analysis layer available. |
| Runtime | Node v25.7.0, npm 11.10.1. No `package.json` yet, **no duckdb**. |
| Auth | Env var is **`CLAWBER_API_KEY`** (spec says `CLAWBER_KEY` — must adapt). `GET /api/health` → `{"status":"ok"}` reachable. |
| Secret-handling caveat | Bash commands that materialize the full key fail in this harness; scripts must read `.env` internally (pattern already used by `submit.sh`). |

## 2. What is missing / must be built

- Joinable offload dataset (`matches.jsonl` + per-tick store). Today data lives only as raw replays + a flat `logs/results.csv`.
- Per-match derived-metrics computation (computed once at capture, not re-walked per analysis).
- Death-cause classifier + lift report as first-class artifacts.
- Project `wiki/` (absent — bootstrap target for accretion, Module 21).
- Win replays: current `nightwatch-monitor.sh` auto-saves **losses only** (line 154 gate) → W/L comparisons are corpus-starved on the win side.

## 3. Spec assumptions vs. reality (the conflicts Phase 0 exists to surface)

| Spec assumption | Reality | Verdict |
|---|---|---|
| `botVersion` is the join key on every result | ✅ present in match JSON `participants[].botVersion` (just undocumented in `api-reference.md`) | **RESOLVED — usable** |
| Powerups carry `expiresAtTick` | ✅ replay schema `{id,type,position:{x,y},expiresAtTick}` | **RESOLVED — pickup-EV mining feasible offline** |
| `opponentId` targeted matchmaking + house bots | ❌ 0 references in API docs; `POST /match/queue` takes no body, returns a **random** opponent | **BLOCKER** — no controlled regression harness (EPIC-4.1) and no on-demand scouting as designed |
| Replays carry `tiles.movementCost`/`passable` | ❌ frame keys = `[tick,bots,powerups,zone,events]`; no tiles | **CONSTRAINT** — terrain-weighted metrics (safety field, terrain travel cost) can only be computed **in-bot** from `input.tiles`, not recomputed offline from replays |
| `ticks.parquet` via duckdb | ❌ no duckdb / no package.json | **ADAPT** — use the jsonl fallback the spec permits |
| project `wiki/` exists | ❌ absent | **ADAPT** — bootstrap it |
| env `CLAWBER_KEY` | actually `CLAWBER_API_KEY` | trivial |
| Greenfield CFG-bot is the bot | We run v44 (proven #2). | **SCOPE** — keep v44; do not replace |

## 4. Replay schema as observed (parser contract)

- **Top-level (replay):** `matchId, startedAt, duration, mapId, arenaSize, gameConfig, bots[], winner, frames[]`.
- **`bots[]`:** `{ id: "<uuid>:<index>", name, agentId }` — bot id is `agentBotUUID:botNumber`; CC detectable by stable id-prefix `edae262d-b7e4-4dd0-a8d0-3f34cb7c0a90`.
- **`frames[]`:** `{ tick, bots[], powerups[], zone, events[] }`. **Full resolution — every tick (gap=1).**
  - frame `bots[]`: `{ id, position:{x,y}, health, ammo, alive }` (no agentId — map via top-level `bots[]`).
  - `zone`: `{ centerX, centerY, radius }`.
  - `powerups[]`: `{ id, type:"health"|"ammo", position:{x,y}, expiresAtTick }`.
- **Match-result JSON (`GET /match/{id}`, distinct from replay):** `matchId, status, shareUrl, createdAt, completedAt, replayUrl, winnerId, participants[]`. **`participants[]`:** `{ botId, botVersion, agentId, agentName, placement, stats }`. `winnerId` is a **botId** (authoritative; map botId→agentId via participants — the documented bug class).

## 5. Open questions for sign-off (do not assume)

1. **Is targeted matchmaking truly unavailable?** Worth one authenticated probe of `POST /match/queue {opponentId}` and `GET /leaderboard?houseBots=true` before finalizing EPIC-4. If unsupported, the regression harness must be replaced by **(a)** offline replay-based A/B over version-submission windows and **(b)** version-vs-version comparison on noisy random ladder with N≥150. This is the single biggest architectural fork.
2. **Backfill terrain blindness:** since replays lack tiles, do we (a) accept that terrain metrics are in-bot-telemetry-only, or (b) reconstruct tiles from `mapId` if a static map table is obtainable? Recommend (a) for now.
3. **v44 instrumentation:** add the tick-0 `say` config-stamp + shared-memory counters to v44 as a *non-behavioral* addition (byte-identical movement), or rely solely on `botVersion`? Recommend `botVersion`-only first (zero ladder risk), add `say` digest later if a metric proves un-derivable from replays.

## 6. Recommendation

Proceed to the deterministic **analysis pipeline** (EPIC-1 + loss-mining EPIC-3) around v44 — pure offline work, zero ladder/match-bandwidth risk, immediately backfillable over 1,017 replays. **Defer**: in-bot decision-formula swaps (EPIC-2), the online classifier (B2.4), and the CC counter-overlay specifically (lowest EV — the ~35% CC floor and flat-opening discriminator were reconfirmed this week; the spec's own offline-validation gate would have blocked every small-N CC lever we've tried). The architecture spec (`01_architecture.md`) encodes this scoping.
