# Clawber Project Wiki

Validated, reusable findings accreted via the KF analysis layer (Module 21 gate: novelty AND reuse value). Project-scoped — Clawber-specific knowledge lives here, not in `~/.claude/wiki/`.

## Entries
- [CC losses have no fat exploitable cause; non-CC losses do (N=970)](entries/cc-vs-noncc-loss-structure.md) — first EPIC-3 lift report. Non-CC losses are fixable (bad_trade/focused, lift 4–6); CC losses are thin (≈flat) → quantitative support for the ~35% floor. Anti-patterns: widen-vs-CC is backwards (tighter wins), delay-first-death is not a lever, multihit metric is degenerate (ammo drops by 1 not 2).
- [opp_aim — opponent execution sets our win rate (N=970)](entries/opponent-execution-opp-aim.md) — EPIC-4 opponent-side metric. opp_aim (dmg landed per opponent shot) is monotone with our WR across 43 opponents (lose >12, farm <8; CC=24.4). Drift tracker flags ClaudeOpus + hbfreed execution rising against us (regime-change radar).
- [Terrain entrapment ≈ a third of losses (opponent-independent, top fixable lever)](entries/terrain-entrapment-loss-driver.md) — one static map (sunken_reef); vision-extracted obstacle grid overlaid on trajectories shows 35% of losses have a bot oscillating against terrain and dying (139 stuck-into-zone, high-confidence). Distinct from the opp_aim structural ceiling: this is OUR terrain handling, fixable. v45/v46 (reverted) or baked-nav target it.
