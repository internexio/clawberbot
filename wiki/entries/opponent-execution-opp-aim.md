# `opp_aim` — opponent execution is the variable that sets our win rate (N=970)

**Accreted:** 2026-06-01 · **Source:** EPIC-4 opponent metrics (`src/clawber/metrics/opponent.mjs`, `opponent_report.mjs`). **Decision type:** evaluative. Built after the win-mining capstone ([[cc-vs-noncc-loss-structure]] follow-up 4) showed our wins/losses have identical controllable inputs → the outcome driver is on the OPPONENT side.

## The metric
Enemy `ammo` is visible in replay frames → **opp_shots** = enemy ammo decrements; **opp_aim** = damage landed on us per opponent shot (an execution/accuracy proxy; all hits are 5 or 10 dmg, so opp_aim ≈ hit-rate × hit-size). Computed for 678/970 matches (enemy ammo present in ~70%).

## Finding: opp_aim is monotone with our WR across 43 opponents
| opponent | our WR | opp_aim |
|---|---|---|
| CrabCrusher-0308 | 36% | **24.4** |
| ClaudeOpus / oztenbot / hbfreed | 14/5/8% | 17.6 / 16.8 / 15.2 |
| ApexPincer / ClawMaster | 0% | 15.5 / 12.3 |
| IronShell / SigmaGrind / AdaptiveAI / EquiBot / TacticalAI | 75–85% | ~7.3–7.7 |

Clean threshold ≈ opp_aim 10–12: above it we lose, below it we farm. **We lose to bots that land more per shot; our own play is constant across wins and losses.** CC's 24.4 (≈3.5× the bots we farm) makes the ~35% structural floor concrete — it's their execution, not our behavior.

## Drift tracker (the regime-change radar)
Splitting each opponent's matches earlier→later half by `started_at`:
- **ClaudeOpus: opp_aim 14.0→18.4, our WR 20%→8%** — execution rising against us (threat).
- **hbfreed-opus: 12.5→15.9, WR 16%→0%** — rising, now beating us outright (threat).
- **CrabCrusher: 23.8→25.1, WR 33%→39%** — stable / we're holding.

## How to use it
- `opp_aim` is the **threat-ranking metric** — monitor it, not our own play (which doesn't vary). 
- The drift tracker is the **early-warning** for regime changes the ELO bleed would otherwise reveal late.
- Caveat: opp_aim is an opponent TRAIT (stable cross-match average); per-opponent WR swings on small n are noisy. There may be no behavioral counter (rising opponents are just executing better — see [[cc-vs-noncc-loss-structure]]: no behavioral gap exists between our wins and losses), but *seeing* the shift early lets us scout/prioritize rather than be surprised. Next: B4.2 periodic threat alert when an opponent's opp_aim drifts up > ~2.
