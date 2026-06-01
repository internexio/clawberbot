# Clawberbot Agent Instructions

## Agent Identity
- **Agent name:** SEMalytics (IDs in CLAUDE.md → Our Agent). NightwatchBot is deprecated.
- **Managed by:** David Pedersen (@dpedersen)
- **Runs on:** Mac Mini via Happy (Claude Code)

## Autonomous Capabilities

You CAN do these without asking:
- Check leaderboard and match results
- Analyze bot performance
- Write new bot versions in `bots/`
- Queue matches (up to 5/min)
- Send heartbeats
- Save match results to `match-history/`
- Write strategy notes to `strategies/`

You SHOULD ask before:
- Registering a new account
- Submitting bot code (confirm strategy first)
- Any action that costs real resources

## Strategy Development Workflow

1. **Analyze** — Read recent match results, identify patterns
2. **Hypothesize** — What's the opponent doing? What's our weakness?
3. **Design** — Write new bot version with specific improvements
4. **Test** — Submit and queue 3-5 matches
5. **Evaluate** — Did win rate improve? What changed?
6. **Iterate** — Back to step 1

## Using KnowledgeForge

Apply KF modes to systematic bot development:

- **kf-strategist** — "Should we prioritize zone control or aggression?"
- **kf-expert** — Deep-dive on specific game mechanics
- **kf-critic** — Review bot code for edge cases and bugs
- **kf-debugger** — When we lose unexpectedly, diagnose why
- **kf-synthesizer** — Extract patterns from winning matches

## Using COS

Apply COS to opponent analysis:

- Profile opponent behavior as a "personality" (aggressive/defensive/zone-focused)
- Adapt our strategy to counter their approach
- Use pattern recognition across multiple matches

## Bot Naming Convention

`bots/v{N}-{strategy-name}.js`

Examples:
- `v1-pack-tactics.js` — Initial pack formation
- `v2-zone-control.js` — Prioritize zone positioning
- `v3-focus-fire.js` — Coordinated target selection

## Match History

Save results to `match-history/`:
```
match-history/
├── 2026-02-25-{matchId}.json
└── ...
```

## Strategy Notes

Document insights in `strategies/`:
```
strategies/
├── 01-initial-analysis.md
├── 02-opponent-patterns.md
└── ...
```

## Heartbeat Schedule

Send heartbeat every 4 hours to stay active on ladder.
The scripts/heartbeat.sh can be run via cron or manually.

## Memory & Task Tracking — Two Systems, Clear Roles

This project uses BOTH systems; they do not compete:

- **`MEMORY.md`** (harness file-memory, `…/memory/MEMORY.md`) = **durable knowledge** —
  live bot state, fallback chain, strategy facts, hard-won lessons. This is the source of
  truth for "what's live right now" and is maintained automatically by the harness each session.
- **Beads (`bd`)** = **active task/issue tracking only** — multi-step work, follow-ups,
  dependencies. Run `bd prime` for full command reference. Use `bd ready` / `bd show <id>` /
  `bd update <id> --claim` / `bd close <id>`.

> The auto-injected Beads boilerplate elsewhere says "do NOT use MEMORY.md" — **that does not
> apply here.** This project's memory IS MEMORY.md (per the global harness setup). Keep durable
> facts in MEMORY.md; keep task lists in beads. Don't migrate one into the other.

## Session Completion

When ending a work session, work is NOT complete until `git push` succeeds:

1. Commit code changes (see CLAUDE.md attribution footer convention).
2. Run quality gates if code changed (the bot's offline validators, lint).
3. `git pull --rebase` → `bd dolt push` (if beads changed) → `git push` →
   `git status` must show "up to date with origin".
4. Update `MEMORY.md` if live bot state changed; hand off context for the next session.
