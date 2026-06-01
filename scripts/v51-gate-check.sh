#!/bin/bash
# Current-bot gated-test check (generic; LOCKED ON v53 / sv105 as of 2026-06-01).
# Runs LOCALLY on the Mini (needs match-history replays + results.csv — local-only/gitignored).
# Reports W/L since the improved-bot era, the terrain-entrapment rate (v53 carries v51's reef
# flow field), and pickup collection (v53's gravity). Does NOT auto-revert (verify first).
set -uo pipefail
BASE="/Users/davidpedersen/Mini/clawberbot"
SINCE="2026-06-01T15:52:00Z"      # improved-bot era (v51->v52->v53; all terrain-fixed)
LOG="$BASE/logs/v51-gate.log"
ALERT="$BASE/logs/v51-gate-alert.json"
cd "$BASE" || exit 1
ts() { date -u +%FT%TZ; }

read -r W L < <(awk -F, -v s="$SINCE" 'NR>1 && $1>s {if($3=="WIN")w++; else if($3=="LOSS")l++} END{print w+0, l+0}' logs/results.csv 2>/dev/null)
N=$((W + L))
echo "$(ts) GATE[v53]: monitored matches since $SINCE = $N  (W=$W L=$L)" >> "$LOG"
if [ "$N" -ge 10 ] && [ "$W" -lt 6 ]; then
  printf '{"ts":"%s","alert":"current bot (v53) abort-gate tripped: %dW/%dL — VERIFY then consider revert","revert_cmd":"bash scripts/submit.sh bots/v44-safe-pickup-v41base.js"}\n' "$(ts)" "$W" "$N" > "$ALERT"
  echo "$(ts) GATE[v53]: *** ABORT-GATE TRIPPED ($W W / $N) — see $ALERT — verify W/L via check-results.py before reverting ***" >> "$LOG"
fi

echo "$(ts) GATE[v53] TERRAIN (vs v44 baseline 36% of losses / 153 high-conf):" >> "$LOG"
SINCE="$SINCE" node src/clawber/terrain_overlay.mjs 2>/dev/null \
  | grep -E "SINCE filter|LOSS REPLAYS|TERRAIN-ENTRAPMENT|stuck|losses with" >> "$LOG" 2>&1

echo "$(ts) GATE[v53] PICKUPS (vs v44 baseline: collected 7%, walked-past 1.72/match):" >> "$LOG"
SINCE="$SINCE" node src/clawber/pickup_analysis.mjs 2>/dev/null \
  | grep -E "collected by us|WALKED PAST|free grabs" >> "$LOG" 2>&1

echo "$(ts) GATE[v53]: KEEP if terrain-entrapment lower AND pickups-collected higher AND WR held; else investigate/revert. --- end ---" >> "$LOG"
