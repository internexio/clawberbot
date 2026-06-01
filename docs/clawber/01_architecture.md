# Clawber Integrated Analysis & Strategy System — Architecture Spec (Phase 1)

**Date:** 2026-06-01
**Status:** SPEC-COMMIT GATE. Implementation (Phase 2+) does not begin until this is signed off.
**Predecessor:** `00_probe.md` (Phase 0, read-only).
**Scope:** v44 remains the live ladder bot. This phase builds the **deterministic analysis pipeline + KF analysis layer + accretion** around it. In-bot decision-formula swaps and the online classifier are **deferred** (see §7).

---

## 1. Layer diagram — the LLM boundary is explicit

```
┌─────────────────────────────────────────────────────────────────────┐
│ DETERMINISTIC ZONE  (pure code — NO LLM, NO vision model)             │
│                                                                       │
│  capture ─▶ parse ─▶ metric library ─▶ offload dataset ─▶ lift report │
│  (raw replay JSON)   (tick rows)       (matches.jsonl,    (death-cause │
│                                         metrics.jsonl)     + W/L lift) │
│                                                                       │
│  ── in-bot decision code (v44, sandbox) is ALSO in this zone ──       │
└──────────────────────────────┬────────────────────────────────────┘
                               │  structured artifacts only
                               ▼  (lift report, metric tables, fingerprints)
┌─────────────────────────────────────────────────────────────────────┐
│ KF ANALYSIS LAYER  (LLM judgment — reasons over MEASUREMENTS, never   │
│  over pixels or raw frames)                                           │
│  Debugger ▶ Synthesizer ▶ Strategist ▶ Builder ▶ Critic(adv)          │
└──────────────────────────────┬────────────────────────────────────┘
                               │  novel AND reusable findings only
                               ▼  (Module 21 gate)
┌─────────────────────────────────────────────────────────────────────┐
│ ACCRETION  ──▶  {project_root}/wiki/   (Clawber-scoped, not ~/.claude)│
└─────────────────────────────────────────────────────────────────────┘
```

**Boundary rule:** everything below the KF layer is deterministic. No LLM call participates in perception, parsing, metric computation, fingerprinting, or any in-bot decision. No vision model anywhere — the replay JSON is exact ground truth; visual inspection is permitted only as a one-time human spot-check during schema confirmation (already done in Phase 0).

## 2. Data flow

```
GET /leaderboard, GET /match/{id}        (out-of-band Node, reads .env internally)
        │  participants[].botVersion = JOIN KEY (confirmed present)
        ▼
capture: cold-store raw replay by match_id  +  match-result JSON by match_id
        ▼
parse:   replay frames ─▶ tick rows (defensive parser, observed schema in 00_probe §4)
        ▼
offload:  matches.jsonl   (1 row/match: match_id, bot_version, agent ids, won via winnerId→agentId, placement, kills, dmg, opponent_agent_id, vs_cc, elo_delta)
          metrics.jsonl   (1 row/match: derived metrics from §3, computed ONCE)
          ticks store     (jsonl; per-bot-per-tick: match_id, bot_version, tick, bot_id, x, y, health, ammo, alive, dmg_taken)
        ▼
mine:    death-cause classifier ─▶ lift report  P(feat|loss)/P(feat|win), min-N≥30
        ▼
KF analyze:  Debugger→Synthesizer→Strategist→Builder→Critic→Accretion
```

`bot_version` joins end to end. `winnerId` (a botId) is mapped to agentId via participants at capture time and stored as the boolean `won` — closing the documented botId≠agentId bug class at the source.

## 3. Module boundaries & file map

```
src/clawber/
  api.mjs            # fetch wrapper: .env-internal key, 429/Retry-After backoff, GET-only by default
  capture.mjs        # poll completed matches; cold-store raw replay + match JSON by match_id
  parse.mjs          # parseReplay() → tick rows; defensive vs observed schema (00_probe §4)
  metrics/
    combat.mjs       # realized_dps, ability_roi, multi-hit, overkill, trade_ratio
    spatial.mjs      # spread, dist-to-center, stuck_rate, engagement_range (NO terrain — replays lack tiles)
    macro.mjs        # survival_curve, first_death_tick, pickup_economy, time_to_first_contact
  offload.mjs        # writers: matches.jsonl, metrics.jsonl, ticks (jsonl)
  registry.mjs       # {bot_version → submitted_at window}; join helper (version inferred from submit log + match completedAt)
  mining/
    deaths.mjs       # classifyDeaths(): zone|focused|trapped|bad_trade|starved
    lift.mjs         # liftReport(): per-feature P(loss)/P(win), min-N gate, sorted by lift×p_loss
  analyze.mjs        # orchestrates the KF chain over lift report + metric tables (structured I/O only)
data/                # offload dataset (gitignored); raw/ cold-store keyed by match_id
wiki/                # accretion target (bootstrapped); entries/ + index.md
```

