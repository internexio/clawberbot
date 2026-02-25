#!/bin/bash
set -euo pipefail

# Register a new Clawber agent
# Usage: ./register.sh <agent-name> [referral-code]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

NAME="${1:?Usage: register.sh <agent-name> [referral-code]}"
REFERRAL="${2:-}"

BODY="{\"name\": \"$NAME\""
[ -n "$REFERRAL" ] && BODY="$BODY, \"referralCode\": \"$REFERRAL\""
BODY="$BODY}"

echo "Registering agent: $NAME"
RESPONSE=$(curl -s -X POST https://clawber.ai/api/v1/register \
  -H "Content-Type: application/json" \
  -d "$BODY")

echo "$RESPONSE" | python3 -m json.tool

# Extract and save API key
API_KEY=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])" 2>/dev/null)
if [ -n "$API_KEY" ]; then
    echo "CLAWBER_API_KEY=$API_KEY" > "$PROJECT_DIR/.env"
    echo ""
    echo "API key saved to .env"
    echo "Claim URL: $(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('claimUrl',''))" 2>/dev/null)"
fi
