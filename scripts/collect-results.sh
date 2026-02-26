#!/bin/bash
# Collect results for all pending matches, save wins AND losses
# Usage: ./collect-results.sh [--wait SECONDS]
#   --wait: how long to wait for matches to complete (default: 30s)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PENDING="$PROJECT_DIR/match-history/pending.txt"
RESULTS_FILE="$PROJECT_DIR/logs/results.csv"

source "$PROJECT_DIR/.env"

OUR_AGENT="8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
API_BASE="https://clawber.ai/api/v1"

WAIT_TIME="${2:-30}"
[[ "${1:-}" == "--wait" ]] && shift 2 2>/dev/null || true

if [[ ! -f "$PENDING" ]]; then
  echo "No pending matches."
  exit 0
fi

TOTAL=$(grep -c . "$PENDING" 2>/dev/null || echo 0)
echo "Found $TOTAL pending matches. Waiting ${WAIT_TIME}s for completion..."
sleep "$WAIT_TIME"

REMAINING=""
WINS=0
LOSSES=0
ERRORS=0

while IFS= read -r mid; do
  [[ -z "$mid" ]] && continue

  RESP=$(curl -s "$API_BASE/match/$mid")
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")

  if [[ "$STATUS" != "completed" ]]; then
    echo "  ⏳ $mid — still $STATUS"
    REMAINING="$REMAINING$mid"$'\n'
    continue
  fi

  # Parse result
  INFO=$(echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
agent = '$OUR_AGENT'
parts = d.get('participants', [])
us = next((p for p in parts if p['agentId'] == agent), None)
them = next((p for p in parts if p['agentId'] != agent), None)
if us and them:
    won = d.get('winnerId') == us.get('botId')
    result = 'WIN' if won else 'LOSS'
    opp = them.get('agentName', '?')
    uk = us['stats']['kills']
    ud = us['stats']['damageDealt']
    tk = them['stats']['kills']
    td = them['stats']['damageDealt']
    replay = d.get('replayUrl', '')
    print(f'{result}|{opp}|{uk}|{ud}|{tk}|{td}|{replay}')
else:
    print('ERROR||||||')
" 2>/dev/null || echo "ERROR||||||")

  IFS='|' read -r OUTCOME OPPONENT OUR_K OUR_D THEIR_K THEIR_D REPLAY <<< "$INFO"

  if [[ "$OUTCOME" == "WIN" ]]; then
    echo "  ✅ $mid — WIN vs $OPPONENT (${OUR_K}K/${OUR_D}d vs ${THEIR_K}K/${THEIR_D}d)"
    ((WINS++)) || true
  elif [[ "$OUTCOME" == "LOSS" ]]; then
    echo "  ❌ $mid — LOSS vs $OPPONENT (${OUR_K}K/${OUR_D}d vs ${THEIR_K}K/${THEIR_D}d)"
    echo "     Replay: $REPLAY"
    ((LOSSES++)) || true

    # Save full loss JSON for analysis
    echo "$RESP" | python3 -m json.tool > "$PROJECT_DIR/match-history/loss-${mid}.json" 2>/dev/null
  else
    echo "  ⚠️  $mid — parse error"
    ((ERRORS++)) || true
  fi

  # Append to results CSV
  TS=$(date -u +%FT%TZ)
  echo "$TS,$mid,$OUTCOME,$OPPONENT,$OUR_K,$OUR_D,$THEIR_K,$THEIR_D," >> "$RESULTS_FILE"

  # Save match JSON
  echo "$RESP" > "$PROJECT_DIR/match-history/$(date +%Y-%m-%d)-${mid}.json" 2>/dev/null

  sleep 0.2
done < "$PENDING"

echo -n "$REMAINING" > "$PENDING"

echo ""
echo "=== Summary ==="
echo "Wins:   $WINS"
echo "Losses: $LOSSES"
echo "Errors: $ERRORS"
STILL=$(grep -c . "$PENDING" 2>/dev/null || echo 0)
echo "Still pending: $STILL"
