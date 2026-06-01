#\!/bin/bash
# Happy tmux watchdog for clawberbot — launchd keeps this running
set -uo pipefail

# DEPRECATED: Use happy-orchestrator.sh instead. Orchestrator will auto-kill this.
# Pause switch: respect /tmp/happy-paused
PAUSE_FILE="/tmp/happy-paused"
if [ -f "$PAUSE_FILE" ]; then
    echo "[$(date -u +%FT%TZ)] PAUSED ($(cat "$PAUSE_FILE" 2>/dev/null)). Sleeping 60s." >> "/Users/davidpedersen/agent-workflow/happy-clawberbot-watchdog.log"
    sleep 60
    exit 0
fi

SESSION="clawberbot"
WORKDIR="$HOME/Mini/clawberbot"   # canonical path (~/Scripts is a symlink to ~/Mini — same dir)
LOG="$HOME/agent-workflow/clawberbot-happy.log"
TMUX="/opt/homebrew/bin/tmux"
HAPPY="/opt/homebrew/bin/happy"
LOCKFILE="/tmp/clawberbot-watchdog.lock"

set +u; source ~/.zshrc 2>/dev/null || true; set -u

log() { echo "[$(date -u +%FT%TZ)] $1" >> "$LOG"; }

# ── Guard: only one watchdog at a time ──────────────────────────
if [ -f "$LOCKFILE" ]; then
    OLD_PID=$(cat "$LOCKFILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        log "Another watchdog (PID $OLD_PID) is alive, exiting"
        exit 0
    else
        log "Stale lock file found (PID $OLD_PID dead), taking over"
    fi
fi
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

log "Watchdog started (PID $$)"

ensure_session() {
    SESSION_COUNT=$($TMUX list-sessions -F "#{session_name}" 2>/dev/null | grep -c "^${SESSION}$" || true)
    if [ "$SESSION_COUNT" -gt 0 ]; then
        log "WARNING: Found $SESSION_COUNT existing session(s), killing all"
        $TMUX kill-session -t "$SESSION" 2>/dev/null
        sleep 1
    fi

    log "Creating new session"
    $TMUX new-session -d -s "$SESSION" -c "$WORKDIR" "happy --yolo"

    sleep 5
    $TMUX send-keys -t "$SESSION" Down
    sleep 1
    $TMUX send-keys -t "$SESSION" Enter
    log "Auto-accepted yolo prompt"
    return 0
}

ensure_session

# ── Monitor loop: check session AND happy process health ────────
while true; do
    sleep 10

    if \! $TMUX has-session -t "$SESSION" 2>/dev/null; then
        log "Session died, exiting for restart"
        exit 1
    fi

    PANE_PID=$($TMUX display-message -t "$SESSION" -p "#{pane_pid}" 2>/dev/null || true)
    if [ -z "$PANE_PID" ] || \! kill -0 "$PANE_PID" 2>/dev/null; then
        log "Happy process died inside session (pane PID: ${PANE_PID:-none}), killing session"
        $TMUX kill-session -t "$SESSION" 2>/dev/null
        exit 1
    fi
done
