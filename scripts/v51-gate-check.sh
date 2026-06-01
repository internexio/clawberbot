#!/bin/bash
# v51-baked-nav gated-test check — runs LOCALLY on the Mac Mini (needs match-history
# replays, results.csv, and .env, which are all local-only/gitignored — a remote agent
# can't do this). Reports W/L + the terrain-entrapment rate on v51-era replays vs v44's
# 36% baseline. Does NOT auto-revert (the project has a history of measurement-bug-induced
# bad reverts — verify before reverting). Run daily via launchd.
set -uo pipefail
BASE="/Users/davidpedersen/Mini/clawberbot"
SINCE="2026-06-01T15:52:00Z"      # v51 (sv103) went live ~here; later matches are v51
LOG="$BASE/logs/v51-gate.log"
ALERT="$BASE/logs/v51-gate-alert.json"
cd "$BASE" || exit 1
ts() { date -u +%FT%TZ; }

# W/L from monitored results.csv since SINCE (winnerId-based labels, the canonical source)
read -r W L < <(awk -F, -v s="$SINCE" 'NR>1 && $1>s {if($3=="WIN")w++; else if($3=="LOSS")l++} END{print w+0, l+0}' logs/results.csv 2>/dev/null)
N=$((W + L))
echo "$(ts) V51-GATE: monitored v51 matches=$N  W=$W L=$L" >> "$LOG"

# Abort gate (first 10 verified): <6 wins ⇒ ALERT (no auto-revert)
if [ "$N" -ge 10 ] && [ "$W" -lt 6 ]; then
  printf '{"ts":"%s","alert":"v51 abort-gate tripped: %dW/%dL — VERIFY then consider revert to v44 sv102","revert_cmd":"bash scripts/submit.sh bots/v44-safe-pickup-v41base.js"}\n' "$(ts)" "$W" "$N" > "$ALERT"
  echo "$(ts) V51-GATE: *** ABORT-GATE TRIPPED ($W W / $N) — see $ALERT — DO NOT auto-revert; verify W/L via check-results.py first ***" >> "$LOG"
fi

# Terrain-entrapment rate on v51-era replays (the decisive metric vs v44's 36% / 153 high-conf)
echo "$(ts) V51-GATE entrapment (v51-era, SINCE=$SINCE):" >> "$LOG"
SINCE="$SINCE" node src/clawber/terrain_overlay.mjs 2>/dev/null \
  | grep -E "SINCE filter|LOSS REPLAYS|TERRAIN-ENTRAPMENT|stuck|losses with" >> "$LOG" 2>&1
echo "$(ts) V51-GATE: v44 baseline = 36% of losses / 153 high-conf stuck-into-zone. KEEP v51 if its rate is clearly lower AND WR held; else investigate/revert." >> "$LOG"
echo "$(ts) V51-GATE: --- end ---" >> "$LOG"
