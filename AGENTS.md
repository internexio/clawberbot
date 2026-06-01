# Clawberbot Agent Instructions

## Agent Identity
- **Agent name:** NightwatchBot (or as set during registration)
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

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