Reuses existing trusted code where possible: `scripts/check-results.py` (canonical botId→agentId), and the CC id-prefix gate from `bots/v47`.

## 4. Adaptations from the source spec (forced by Phase 0 findings)

| Spec said | We do | Why |
|---|---|---|
| `ticks.parquet` (duckdb) | `ticks` as jsonl | no duckdb; spec permits jsonl fallback |
| `opponentId` controlled harness | **offline replay A/B over version-submission windows**; random-ladder N≥150 for outcome confirmation | targeted matchmaking unconfirmed/absent (00_probe §3, open Q1) |
| terrain-weighted offline metrics | terrain metrics are **in-bot telemetry only**; offload omits them | replays carry no tiles |
| env `CLAWBER_KEY` | `CLAWBER_API_KEY`, read inside scripts | actual var + harness secret guard |
| greenfield CFG-bot | **v44 stays**; pipeline wraps it | v44 holds #2, beats non-CC ~100% |

## 5. Replay / result schema (parser contract)

As observed in `00_probe.md §4`. Parser is defensive (`raw.frames || raw.ticks`, `b.position?.x ?? b.x`). Authoritative outcome = `winnerId`(botId) → agentId via `participants`.

## 6. Decision log (every choice tagged: decision-type · reversibility)

| # | Decision | Type | Reversibility |
|---|---|---|---|
| D1 | v44 stays the ladder bot; pipeline is analysis-only this phase | evaluative | high (can adopt CFG-bot later) |
| D2 | `bot_version` (from match JSON) is the join key | reckoning | high |
| D3 | `ticks` store as jsonl, not parquet | reckoning | high (swap writer later) |
| D4 | Terrain metrics in-bot-only; offload omits terrain | evaluative | medium (needs tile reconstruction to reverse) |
| D5 | Replace `opponentId` harness with offline replay-A/B + version-window ladder N≥150 | **predictive** | medium (revert if API supports opponentId) |
| D6 | Store `won` from winnerId→agentId mapping at capture (not the API label) | reckoning | high |
| D7 | Backfill metrics over the existing 1,017 replays before any new capture | evaluative | high |
| D8 | Defer in-bot formula swaps + online classifier (EPIC-2, B2.4) | evaluative | high |
| D9 | Defer CC counter-overlay specifically (lowest EV: ~35% floor, flat opening) | **predictive** | high |
| D10 | Accretion to `{project_root}/wiki/`, not `~/.claude/wiki/` | reckoning | high |
| D11 | No LLM/vision below the KF boundary; verified in this log | reckoning | n/a (invariant) |

## 7. Explicitly deferred (not in Phase 2 of this scope)

- **EPIC-2 in-bot decision layer** (safety field, pickup EV, engage/retreat gate as live v44 changes) — movement-layer risk; gate on pipeline evidence first.
- **B2.4 online opponent classifier + counter-overlays** — blocked by the no-`opponentId` validation gap.
- **CC counter-overlay** — the pipeline's first job is to *re-derive on the full 179-replay corpus* whether any CC lever clears the lift gate; current evidence says no.

## 8. Build order if approved (Phase 2)

```
EPIC-0  create bd epics/beads from this spec (capture real bd syntax first)
EPIC-1  api → capture → parse → metrics → offload   (backfill 1,017 replays)
EPIC-3  death classifier → lift report → wire KF analyze chain → accretion
        ── stop; review the first lift report before any EPIC-2 work ──
```

## 9. Acceptance for this phase

- Offload dataset (`matches.jsonl` + `metrics.jsonl` + ticks) built from the 1,017-replay backfill, joinable on `bot_version`.
- Lift report emitted with N≥30 losses, sorted by `lift × p_loss`.
- `analyze.mjs` runs the KF chain end-to-end on the lift report and emits a decision-typed recommendation + zero-or-more wiki entries.
- Decision log confirms no LLM/vision below the KF boundary.

---
**STOP — awaiting sign-off before Phase 2.**
