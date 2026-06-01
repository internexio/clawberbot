# Claude Code Task — Clawber Integrated Analysis & Strategy System

Build the system specified across three handoff docs. Implement them; do not re-derive.

**Source specs (authoritative):**
- `clawber-analytics-pipeline.md` — data pipeline, metrics, param taxonomy, tuning methodology
- `clawber-decision-formulas.md` — escape field, pickup EV, engage/retreat, loss mining
- `clawber-opponent-scouting.md` — regression harness, scouting, online archetype adaptation

---

## Operating rules (KF, non-negotiable)

1. **Deterministic-first.** Perception, parsing, metric computation, fingerprinting, and all in-bot formulas are pure deterministic code with NO LLM call. LLM judgment is confined to the KF analysis layer (§KF below).
2. **No vision AI anywhere in the pipeline.** The replay JSON is exact ground-truth game state. Vision would be a lossy probabilistic reconstruction of data already held deterministically — scaffolding a strength, not patching a weakness. Visual inspection of the rendered arena is permitted ONLY as a one-time human spot-check during replay-schema discovery to confirm the parser matches reality. Molmo / any visual model is explicitly out of scope.
3. **Read-only probe before writing anything** (Phase 0). No file creation until the probe completes and the spec is committed.
4. **Spec-commit before implementation-commit** (Phase 1 gates Phase 2+).
5. **Tag every design decision** reckoning / evaluative / predictive / novel, with a reversibility rating.
6. **Accretion.** Validated patterns, opponent fingerprints, and proven counters file to `{project_root}/wiki/` via the Module 21 gate (novelty AND reuse value). Project-scoped — Clawber-specific knowledge does not go to `~/.claude/wiki/`.
7. **Artifacts are `.md`.** Never docx.

---

## Phase 0 — Discovery probe (READ ONLY — write nothing)

Report findings, then stop for review. Probe:
- Existing repo layout. Is there a prior Clawber project / bot code / partial pipeline? Do not assume greenfield.
- `knowledgeforge-core` location and which KF modes/compiler builds are available in this workspace.
- `wiki/` location and whether a project wiki exists (bootstrap target if absent).
- `bd` CLI: confirm it is installed and capture its actual `create` / epic / dependency syntax. Do NOT guess flags — read `bd --help`.
- Language/runtime already in use (Node version, package manager, parquet/duckdb availability).
- Clawber API key presence (env `CLAWBER_KEY`) and confirm `/api/health` reachable.

**Output:** a probe report (`docs/clawber/00_probe.md`) listing what exists, what is missing, and any spec assumptions the docs make that conflict with the actual repo.

---

## Phase 1 — Spec commit (gate)

Produce `docs/clawber/01_architecture.md`:
- Layer diagram: deterministic pipeline ↔ KF analysis layer ↔ accretion/wiki. Mark the LLM boundary explicitly.
- Data flow: API → replay capture → parse → offload dataset (`matches.jsonl`, `ticks`) joined on `botVersion`; cold-store raw replays by `match_id`.
- Module boundaries and file map under `src/clawber/`.
- The replay schema as observed in Phase 0 (parser contracts depend on it).
- Decision log: every architectural choice tagged with decision-type + reversibility.

Stop for sign-off before Phase 2.

---

## Phase 2+ — Implementation

First action of Phase 2: create the epics and beads below in `bd` (using the real syntax captured in Phase 0). Then work them in dependency order. Each bead's "done" requires its acceptance criterion met and a one-line accretion check.

### KF analysis layer (the "deeper analysis" wiring)

Implement a `clawber-analyze` workflow that runs ON the deterministic outputs (lift report, fingerprints, metric tables) — never on raw pixels. Chain:

```
Debugger     → root-cause the dominant loss mode from the lift report (hypotheses → eliminate against tick data)
Synthesizer  → abstract cross-match patterns; each pattern carries ≥1 anti-pattern with a failure example
Strategist   → prioritize the next fix or sweep; classify each option by decision-type + reversibility
Builder      → emit the config / counter-overlay spec for the chosen fix
Critic (adv) → auto-verify (fires automatically on evaluative+ Strategist/Builder output); Sev 2+ escalates
Accretion    → if a finding is novel AND reusable, encode to {project_root}/wiki/ (Module 21)
```

The chain consumes structured artifacts and emits a strategy decision plus zero-or-more wiki entries. It does not perceive matches; it reasons over measurements.

---

## Epics & beads

Decision-type and reversibility tagged. All beads here are high-reversibility unless noted.

### EPIC-0 — Discovery & scaffolding
- **B0.1** Read-only repo + KF + wiki + bd probe → `00_probe.md`. *[reckoning]*
- **B0.2** Architecture spec → `01_architecture.md`; spec-commit gate. *[evaluative]*
- **B0.3** Create all epics/beads in bd from approved spec. *[reckoning]*

