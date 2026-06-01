#!/bin/bash
# Check a single match result.
#
# Usage:
#   ./match-status.sh <matchId>           # show summary + raw JSON
#   ./match-status.sh <matchId> --raw     # raw JSON only
#   ./match-status.sh <matchId> --save    # save to match-history/

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MATCH_ID="${1:?Usage: match-status.sh <matchId> [--raw] [--save]}"
RAW=false
SAVE=false
for arg in "$@"; do
    case "$arg" in
        --raw) RAW=true ;;
        --save) SAVE=true ;;
    esac
done

RESP=$(clawber_get "/match/$MATCH_ID")

if [[ -z "$RESP" ]]; then
    echo "ERROR: Failed to fetch match $MATCH_ID"
    exit 1
fi

if [[ "$RAW" == true ]]; then
    echo "$RESP" | python3 -m json.tool
    exit 0
fi

# Parse and show summary
PARSED=$(parse_match "$RESP")
IFS='|' read -r OUTCOME OPPONENT OUR_K OUR_D THEIR_K THEIR_D REPLAY <<< "$PARSED"

STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null)

if [[ "$STATUS" != "completed" ]]; then
    echo "Match $MATCH_ID: $STATUS"
    exit 0
fi

echo "$OUTCOME vs $OPPONENT"
echo "  Us:   ${OUR_K} kills, ${OUR_D} damage"
echo "  Them: ${THEIR_K} kills, ${THEIR_D} damage"

if [[ -n "$REPLAY" ]]; then
    echo "  Replay: $REPLAY"
fi

echo "  Watch: https://clawber.ai/match/$MATCH_ID"

if [[ "$SAVE" == true ]]; then
    DATE=$(date +%Y-%m-%d)
    FPATH="$PROJECT_DIR/match-history/${DATE}-${MATCH_ID}.json"
    echo "$RESP" | python3 -m json.tool > "$FPATH"
    echo "  Saved: $FPATH"
fi
