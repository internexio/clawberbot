# clawberbot

Two bots. One arena. One built by hand over four months. One that built itself in two weeks.

[Clawber.ai](https://clawber.ai) is a real-time 5v5 arena where AI bots fight each other competitively. This repo contains both the hand-crafted bot (**SEMalytics**) and the documentation of how an autonomous system matched it in a fraction of the matches.

> Full case study: [internexio.com/blog/knowledgeforge-autonomous-bot-iteration-clawber](https://internexio.com/blog/knowledgeforge-autonomous-bot-iteration-clawber/)

---

## The Comparison

|  | Manual (this repo) | Autonomous ([clawberbot-auto](https://github.com/internexio/clawberbot-auto)) |
|--|---|---|
| Bot name | SEMalytics | SEMalytics Autonomous |
| Versions | 68+ | 33 |
| Matches to reach parity | ~12,000 | <1,000 |
| Human direction | Every version | Zero after launch |
| Time | ~4 months | ~2 weeks |
| Peak ELO | #1 leaderboard | Matched manual baseline |
| Method | Watch replays → analyze → nudge → submit | Play → gate → diagnose → submit → repeat |

The autonomous system matched the hand-crafted bot's ELO in under 1,000 matches — roughly 12× fewer than the manual approach required. It did this with no knowledge of the manual bot's strategies, replays, or code. It learned entirely from its own losses.

---

## The Manual Bot — SEMalytics

### How It Was Built

**SEMalytics was built the hard way.** Every version involved:

1. **Watch replays.** After a version lost, the developer reviewed match replays — frame by frame, identifying what went wrong.
2. **Analyze the pattern.** Was it a positioning issue? A fire-timing issue? A zone problem? A specific opponent counter?
3. **Run KF diagnosis.** [KnowledgeForge](https://github.com/internexio/knowledgeforge) (KF) structured the analysis: a kf-debugger agent reviewed the loss data and generated a root cause hypothesis; a kf-strategist translated that into a concrete fix; a kf-builder implemented it. The developer reviewed and approved before submission.
4. **Submit and test.** Queue matches, watch results, gate on performance.
5. **Repeat.** Each version took 1-3 days of elapsed time — waiting for matches, reviewing, iterating.

Over four months, this produced 68+ versions. The hard part wasn't writing the code — the hard part was diagnosing what to change. Watching replays, pattern-matching across losses, forming a hypothesis, and validating it required real attention every single cycle.

### What Was Learned

The bot evolved through several major eras:

- **Pack tactics era (v1-v18):** Formation geometry — how tightly to cluster, when to converge, how to handle the AoE tradeoff between spread (AoE safety) and focus fire. Terrain navigation was a persistent challenge.
- **Ammo system adaptation (v19-v33):** The game introduced an ammo mechanic mid-competition. Relearning conservation, pickup routing, and gate conditions took ~15 versions.
- **CC counter-strategy era (v34-v44):** A dominant opponent (CrabCrusher-0308) emerged. The data eventually showed we were a structural underdog at ~35% H2H — leading to a measured decision to hold the best general-purpose version (v44) rather than chase a CC-specific counter that hurt everything else.
- **Surgical improvement era (v44-v68):** Offline counterfactual analysis, baked navigation fields, and pickup gravity. Each version changed one thing, measured it, and kept or reverted.

**12,000 matches. 68 versions. Reached #1.** Human judgment was in the loop for every hypothesis.

### Key Hard-Won Lessons

- Small-sample results lie. A 10W-0L result can be variance, not signal. Wilson 95% CI on H2H records became the measurement standard.
- One-at-a-time changes only. Multi-variable versions are unmeasurable.
- Structural ceilings exist. When the data shows you're a 35% underdog at N=1,000, the ceiling is real — chasing it with increasingly specific counters costs everywhere else.
- The human is the bottleneck. Every insight required watching replays. Diagnosing fast required attention that wasn't always available.

---

## The Autonomous Bot — SEMalytics Autonomous

### What Changed

The autonomous bot ([clawberbot-auto](https://github.com/internexio/clawberbot-auto)) doesn't play a different game. It faces the same opponents, uses the same Clawber API, and competes on the same leaderboard. What changed was **who decides what to fix.**

In the manual bot: the developer watches replays, forms a hypothesis, and directs the code change.

In the autonomous bot: a pipeline watches replays, forms a hypothesis, and directs its own code change — without asking.

```
Manual loop (this repo):          Autonomous loop (clawberbot-auto):

play → lose                       play → lose
  ↓                                 ↓
developer watches replays         pipeline reads replay data
  ↓                                 ↓
developer forms hypothesis        kf-debugger forms hypothesis
  ↓                                 ↓
developer directs code change     kf-strategist designs fix
  ↓                                 ↓
developer reviews code            kf-builder writes code
  ↓                                 ↓
developer submits                 kf-critic validates
  ↓                                 ↓
wait for matches                  auto-submit → wait → repeat
```

The pipeline is the same KnowledgeForge reasoning process the developer used — it just runs without a human in the middle. KF was the analytical layer in both approaches. In the manual bot it assisted; in the autonomous bot it decided.

### The Statistical Gate

Both approaches gate on performance, but the autonomous one is explicit about it. A [Wilson 95% confidence interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval) on win rate drives all decisions:

- **PROMOTE:** Win rate is statistically clear above threshold → hold the version, build the next
- **DIAGNOSE:** Win rate is statistically clear below threshold → run the pipeline, fix it
- **WAIT:** Not enough data yet → keep playing

This prevents the hair-trigger updates that plagued early manual iterations ("revert after 3 losses") and ensures each decision is data-driven.

### The Two Process Innovations

The autonomous system didn't just replace the human with an AI. It introduced two process improvements that the manual approach never had:

**1. Opponent Stratification**

When the bot loses to five different opponents in different ways, asking "why are we losing?" produces a vague, averaged answer. The diagnosis is muddied.

Before running diagnosis, the pipeline checks: does one opponent account for ≥30% of recent losses? If yes, the replay analysis focuses exclusively on that opponent. The result is a concrete, falsifiable hypothesis grounded in one consistent failure mode.

This is what the developer was doing manually — after enough losses to notice a pattern. The pipeline does it automatically and consistently from the first DIAGNOSE cycle.

**2. Failed-Hypothesis Log**

The manual bot hit the same hypotheses multiple times. Replays would suggest "try wider spread" — it gets tried, fails, the developer moves on. Two weeks later, a different set of replays suggests the same thing. The fix gets re-tried with a different parameter, fails again.

There was no systematic log of ruled-out hypotheses.

The autonomous pipeline maintains one. Every prior attempt — version number, what was tried, gate outcome — is prepended to the diagnosis context. The first instruction the debugger receives: *read this before proposing anything. Your hypothesis must differ from every entry here.*

This is the equivalent of a scientist's lab notebook. The manual approach had it implicitly (the developer remembers what was tried). The pipeline has it explicitly, and it doesn't forget.

### The Breakthrough

23 DIAGNOSE cycles. 23 failed hypotheses. Then the debugger found something that had been in the game spec the whole time: melee attacks cost no ammo. The bot's code had conditions that together suppressed melee almost entirely. One condition removed. 10W-0L on the first 10 matches. Five consecutive PROMOTEs followed.

The manual bot had similar moments — discoveries that unlocked step-changes in performance. The difference: the manual bot took months of watching to find them. The autonomous bot found this one in 23 iterations without anyone watching.

---

## KnowledgeForge

[KnowledgeForge](https://github.com/internexio/knowledgeforge) (KF) is the structured multi-agent reasoning framework that powered both sides of this project.

In the **manual bot**, KF assisted the developer at each iteration cycle: a kf-debugger analyzed loss patterns and proposed a root cause, a kf-strategist designed the fix, a kf-builder wrote the code. The developer reviewed, approved, and submitted. KF handled the analysis; the human provided judgment and direction.

In the **autonomous bot**, the same pipeline ran without the human step. The developer's role — reviewing hypotheses, approving fixes, deciding when to submit — was replaced by additional KF agents (kf-critic) and a statistical gate (Wilson CI). KF went from assistant to decision-maker.

The 12× improvement in iterations-to-parity came from removing the human bottleneck from a process that KF was already running.

> KnowledgeForge is open source: [github.com/internexio/knowledgeforge](https://github.com/internexio/knowledgeforge)

---

## Repo Contents

```
clawberbot/
├── bots/               # All submitted versions (v1–v68+)
│   ├── v1-pack-tactics.js
│   ├── ...
│   └── v68-long-forage.js
├── docs/
│   └── history.md      # Full version-by-version record with W/L stats
├── game-config.json    # Public Clawber.ai balance snapshot
├── scripts/            # Analysis and submission tooling
│   ├── submit.sh       # Bot submission
│   ├── leaderboard.sh  # Leaderboard check
│   ├── heartbeat.sh    # Keep-alive (queue 1 match every 4h)
│   └── ...
└── CLAUDE.md           # AI agent briefing for contributors
```

The internal strategy analysis, scouting notes, and KF/COS working documents are not included — those are the thinking, not the code. What's here is the output: the bot versions and their records.

---

## Running Your Own Bot

**Prerequisites:** A [Clawber.ai](https://clawber.ai) account. Referral code `BCT7BX` gives +25 ELO to both parties.

```bash
git clone https://github.com/internexio/clawberbot.git
cd clawberbot
# Add your API key to .env: CLAWBER_API_KEY=your_key
bash scripts/submit.sh bots/v1-pack-tactics.js
```

For the autonomous self-improving version, see [clawberbot-auto](https://github.com/internexio/clawberbot-auto).

---

## What This Demonstrates

The manual bot demonstrates what human-in-the-loop AI-assisted development looks like at competitive scale: structured analysis tools, careful measurement, one change at a time.

The autonomous bot demonstrates that the bottleneck in that process — the human forming and remembering hypotheses — can be replaced by a pipeline that does it more consistently, if not always more cleverly.

KnowledgeForge was the constant. What changed was whether a human sat between its stages.

The two repos together show the gap: 12,000 matches and four months vs. under 1,000 matches and two weeks to reach the same performance level.

---

## License

MIT
