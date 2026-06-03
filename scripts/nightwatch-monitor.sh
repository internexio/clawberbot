#!/bin/bash
# Nightwatch Monitor — Queue 10 matches per hour, log results
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

# --- Heartbeat ---
# Moved OUT of this hourly monitor (2026-06-03): the docs recommend a heartbeat
# every 4h and beating hourly was overkill. The dedicated job
# com.semalytics.clawber-heartbeat now runs scripts/heartbeat.sh every 14400s (4h).
# This monitor stays hourly for leaderboard snapshots + config checks only.

# --- Configuration ---
# LADDER-ONLY MODE (2026-06-03): self-queuing disabled to slow how many matches
# we rack up for opponents to analyze. Heartbeat + monitoring stay ON, so we
# remain active on the auto-ladder and keep visibility. Set back to 1+ to resume
# self-queuing. (Note: most of our match volume is auto-ladder pairing, which
# only stops if we go inactive — i.e. stop the heartbeat below.)
MATCHES_PER_RUN=0
MAX_RETRIES=5
QUEUE_DELAY=14      # 60s / 5 matches = 12s, +2s buffer
MAX_POLLS=30
POLL_INTERVAL=10
TOTAL_WINS=0
TOTAL_LOSSES=0
TOTAL_ERRORS=0

