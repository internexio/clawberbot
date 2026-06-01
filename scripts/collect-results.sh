#!/bin/bash
# Collect results for all pending matches. Used by nightwatch-monitor.
#
# Usage:
#   ./collect-results.sh                  # check pending.txt, no wait
#   ./collect-results.sh --wait 30        # wait 30s first
#   ./collect-results.sh --wait 30 v15    # wait 30s, check pending-v15.txt
#
# Prints per-match results, saves losses, appends to results CSV.
# Completed matches are removed from the pending file.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WAIT_TIME=0
PENDING_NAME="pending"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --wait) WAIT_TIME="$2"; shift 2 ;;
        *) PENDING_NAME="$1"; shift ;;
    esac
done

PENDING=$(pending_file "$PENDING_NAME")
RESULTS_FILE="$PROJECT_DIR/logs/results.csv"

if [[ ! -f "$PENDING" ]]; then
    echo "No pending file: $PENDING"
    exit 0
fi

TOTAL=$(grep -c . "$PENDING" 2>/dev/null || echo 0)
if [[ "$TOTAL" -eq 0 ]]; then
    echo "Pending file is empty."
    exit 0
fi

if [[ "$WAIT_TIME" -gt 0 ]]; then
    echo "Waiting ${WAIT_TIME}s for matches to complete..."
    sleep "$WAIT_TIME"
fi

echo "Checking $TOTAL matches from $(basename "$PENDING")..."

REMAINING=""
WINS=0
LOSSES=0
ERRORS=0

while IFS= read -r mid; do
    [[ -z "$mid" ]] && continue
    mid=$(echo "$mid" | tr -d '[:space:]')

    RESP=$(clawber_get "/match/$mid" || echo "")
    if [[ -z "$RESP" ]]; then
        echo "  ? $mid — API error"
        REMAINING="$REMAINING$mid"$'\n'
        ((ERRORS++)) || true
        continue
    fi

    PARSED=$(parse_match "$RESP")
    IFS='|' read -r OUTCOME OPPONENT OUR_K OUR_D THEIR_K THEIR_D REPLAY <<< "$PARSED"

    if [[ "$OUTCOME" == "WIN" ]]; then
        echo "  W $mid vs $OPPONENT (${OUR_K}K/${OUR_D}d vs ${THEIR_K}K/${THEIR_D}d)"
        ((WINS++)) || true
    elif [[ "$OUTCOME" == "LOSS" ]]; then
        echo "  L $mid vs $OPPONENT (${OUR_K}K/${OUR_D}d vs ${THEIR_K}K/${THEIR_D}d)"
        echo "    Replay: $REPLAY"
        ((LOSSES++)) || true
        # Save loss JSON
        echo "$RESP" > "$PROJECT_DIR/match-history/loss-${mid}.json" 2>/dev/null
    elif [[ "$OUTCOME" == "PENDING" || "$OUTCOME" == "RUNNING" ]]; then
        REMAINING="$REMAINING$mid"$'\n'
    else
        echo "  ? $mid — parse error"
        REMAINING="$REMAINING$mid"$'\n'
        ((ERRORS++)) || true
    fi

    # Append to results CSV (only completed)
    if [[ "$OUTCOME" == "WIN" || "$OUTCOME" == "LOSS" ]]; then
        TS=$(date -u +%FT%TZ)
        echo "$TS,$mid,$OUTCOME,$OPPONENT,$OUR_K,$OUR_D,$THEIR_K,$THEIR_D," >> "$RESULTS_FILE"
    fi

    sleep 0.15
done < "$PENDING"

echo -n "$REMAINING" > "$PENDING"

PLAYED=$((WINS + LOSSES))
STILL=$(grep -c . "$PENDING" 2>/dev/null || echo 0)

echo ""
echo "=== Summary ==="
echo "Wins:   $WINS"
echo "Losses: $LOSSES"
[[ "$ERRORS" -gt 0 ]] && echo "Errors: $ERRORS"
echo "Still pending: $STILL"
