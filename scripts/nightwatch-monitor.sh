#!/bin/bash
# Nightwatch Monitor — Queue one match per hour, log results
# Designed to run via launchd on Mac Mini
#
# Usage: nightwatch-monitor.sh [--heartbeat]
#   --heartbeat: Also send heartbeat (run every 2 hours)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$BASE_DIR/.env"
LOG_DIR="$BASE_DIR/logs"
LOG_FILE="$LOG_DIR/nightwatch.log"
RESULTS_FILE="$LOG_DIR/results.csv"
LEADERBOARD_FILE="$LOG_DIR/leaderboard-history.csv"

# Our agent ID
OUR_AGENT="8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
API_BASE="https://clawber.ai/api/v1"

# Load API key
if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -u +%FT%TZ) ERROR: No .env file at $ENV_FILE" >> "$LOG_FILE"
  exit 1
fi
export $(grep -v '^#' "$ENV_FILE" | xargs)

if [[ -z "${CLAWBER_API_KEY:-}" ]]; then
  echo "$(date -u +%FT%TZ) ERROR: CLAWBER_API_KEY not set" >> "$LOG_FILE"
  exit 1
fi

AUTH="Authorization: Bearer $CLAWBER_API_KEY"

mkdir -p "$LOG_DIR"

log() {
  echo "$(date -u +%FT%TZ) $*" >> "$LOG_FILE"
}

# Initialize CSV headers if needed
if [[ ! -f "$RESULTS_FILE" ]]; then
  echo "timestamp,match_id,result,opponent,our_kills,our_dmg,their_kills,their_dmg,our_elo" > "$RESULTS_FILE"
fi
if [[ ! -f "$LEADERBOARD_FILE" ]]; then
  echo "timestamp,our_rank,our_elo,our_wins,our_losses,top_elo,top_name" > "$LEADERBOARD_FILE"
fi

# --- Heartbeat (optional) ---
if [[ "${1:-}" == "--heartbeat" ]]; then
  log "HEARTBEAT: sending..."
  HB=$(curl -s -X POST "$API_BASE/heartbeat" -H "$AUTH" 2>&1)
  log "HEARTBEAT: $HB"
fi

# --- Queue a match (with retry for rate limits) ---
MAX_RETRIES=5
MATCH_ID=""

for attempt in $(seq 1 $MAX_RETRIES); do
  log "QUEUE: requesting match (attempt $attempt/$MAX_RETRIES)..."
  QUEUE_RESP=$(curl -s -X POST "$API_BASE/match/queue" -H "$AUTH" 2>&1)

  # Check for rate limit
  RETRY_AFTER=$(echo "$QUEUE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('retryAfter',''))" 2>/dev/null || echo "")
  if [[ -n "$RETRY_AFTER" && "$RETRY_AFTER" != "None" ]]; then
    WAIT=$((RETRY_AFTER + 5))
    log "QUEUE: rate limited, waiting ${WAIT}s..."
    sleep "$WAIT"
    continue
  fi

  MATCH_ID=$(echo "$QUEUE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('matchId',''))" 2>/dev/null || echo "")
  if [[ -n "$MATCH_ID" ]]; then
    break
  fi

  log "QUEUE: unexpected response: $QUEUE_RESP"
  sleep 10
done

if [[ -z "$MATCH_ID" ]]; then
  log "QUEUE: FAILED after $MAX_RETRIES attempts"
  exit 1
fi
log "QUEUE: match $MATCH_ID queued"

# --- Poll for completion (max 5 minutes) ---
MAX_POLLS=30
POLL_INTERVAL=10
STATUS=""

for i in $(seq 1 $MAX_POLLS); do
  sleep $POLL_INTERVAL
  MATCH_RESP=$(curl -s "$API_BASE/match/$MATCH_ID" -H "$AUTH" 2>&1)
  STATUS=$(echo "$MATCH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")

  if [[ "$STATUS" == "completed" ]]; then
    break
  fi
  if [[ "$STATUS" == "error" || "$STATUS" == "cancelled" ]]; then
    log "MATCH: $MATCH_ID — status: $STATUS"
    exit 1
  fi
done

if [[ "$STATUS" != "completed" ]]; then
  log "MATCH: $MATCH_ID — timed out after $((MAX_POLLS * POLL_INTERVAL))s (status: $STATUS)"
  exit 1
fi

# --- Parse result ---
RESULT=$(echo "$MATCH_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
agent = '$OUR_AGENT'
winner = d.get('winnerId', '')
parts = d.get('participants', [])
us = next((p for p in parts if p['agentId'] == agent), None)
them = next((p for p in parts if p['agentId'] != agent), None)
if us and them:
    won = winner == us.get('botId', '')
    print(f\"{'WIN' if won else 'LOSS'}|{them.get('agentName','?')}|{us['stats']['kills']}|{us['stats']['damageDealt']}|{them['stats']['kills']}|{them['stats']['damageDealt']}\")
else:
    print('UNKNOWN|||||||')
" 2>/dev/null || echo "PARSE_ERROR||||||")

IFS='|' read -r OUTCOME OPPONENT OUR_K OUR_D THEIR_K THEIR_D <<< "$RESULT"

log "MATCH: $MATCH_ID — $OUTCOME vs $OPPONENT (us: ${OUR_K}K/${OUR_D}dmg, them: ${THEIR_K}K/${THEIR_D}dmg)"

# --- Snapshot leaderboard ---
LB_DATA=$(curl -s "$API_BASE/leaderboard" -H "$AUTH" 2>&1)
LB_INFO=$(echo "$LB_DATA" | python3 -c "
import sys, json
agent = '$OUR_AGENT'
d = json.load(sys.stdin)
agents = d if isinstance(d, list) else d.get('agents', d.get('leaderboard', []))
us = None
top = None
for i, a in enumerate(agents):
    if a.get('agentId') == agent or a.get('id') == agent:
        us = {'rank': i+1, 'elo': a.get('rating', a.get('elo', 0)), 'wins': a.get('wins', 0), 'losses': a.get('losses', 0)}
    if i == 0:
        top = {'elo': a.get('rating', a.get('elo', 0)), 'name': a.get('agentName', a.get('name', '?'))}
if us and top:
    print(f\"{us['rank']}|{us['elo']}|{us['wins']}|{us['losses']}|{top['elo']}|{top['name']}\")
else:
    print('?|?|?|?|?|?')
" 2>/dev/null || echo "?|?|?|?|?|?")

IFS='|' read -r RANK ELO WINS LOSSES TOP_ELO TOP_NAME <<< "$LB_INFO"

log "LEADERBOARD: #$RANK at $ELO ELO (${WINS}W-${LOSSES}L) | #1: $TOP_NAME at $TOP_ELO"

# --- Append CSV results ---
TS=$(date -u +%FT%TZ)
echo "$TS,$MATCH_ID,$OUTCOME,$OPPONENT,$OUR_K,$OUR_D,$THEIR_K,$THEIR_D,$ELO" >> "$RESULTS_FILE"
echo "$TS,$RANK,$ELO,$WINS,$LOSSES,$TOP_ELO,$TOP_NAME" >> "$LEADERBOARD_FILE"

# --- Alert on notable events ---
if [[ "$OPPONENT" == *"hbfreed"* ]]; then
  log "*** HBFREED MATCH: $OUTCOME vs $OPPONENT — ELO gap: $((TOP_ELO - ELO)) ***"
fi

log "--- done ---"
