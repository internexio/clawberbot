#!/bin/bash
# Nightwatch Watchdog — detects and recovers from nightwatch outages
# Runs every 30 minutes via launchd. Checks if nightwatch-monitor has
# logged recently. If stale (>2 hours), restarts the launchd agent.
#
# This exists because macOS launchd silently stops StartInterval agents
# after ~24-33 runs. The watchdog catches this and bounces them.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$BASE_DIR/logs/nightwatch.log"
WATCHDOG_LOG="$BASE_DIR/logs/watchdog.log"
MONITOR_LABEL="com.semalytics.clawber-monitor"
HEARTBEAT_LABEL="com.semalytics.clawber-heartbeat"
STALE_SECONDS=7200  # 2 hours — monitor runs hourly so 2h = definitely stale
UID_NUM=$(id -u)

log() { echo "$(date -u +%FT%TZ) $1" >> "$WATCHDOG_LOG"; }

# Ensure log dir exists
mkdir -p "$(dirname "$WATCHDOG_LOG")"

# Check if nightwatch log exists
if [[ ! -f "$LOG_FILE" ]]; then
    log "WARN: No nightwatch log found at $LOG_FILE"
    exit 0
fi

# Get last modification time of nightwatch log
if [[ "$(uname)" == "Darwin" ]]; then
    LAST_MOD=$(stat -f %m "$LOG_FILE")
else
    LAST_MOD=$(stat -c %Y "$LOG_FILE")
fi
NOW=$(date +%s)
AGE=$(( NOW - LAST_MOD ))
AGE_MIN=$(( AGE / 60 ))

if [[ $AGE -lt $STALE_SECONDS ]]; then
    log "OK: nightwatch log is ${AGE_MIN}m old (threshold: $((STALE_SECONDS/60))m)"
    exit 0
fi

# Nightwatch is stale — restart the agents
log "ALERT: nightwatch log is ${AGE_MIN}m old — RESTARTING agents"

restart_agent() {
    local label="$1"
    local plist="$HOME/Library/LaunchAgents/${label}.plist"

    if [[ ! -f "$plist" ]] && [[ ! -L "$plist" ]]; then
        log "  SKIP: no plist for $label"
        return
    fi

    # Bootout (stop) then bootstrap (start)
    launchctl bootout "gui/${UID_NUM}/${label}" 2>/dev/null || true
    sleep 1
    launchctl bootstrap "gui/${UID_NUM}" "$plist" 2>&1 || {
        log "  FAIL: could not restart $label"
        return
    }
    log "  RESTARTED: $label"
}

restart_agent "$MONITOR_LABEL"
restart_agent "$HEARTBEAT_LABEL"

# Verify restart worked — wait for RunAtLoad to fire
sleep 15

if [[ "$(uname)" == "Darwin" ]]; then
    NEW_MOD=$(stat -f %m "$LOG_FILE")
else
    NEW_MOD=$(stat -c %Y "$LOG_FILE")
fi

if [[ $NEW_MOD -gt $LAST_MOD ]]; then
    log "RECOVERED: nightwatch is logging again"
else
    log "WARN: restarted agents but nightwatch log not yet updated"
fi