### EPIC-1 — Match data pipeline (deterministic, foundational)
- **B1.1** Replay schema discovery: dump one completed replay, inspect, document observed shape; human spot-check vs renderer. *[reckoning]*
- **B1.2** Hardened replay parser → tick rows, defensive against observed schema. *[evaluative]* (dep B1.1)
- **B1.3** Experiment registry `{botVersion → config}` JSONL + join logic. *[reckoning]*
- **B1.4** Offload writers: `matches.jsonl` + `ticks` (parquet, jsonl fallback). *[reckoning]* (dep B1.2)
- **B1.5** Metric library: combat / spatial-grid / macro metrics (doc 1 §1). *[evaluative]* (dep B1.2)
- **B1.6** Cold-store raw replays keyed by `match_id` for metric recompute. *[reckoning]*

### EPIC-2 — In-bot decision layer (deterministic, sandbox-safe)
- **B2.1** Cached safety field + escape gradient + zone-timing urgency. *[evaluative]*
- **B2.2** Pickup EV: marginal benefit, terrain-weighted travel, both cliffs, opportunity-cost compare. *[evaluative]*
- **B2.3** Engage/retreat gate: 1v1 trade rule, local square-law, crit-HP floor, `finish` exception. *[evaluative]*
- **B2.4** Online opponent classifier + counter-overlays + commit hysteresis. *[evaluative]* (dep on §4 FEAT defs from B4.3 sharing)
- **B2.5** Assemble `update()`: config baked as constants, tick-0 `config_id` stamp, shared-memory primitives (terrain dist + local counts computed once/tick). *[evaluative]* (dep B2.1–B2.4)
- **B2.6** Sandbox harness: assert <50ms/tick, <8MB, errors→idle; perf-test on max bot count. *[reckoning]* (dep B2.5)

### EPIC-3 — Loss mining & KF analysis
- **B3.1** Death-cause classifier: zone / focused / trapped / bad_trade / starved (primary cause per death). *[evaluative]* (dep B1.2)
- **B3.2** Lift report: `P(feat|loss)/P(feat|win)`, min-N gate (≥30 losses). *[evaluative]* (dep B3.1)
- **B3.3** Wire the `clawber-analyze` KF chain (Debugger→Synthesizer→Strategist→Builder→Critic→Accretion). *[novel — first KF integration on this surface]* (dep B3.2)
- **B3.4** Accretion encoder: validated findings → `wiki/` via Module 21 gate; staleness metadata. *[evaluative]* (dep B3.3)

### EPIC-4 — Scouting & adaptation harness
- **B4.1** House-bot regression harness: fixed `opponentId`, A/B config win-rate. *[evaluative]* (dep B1.4)
- **B4.2** Scouting driver: targeted queue + replay capture, rate-limited (5/min). *[reckoning]* (dep B1.2)
- **B4.3** Fingerprint + archetype miner using shared FEAT defs (must match B2.4 online defs exactly). *[evaluative]* (dep B4.2)
- **B4.4** Counter-overlay offline validation: A/B each overlay vs its archetype on the harness before shipping to the online classifier. *[predictive]* (dep B4.1, B4.3, B2.4)
- **B4.5** Nemesis report from match history (highest loss-rate opponents). *[reckoning]* (dep B1.3)

### EPIC-5 — Tuning loop
- **B5.1** Coarse integer sweep driver (coordinate descent over the param taxonomy). *[evaluative]* (dep B1.5, B4.1)
- **B5.2** Config→code generation: bake constants, stamp `config_id`, submit, register version. *[reckoning]* (dep B1.3)
- **B5.3** Proxy-first ranking → outcome-confirmation gate (proxy metrics rank fast; win-rate confirms finalist). *[predictive]* (dep B5.1)
- **B5.4** Decimal refinement pass, local to the winning integer region only. *[evaluative]* (dep B5.3)

---

## Build order (dependency-respecting)

```
EPIC-0  →  EPIC-1  →  ┬ EPIC-2 (in-bot)        ┐
                      ├ EPIC-4.1 (harness)      ├→ EPIC-4.4 (overlay validation) → ship online classifier
                      └ EPIC-3 (loss mining/KF) ┘
                                                 EPIC-5 (tuning)  [needs EPIC-1 + 4.1]
```

Gate discipline: do not ship the online classifier (B2.4) to the live ladder bot until B4.4 proves each counter-overlay beats its archetype on the controlled harness. An unvalidated runtime branch is net-negative and ladder noise will hide it.

---

## Acceptance for the whole task

- Deterministic pipeline produces a joinable offload dataset and a lift report from real captured matches.
- In-bot bot passes the <50ms/8MB sandbox harness and self-labels its config.
- `clawber-analyze` KF chain runs end-to-end on the lift report and emits a decision-typed strategy recommendation plus any accretion entries.
- Regression harness yields a clean win-rate delta for at least one config change vs a fixed house bot.
- No LLM and no vision model appears anywhere below the KF analysis boundary. Verify this in the architecture decision log.
