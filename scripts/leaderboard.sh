#!/bin/bash
set -euo pipefail

# Check Clawber leaderboard
# Usage: ./leaderboard.sh [limit]

LIMIT="${1:-20}"

curl -s "https://clawber.ai/api/v1/leaderboard?limit=$LIMIT&houseBots=false" | python3 -c "
import sys, json
data = json.load(sys.stdin)
board = data.get('leaderboard', [])
print(f'{'Rank':<5} {'Name':<25} {'Rating':<8} {'W-L':<12} {'Win%':<6}')
print('-' * 58)
for entry in board:
    rank = entry.get('rank', '?')
    name = entry.get('name', '?')[:24]
    rating = entry.get('rating', 0)
    wins = entry.get('wins', 0)
    losses = entry.get('losses', 0)
    wr = entry.get('winRate', 0)
    print(f'{rank:<5} {name:<25} {rating:<8} {wins}-{losses:<10} {wr}%')
"
