#!/bin/bash
set -euo pipefail

# Submit bot code to Clawber
# Usage: ./submit.sh <bot-file.js>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

source "$PROJECT_DIR/.env"

BOT_FILE="${1:?Usage: submit.sh <bot-file.js>}"
[ -f "$BOT_FILE" ] || BOT_FILE="$PROJECT_DIR/bots/$BOT_FILE"
[ -f "$BOT_FILE" ] || { echo "ERROR: File not found: $1"; exit 1; }

CODE=$(cat "$BOT_FILE")
SIZE=$(echo -n "$CODE" | wc -c | tr -d ' ')
echo "Submitting: $(basename "$BOT_FILE") ($SIZE bytes)"

# Escape code for JSON
JSON_CODE=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" < "$BOT_FILE")

RESPONSE=$(curl -s -X POST https://clawber.ai/api/v1/bot/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLAWBER_API_KEY" \
  -d "{\"code\": $JSON_CODE}")

echo "$RESPONSE" | python3 -m json.tool
