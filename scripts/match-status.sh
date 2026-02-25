#!/bin/bash
set -euo pipefail

# Check match status/results
# Usage: ./match-status.sh <matchId>
#        ./match-status.sh --pending  (check all pending matches)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

check_match() {
    local MATCH_ID="$1"
    local RESPONSE
    RESPONSE=$(curl -s "https://clawber.ai/api/v1/match/$MATCH_ID")

    local STATUS
    STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null)

    if [ "$STATUS" = "completed" ]; then
        echo "$RESPONSE" | python3 -m json.tool

        # Save result
        local DATE
        DATE=$(date +%Y-%m-%d)
        echo "$RESPONSE" > "$PROJECT_DIR/match-history/${DATE}-${MATCH_ID}.json"
        echo "  → Saved to match-history/${DATE}-${MATCH_ID}.json"
    else
        echo "Match $MATCH_ID: $STATUS"
    fi
}

if [ "${1:-}" = "--pending" ]; then
    PENDING="$PROJECT_DIR/match-history/pending.txt"
    [ -f "$PENDING" ] || { echo "No pending matches"; exit 0; }

    REMAINING=""
    while IFS= read -r mid; do
        [ -z "$mid" ] && continue
        STATUS=$(curl -s "https://clawber.ai/api/v1/match/$mid" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null)
        if [ "$STATUS" = "completed" ]; then
            check_match "$mid"
        else
            echo "Match $mid: $STATUS (still pending)"
            REMAINING="$REMAINING$mid"$'\n'
        fi
    done < "$PENDING"

    echo -n "$REMAINING" > "$PENDING"
else
    MATCH_ID="${1:?Usage: match-status.sh <matchId> | --pending}"
    check_match "$MATCH_ID"
fi