# --- Queue and process a single match ---
run_match() {
  local MATCH_NUM=$1
  local MATCH_ID=""

  # Queue with retry
  for attempt in $(seq 1 $MAX_RETRIES); do
    log "QUEUE [$MATCH_NUM/$MATCHES_PER_RUN]: requesting match (attempt $attempt/$MAX_RETRIES)..."
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
    log "QUEUE [$MATCH_NUM]: FAILED after $MAX_RETRIES attempts"
    TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    return 1
  fi
  log "QUEUE [$MATCH_NUM]: match $MATCH_ID queued"

  # Poll for completion
  local STATUS=""
  local MATCH_RESP=""
  for i in $(seq 1 $MAX_POLLS); do
    sleep $POLL_INTERVAL
    MATCH_RESP=$(curl -s "$API_BASE/match/$MATCH_ID" -H "$AUTH" 2>&1)
    STATUS=$(echo "$MATCH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")

    if [[ "$STATUS" == "completed" ]]; then
      break
    fi
    if [[ "$STATUS" == "error" || "$STATUS" == "cancelled" ]]; then
      log "MATCH [$MATCH_NUM]: $MATCH_ID — status: $STATUS"
      TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
      return 1
    fi
  done

  if [[ "$STATUS" != "completed" ]]; then
    log "MATCH [$MATCH_NUM]: $MATCH_ID — timed out after $((MAX_POLLS * POLL_INTERVAL))s (status: $STATUS)"
    TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
    return 1
  fi

  # Parse result — winnerId is authoritative for timeout wins
  # (placement and damage tiebreak are unreliable in timeout/ammo-drought games)
  local RESULT
  RESULT=$(echo "$MATCH_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
agent = '$OUR_AGENT'
CC = 'edae262d-b7e4-4dd0-a8d0-3f34cb7c0a90'                 # CrabCrusher stable botId prefix
WATCH_NAMES = ('hbfreed','oztenbot','claudeopus','cfjbot','apexpincer','crabcrusher')
parts = d.get('participants', [])
us = next((p for p in parts if p['agentId'] == agent), None)
them = next((p for p in parts if p['agentId'] != agent), None)
if us and them:
    ud = us['stats']['damageDealt']
    td = them['stats']['damageDealt']
    won = d.get('winnerId') == us.get('botId')
    name = them.get('agentName','?')
    bid = str(them.get('botId',''))
    watch = bid.startswith(CC) or any(n in name.lower() for n in WATCH_NAMES)   # top-tier opponents
    print(f\"{'WIN' if won else 'LOSS'}|{name}|{us['stats']['kills']}|{ud}|{them['stats']['kills']}|{td}|{'WATCH' if watch else '-'}\")
else:
    print('UNKNOWN|||||||-')
" 2>/dev/null || echo "PARSE_ERROR|||||||-")

  IFS='|' read -r OUTCOME OPPONENT OUR_K OUR_D THEIR_K THEIR_D WATCH <<< "$RESULT"

  if [[ "$OUTCOME" == "WIN" ]]; then
    TOTAL_WINS=$((TOTAL_WINS + 1))
  else
    TOTAL_LOSSES=$((TOTAL_LOSSES + 1))
  fi

  log "MATCH [$MATCH_NUM]: $MATCH_ID — $OUTCOME vs $OPPONENT (us: ${OUR_K}K/${OUR_D}dmg, them: ${THEIR_K}K/${THEIR_D}dmg)"

  # Auto-capture: ALL losses + ANY watchlist match (wins INCLUDED). Fixes the
  # losses-only corpus gap — W/L lift analysis needs matched wins (esp. vs CC).
  if [[ "$OUTCOME" == "LOSS" || "${WATCH:-}" == "WATCH" ]]; then
    local TAG; TAG=$([[ "$OUTCOME" == "WIN" ]] && echo "win" || echo "loss")
    local OPP_SAFE="${OPPONENT// /_}"; OPP_SAFE="${OPP_SAFE//\//_}"
    local M_JSON="$BASE_DIR/match-history/${TAG}-${MATCH_ID}.json"
    echo "$MATCH_RESP" | python3 -m json.tool > "$M_JSON" 2>/dev/null || true
    log "CAPTURE[$TAG]: saved match JSON → $(basename "$M_JSON")"

    local REPLAY_URL
    REPLAY_URL=$(echo "$MATCH_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('replayUrl',''))" 2>/dev/null || echo "")
    if [[ -n "$REPLAY_URL" ]]; then
      local REPLAY_FILE="$BASE_DIR/match-history/replay-${TAG}-${OPP_SAFE}-${MATCH_ID:0:8}.json"
      curl -sf "$REPLAY_URL" -o "$REPLAY_FILE" 2>/dev/null && \
        log "CAPTURE[$TAG]: saved replay → $(basename "$REPLAY_FILE")" || \
        log "CAPTURE[$TAG]: replay download failed for $MATCH_ID"
    fi
  fi

  # Append CSV result
  local TS
  TS=$(date -u +%FT%TZ)
  echo "$TS,$MATCH_ID,$OUTCOME,$OPPONENT,$OUR_K,$OUR_D,$THEIR_K,$THEIR_D" >> "$RESULTS_FILE"

  # Alert on notable events
  if [[ "$OPPONENT" == *"hbfreed"* || "$OPPONENT" == *"oztenbot"* ]]; then
    log "*** TOP OPPONENT: $OUTCOME vs $OPPONENT ***"
  fi
}

# --- Queue matches (skipped entirely in ladder-only mode: MATCHES_PER_RUN=0) ---
log "=== NIGHTWATCH RUN START ($MATCHES_PER_RUN self-queued matches) ==="

if [[ "$MATCHES_PER_RUN" -gt 0 ]]; then
  for MATCH_NUM in $(seq 1 "$MATCHES_PER_RUN"); do
    run_match "$MATCH_NUM"

    # Wait between queues to respect rate limit (skip after last)
    if [[ "$MATCH_NUM" -lt "$MATCHES_PER_RUN" ]]; then
      sleep "$QUEUE_DELAY"
    fi
  done
else
  log "QUEUE: ladder-only mode — skipping self-queue, relying on auto-ladder pairing"
fi

# --- Retention: prune watchlist WIN captures older than 30d (losses kept indefinitely
#     — rarer and higher analytic value). Keeps the win corpus from growing unbounded. ---
find "$BASE_DIR/match-history" -maxdepth 1 -type f \
  \( -name 'win-*.json' -o -name 'replay-win-*.json' \) -mtime +30 -delete 2>/dev/null || true

# --- Daily game config check (once per day) ---
CONFIG_CHECK_FLAG="$LOG_DIR/.config-checked-$(date +%Y-%m-%d)"
if [[ ! -f "$CONFIG_CHECK_FLAG" ]]; then
  log "CONFIG-CHECK: running daily game config check..."
  CONFIG_RESULT=$("$SCRIPT_DIR/check-game-config.sh" --quiet 2>&1) || true
  if [[ -n "$CONFIG_RESULT" ]]; then
    log "CONFIG-CHECK: ⚠️ CHANGES DETECTED:"
    echo "$CONFIG_RESULT" | while read -r line; do log "CONFIG-CHECK:   $line"; done
    log "CONFIG-CHECK: Bot constants may be stale — review needed!"
    # Write alert for Claude to pick up
    echo "{\"triggered\":\"$(date -u +%FT%TZ)\",\"changes\":\"$(echo "$CONFIG_RESULT" | tr '\n' '; ')\"}" > "$LOG_DIR/config-alert.json"
  else
    log "CONFIG-CHECK: ✓ No changes detected"
  fi
  touch "$CONFIG_CHECK_FLAG"
fi

# --- Snapshot leaderboard (once per run, after all matches) ---
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

TS=$(date -u +%FT%TZ)
echo "$TS,$RANK,$ELO,$WINS,$LOSSES,$TOP_ELO,$TOP_NAME" >> "$LEADERBOARD_FILE"

# --- Circuit Breaker: auto-stop on anomalous WR (this run) ---
TOTAL_PLAYED=$((TOTAL_WINS + TOTAL_LOSSES))
if [[ "$TOTAL_PLAYED" -ge 8 && "$TOTAL_LOSSES" -ge 4 ]]; then
  WR_PCT=$((TOTAL_WINS * 100 / TOTAL_PLAYED))
  log "CIRCUIT BREAKER: WR ${WR_PCT}% (${TOTAL_WINS}W-${TOTAL_LOSSES}L) — below 60% threshold"
  log "CIRCUIT BREAKER: Unloading nightwatch plist to prevent further ELO loss"
  launchctl unload "$HOME/Library/LaunchAgents/com.clawberbot.nightwatch.plist" 2>/dev/null || true
  log "CIRCUIT BREAKER: Nightwatch STOPPED. Investigate before restarting."
fi

# --- Rolling WR Check: last 100 matches ---
ALERT_FILE="$LOG_DIR/wr-alert.json"
if [[ -f "$RESULTS_FILE" ]]; then
  ROLLING_DATA=$(tail -100 "$RESULTS_FILE" | awk -F',' '
    BEGIN { w=0; l=0; n=0 }
    NR>0 && $3 != "" {
      n++
      if ($3 == "WIN") w++
      else if ($3 == "LOSS") { l++; losses = losses $2 "|" $4 "|" $6 "|" $7 "\n" }
    }
    END {
      if (n > 0) printf "%d|%d|%d|%d", w, l, n, (w * 100 / n)
      else printf "0|0|0|0"
    }
  ')
  IFS='|' read -r R_WINS R_LOSSES R_TOTAL R_WR <<< "$ROLLING_DATA"

  log "ROLLING-100: ${R_WINS}W-${R_LOSSES}L (${R_WR}% WR over last ${R_TOTAL} matches)"

  if [[ "$R_TOTAL" -ge 50 && "$R_WR" -lt 85 ]]; then
    log "WR-ALERT: Rolling WR ${R_WR}% < 85% threshold over ${R_TOTAL} matches"

    # Collect loss details from last 100 matches
    LOSS_LINES=$(tail -100 "$RESULTS_FILE" | awk -F',' '$3 == "LOSS" { print $2 "," $4 "," $6 "," $7 }')
    LOSS_OPPONENTS=$(tail -100 "$RESULTS_FILE" | awk -F',' '$3 == "LOSS" { print $4 }' | sort | uniq -c | sort -rn | head -10)

    # Write alert file for Claude to pick up
    cat > "$ALERT_FILE" <<ALERT_EOF
{
  "triggered": "$(date -u +%FT%TZ)",
  "rolling_wins": $R_WINS,
  "rolling_losses": $R_LOSSES,
  "rolling_total": $R_TOTAL,
  "rolling_wr": $R_WR,
  "elo": "$ELO",
  "rank": "$RANK",
  "top_loss_opponents": "$(echo "$LOSS_OPPONENTS" | tr '\n' '; ')",
  "loss_match_ids": "$(tail -100 "$RESULTS_FILE" | awk -F',' '$3 == "LOSS" { printf $2 " " }')"
}
ALERT_EOF
    log "WR-ALERT: Wrote alert file → $ALERT_FILE"

    # Pause nightwatch and trigger auto-analysis
    log "WR-ALERT: Pausing nightwatch, triggering auto-analysis..."
    launchctl bootout "gui/$(id -u)/com.semalytics.clawber-monitor" 2>/dev/null || true

    # Trigger Claude auto-analysis in background
    if command -v claude &>/dev/null; then
      log "WR-ALERT: Launching Claude auto-analysis..."
      nohup claude -p "$(cat <<'PROMPT_EOF'
WR alert triggered. Rolling win rate dropped below 90%.

Read logs/wr-alert.json for details. Follow this process:
1. Read the alert file to get loss match IDs and opponent breakdown
2. Download and analyze the 3 most recent loss replays (scripts/download-replay.sh)
3. Identify the SINGLE primary cause of losses (one thing at a time)
4. Make ONE targeted fix to the current bot (bots/v22-zone-guard.js as base)
5. Submit the new bot version (scripts/submit.sh)
6. Queue 50 test matches (scripts/queue-match.sh 50 autofix)
7. Wait for results (scripts/batch-results.sh autofix)
8. If WR >= 90%, restart nightwatch: launchctl load ~/Library/LaunchAgents/com.clawberbot.nightwatch.plist
9. If WR < 90%, revert to v22 and restart nightwatch
10. Remove logs/wr-alert.json when done
PROMPT_EOF
      )" >> "$LOG_DIR/auto-analysis.log" 2>&1 &
      log "WR-ALERT: Claude auto-analysis launched (PID: $!)"
    else
      log "WR-ALERT: Claude CLI not found — manual analysis required"
      log "WR-ALERT: Run: claude -p 'Check logs/wr-alert.json and fix the bot'"
    fi
  else
    # Clear stale alert if WR recovered
    if [[ -f "$ALERT_FILE" ]]; then
      rm -f "$ALERT_FILE"
      log "WR-ALERT: Cleared — WR recovered to ${R_WR}%"
    fi
  fi
fi

# --- Damage Anomaly: detect possible game changes ---
if [[ "$TOTAL_PLAYED" -ge 5 ]]; then
  AVG_DMG=$(tail -"$TOTAL_PLAYED" "$RESULTS_FILE" | awk -F',' '{sum+=$6} END {if(NR>0) printf "%d", sum/NR; else print 0}')
  if [[ "$AVG_DMG" -lt 200 ]]; then
    log "DAMAGE ANOMALY: avg damage ${AVG_DMG} over last ${TOTAL_PLAYED} matches — possible game change"
  fi
fi

log "=== NIGHTWATCH RUN DONE: ${TOTAL_WINS}W-${TOTAL_LOSSES}L, ${TOTAL_ERRORS} errors ==="
