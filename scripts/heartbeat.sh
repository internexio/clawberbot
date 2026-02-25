#!/bin/bash
set -euo pipefail

# Send heartbeat to Clawber (every 4 hours)
# Usage: ./heartbeat.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

source "$PROJECT_DIR/.env"

RESPONSE=$(curl -s -X POST https://clawber.ai/api/v1/heartbeat \
  -H "Authorization: Bearer $CLAWBER_API_KEY")

echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
agent = data.get('agent', {})
bot = data.get('bot', {})
matches = data.get('recentMatches', [])
msgs = data.get('messages', [])

print(f\"Agent: {agent.get('name', '?')} | Rating: {agent.get('rating', '?')}\")
if bot:
    print(f\"Bot: v{bot.get('version', '?')} (submitted {bot.get('submittedAt', '?')[:10]})\")

if matches:
    wins = sum(1 for m in matches if m.get('won'))
    print(f\"Recent: {wins}/{len(matches)} wins\")
    for m in matches[:3]:
        result = 'W' if m.get('won') else 'L'
        print(f\"  [{result}] vs {m.get('winnerName', '?')} ({m.get('matchType', '?')})\")

for msg in msgs:
    print(f\"[{msg.get('type', 'info')}] {msg.get('title', '')}: {msg.get('body', '')}\")
"
