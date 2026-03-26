#!/bin/bash
# Download replay JSON for a match.
#
# Usage:
#   ./download-replay.sh <matchId>                     # saves to match-history/replay-{id}.json
#   ./download-replay.sh <matchId> scouting/hbfreed/   # saves to custom directory
#
# Also prints a one-line match summary.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MATCH_ID="${1:?Usage: download-replay.sh <matchId> [output-dir]}"
OUT_DIR="${2:-$PROJECT_DIR/match-history}"

mkdir -p "$OUT_DIR"

echo "Fetching match $MATCH_ID..."
RESP=$(clawber_get "/match/$MATCH_ID")

if [[ -z "$RESP" ]]; then
    echo "ERROR: Failed to fetch match"
    exit 1
fi

# Print summary
PARSED=$(parse_match "$RESP")
IFS='|' read -r OUTCOME OPPONENT OUR_K OUR_D THEIR_K THEIR_D REPLAY <<< "$PARSED"

if [[ "$OUTCOME" != "WIN" && "$OUTCOME" != "LOSS" ]]; then
    echo "Match not completed (status: $OUTCOME)"
    exit 1
fi

echo "  $OUTCOME vs $OPPONENT: ${OUR_K}K/${OUR_D}d vs ${THEIR_K}K/${THEIR_D}d"

if [[ -z "$REPLAY" ]]; then
    echo "  No replay URL available"
    exit 1
fi

TAG=$(echo "$OUTCOME" | head -c 1)  # W or L
FNAME="${TAG}-vs-${OPPONENT}-${MATCH_ID:0:8}.json"
FPATH="$OUT_DIR/$FNAME"

if [[ -f "$FPATH" ]]; then
    echo "  Already exists: $FPATH"
    exit 0
fi

echo "  Downloading replay..."
curl -sf "$REPLAY" -o "$FPATH"

if [[ $? -eq 0 ]]; then
    SIZE=$(wc -c < "$FPATH" | tr -d ' ')
    echo "  Saved: $FPATH ($SIZE bytes)"
else
    echo "  ERROR: Download failed"
    rm -f "$FPATH"
    exit 1
fi
