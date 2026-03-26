#!/bin/bash
# Shared library for all Clawber scripts
# Source this file: source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#
# Provides:
#   PROJECT_DIR, API_BASE, OUR_AGENT_ID, CLAWBER_API_KEY
#   clawber_get(path)          — unauthenticated GET, returns JSON
#   clawber_post(path)         — authenticated POST (empty body)
#   clawber_post_json(path, json) — authenticated POST with JSON body
#   parse_match(json)          — parse match JSON → "RESULT|opponent|ourK|ourD|theirK|theirD|replayUrl"
#   pending_file([name])       — returns path to pending file (default: pending.txt)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

source "$PROJECT_DIR/.env"

# ── Constants from API docs ──────────────────────────────────────────
API_BASE="https://clawber.ai/api/v1"
OUR_AGENT_ID="8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

# Match result fields (from GET /api/v1/match/{id}):
#   .status            → "pending" | "running" | "completed"
#   .winnerId          → botId of winner (NOT agentId!)
#   .participants[]    → array of 2 entries:
#     .botId           → UUID, changes every bot submission
#     .agentId         → UUID, stable across submissions  ← USE THIS TO IDENTIFY US
#     .agentName       → display name
#     .placement       → unreliable in timeout games, do NOT use for win/loss
#     .stats.kills     → number
#     .stats.damageDealt → number
#     .stats.survivalTicks → number (not always present)
#   .replayUrl         → S3 URL to replay JSON
#
# IMPORTANT: placement is unreliable in timeout/ammo-drought games.
#   winnerId is authoritative — the server determines the winner by remaining HP.
#   Previous damage tiebreak caused false losses (6 misclassified in 100 matches).

# Queue response fields (from POST /api/v1/match/queue):
#   .matchId           → UUID
#   .status            → "pending"
#   .botId             → our current botId
#   .botVersion        → number
#   .opponent.name     → opponent name
#   .opponent.isQueued → boolean
#   .error             → present on failure
#   .retryAfter        → seconds to wait (on 429)

# ── Helpers ──────────────────────────────────────────────────────────

clawber_get() {
    # GET request (no auth needed for public endpoints)
    local path="$1"
    curl -sf "${API_BASE}${path}" 2>/dev/null
}

clawber_post() {
    # POST with auth, empty body
    local path="$1"
    curl -sf -X POST "${API_BASE}${path}" \
        -H "Authorization: Bearer $CLAWBER_API_KEY" 2>/dev/null
}

clawber_post_json() {
    # POST with auth and JSON body
    local path="$1"
    local body="$2"
    curl -sf -X POST "${API_BASE}${path}" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $CLAWBER_API_KEY" \
        -d "$body" 2>/dev/null
}

parse_match() {
    # Parse a match JSON string → pipe-delimited summary
    # Output: "WIN|opponent|ourK|ourD|theirK|theirD|replayUrl"
    #     or: "LOSS|..."
    #     or: "PENDING||||||"
    #     or: "ERROR||||||"
    local json="$1"
    echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('status') != 'completed':
    print(f'{d.get(\"status\",\"ERROR\").upper()}||||||')
    sys.exit(0)
agent = '${OUR_AGENT_ID}'
parts = d.get('participants', [])
us = next((p for p in parts if p.get('agentId') == agent), None)
them = next((p for p in parts if p.get('agentId') != agent), None)
if not us or not them:
    print('ERROR||||||')
    sys.exit(0)
opp = them.get('agentName', '?')
uk = us.get('stats', {}).get('kills', 0)
ud = us.get('stats', {}).get('damageDealt', 0)
tk = them.get('stats', {}).get('kills', 0)
td = them.get('stats', {}).get('damageDealt', 0)
won = d.get('winnerId') == us.get('botId')
result = 'WIN' if won else 'LOSS'
replay = d.get('replayUrl', '')
print(f'{result}|{opp}|{uk}|{ud}|{tk}|{td}|{replay}')
" 2>/dev/null || echo "ERROR||||||"
}

pending_file() {
    # Returns path to a pending file. Default: pending.txt
    local name="${1:-pending}"
    # Strip .txt if provided
    name="${name%.txt}"
    echo "$PROJECT_DIR/match-history/${name}.txt"
}
