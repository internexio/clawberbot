#!/bin/bash
# Quick queue script - inline curl loop. Reads key from .env (never hardcode).
KEY=$(grep -E '^CLAWBER_API_KEY=' "$(dirname "$0")/../.env" | cut -d= -f2-)
COUNT="${1:-50}"
NAME="${2:-pending}"
FILE="/Users/davidpedersen/Mini/clawberbot/match-history/${NAME}.txt"

echo "Queueing $COUNT matches → $(basename "$FILE")"
QUEUED=0
for i in $(seq 1 "$COUNT"); do
  R=$(curl -s -X POST "https://clawber.ai/api/v1/match/queue" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json")
  MID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('matchId',''))" 2>/dev/null)
  OPP=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('opponent',{}).get('name','?'))" 2>/dev/null)
  if [ -n "$MID" ] && [ "$MID" != "" ]; then
    echo "$MID" >> "$FILE"
    QUEUED=$((QUEUED + 1))
    echo "[$QUEUED/$COUNT] $MID vs $OPP"
  else
    RA=$(echo "$R" | python3 -c "import sys,json; ra=json.load(sys.stdin).get('retryAfter',''); print(ra if ra else '')" 2>/dev/null)
    if [ -n "$RA" ]; then
      W=$((RA + 2))
      echo "  Rate limited, waiting ${W}s..."
      sleep "$W"
      R=$(curl -s -X POST "https://clawber.ai/api/v1/match/queue" \
        -H "Authorization: Bearer $KEY" \
        -H "Content-Type: application/json")
      MID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('matchId',''))" 2>/dev/null)
      OPP=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('opponent',{}).get('name','?'))" 2>/dev/null)
      if [ -n "$MID" ] && [ "$MID" != "" ]; then
        echo "$MID" >> "$FILE"
        QUEUED=$((QUEUED + 1))
        echo "[$QUEUED/$COUNT] $MID vs $OPP"
      fi
    else
      echo "  Error: $R"
    fi
  fi
  [ "$i" -lt "$COUNT" ] && sleep 14
done
echo ""
echo "Done: $QUEUED queued → $(basename "$FILE")"
