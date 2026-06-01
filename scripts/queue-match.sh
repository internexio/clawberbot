#!/bin/bash
# Queue matches on Clawber.
#
# Usage:
#   ./queue-match.sh                 # queue 1 match, append to pending.txt
#   ./queue-match.sh 50              # queue 50 matches
#   ./queue-match.sh 50 pending-v15  # queue 50, append to pending-v15.txt
#
# Rate limit: 5 matches/min — waits 13s between requests + retries on 429.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

COUNT="${1:-1}"
PENDING_NAME="${2:-pending}"
PENDING=$(pending_file "$PENDING_NAME")

# Ensure pending directory exists
mkdir -p "$(dirname "$PENDING")"

QUEUED=0
FAILED=0
MAX_RETRIES=3
DELAY=14  # 60s / 5 matches = 12s, +2s buffer

echo "Queueing $COUNT matches → $(basename "$PENDING")"
echo ""

for i in $(seq 1 "$COUNT"); do
    attempt=0
    success=false

    while [ "$attempt" -lt "$MAX_RETRIES" ]; do
        attempt=$((attempt + 1))
        RESPONSE=$(clawber_post "/match/queue" || echo '{"error":"request failed"}')

        # Check for rate limit
        RETRY_AFTER=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('retryAfter',''))" 2>/dev/null || echo "")
        ERROR=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "")

        if [ -n "$RETRY_AFTER" ]; then
            WAIT=$((RETRY_AFTER + 2))
            echo "  Rate limited, waiting ${WAIT}s (attempt $attempt/$MAX_RETRIES)..."
            sleep "$WAIT"
            continue
        fi

        if echo "$ERROR" | grep -qi "rate"; then
            WAIT=$((DELAY * 2))
            echo "  Rate limit error, waiting ${WAIT}s (attempt $attempt/$MAX_RETRIES)..."
            sleep "$WAIT"
            continue
        fi

        if [ -n "$ERROR" ] && [ "$ERROR" != "" ]; then
            echo "  Error: $ERROR (attempt $attempt/$MAX_RETRIES)"
            sleep "$DELAY"
            continue
        fi

        MATCH_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('matchId',''))" 2>/dev/null || echo "")

        if [ -n "$MATCH_ID" ] && [ "$MATCH_ID" != "" ]; then
            OPPONENT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('opponent',{}).get('name','unknown'))" 2>/dev/null || echo "unknown")
            QUEUED=$((QUEUED + 1))
            echo "[$QUEUED/$COUNT] $MATCH_ID vs $OPPONENT"
            echo "$MATCH_ID" >> "$PENDING"
            success=true
            break
        else
            echo "  Unexpected response (attempt $attempt/$MAX_RETRIES): $RESPONSE"
            sleep "$DELAY"
        fi
    done

    if [ "$success" = false ]; then
        FAILED=$((FAILED + 1))
        echo "  FAILED after $MAX_RETRIES attempts"
    fi

    # Wait between requests to respect rate limit
    [ "$i" -lt "$COUNT" ] && sleep "$DELAY"
done

echo ""
echo "Done: $QUEUED queued, $FAILED failed"
echo "Pending file: $(basename "$PENDING")"
