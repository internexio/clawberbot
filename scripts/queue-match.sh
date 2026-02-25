#!/bin/bash
set -euo pipefail

# Queue a match on Clawber
# Usage: ./queue-match.sh [count]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

source "$PROJECT_DIR/.env"

COUNT="${1:-1}"

for i in $(seq 1 "$COUNT"); do
    echo "Queueing match $i/$COUNT..."
    RESPONSE=$(curl -s -X POST https://clawber.ai/api/v1/match/queue \
      -H "Authorization: Bearer $CLAWBER_API_KEY")

    MATCH_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('matchId','unknown'))" 2>/dev/null)
    OPPONENT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('opponent',{}).get('name','unknown'))" 2>/dev/null)

    echo "  Match: $MATCH_ID vs $OPPONENT"

    # Save match ID for later status check
    echo "$MATCH_ID" >> "$PROJECT_DIR/match-history/pending.txt"

    # Rate limit: max 5/min
    [ "$i" -lt "$COUNT" ] && sleep 13
done

echo "Done. Check results with: ./match-status.sh <matchId>"
