#!/bin/bash
# Pull our recent head-to-head record vs CrabCrusher-0308 via the public agent endpoint.
#
# Usage:
#   ./cc-recent.sh [days]              # default: 7
#   ./cc-recent.sh 14 --download N     # also download N most recent loss replays
#
# Writes match IDs to match-history/cc-losses-{days}d.txt and cc-wins-{days}d.txt
# so you can pipe them through batch-results.sh / download-replay.sh.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DAYS="${1:-7}"
DOWNLOAD_N=0
if [[ "${2:-}" == "--download" ]]; then
    DOWNLOAD_N="${3:-5}"
fi

CC_AGENT_ID="ef7e1954-e275-4882-933b-a423946442f5"

CC_JSON=$(clawber_get "/agent/$CC_AGENT_ID")
if [[ -z "$CC_JSON" ]]; then
    echo "ERROR: failed to fetch CC agent endpoint" >&2
    exit 1
fi

LOSS_FILE="$PROJECT_DIR/match-history/cc-losses-${DAYS}d.txt"
WIN_FILE="$PROJECT_DIR/match-history/cc-wins-${DAYS}d.txt"

python3 - "$DAYS" "$LOSS_FILE" "$WIN_FILE" <<PY
import json, sys
from datetime import datetime, timezone, timedelta

days = int(sys.argv[1])
loss_path, win_path = sys.argv[2], sys.argv[3]

d = json.loads('''$(echo "$CC_JSON" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")''')
mh = d['matchHistory']

now = datetime.now(timezone.utc)
cutoff = now - timedelta(days=days)
def parse(s): return datetime.fromisoformat(s.replace('Z','+00:00'))

# From CC's perspective: isWin=True = CC won = our LOSS
recent = [m for m in mh if parse(m['matchDate']) >= cutoff]
our_losses = [m for m in recent if m['isWin']]
our_wins   = [m for m in recent if not m['isWin']]

our_losses.sort(key=lambda m: m['matchDate'], reverse=True)
our_wins.sort(key=lambda m: m['matchDate'], reverse=True)

with open(loss_path, 'w') as f:
    for m in our_losses: f.write(m['matchId'] + '\n')
with open(win_path, 'w') as f:
    for m in our_wins: f.write(m['matchId'] + '\n')

cc_w, cc_l = len(our_losses), len(our_wins)
total = cc_w + cc_l
wr = 100*cc_l/total if total else 0

print(f"Head-to-head vs CrabCrusher-0308, last {days}d:")
print(f"  SEMalytics: {cc_l}W-{cc_w}L  ({wr:.1f}% WR)  out of {total} matches")
print(f"  CC rating:        {d['agent']['rating']}")
print(f"  CC overall record: {d['stats']['wins']}W-{d['stats']['losses']}L ({d['stats']['winRate']}%)")
print()
print(f"Recent losses (newest first, first 10):")
for m in our_losses[:10]:
    print(f"  {m['matchDate']}  {m['matchId']}")
print()
print(f"Wrote {len(our_losses)} loss IDs → {loss_path}")
print(f"Wrote {len(our_wins)} win  IDs → {win_path}")
PY

if [[ "$DOWNLOAD_N" -gt 0 ]]; then
    echo
    echo "Downloading top $DOWNLOAD_N loss replays..."
    OUT_DIR="$PROJECT_DIR/scouting/crabcrusher-0308/recent-losses"
    mkdir -p "$OUT_DIR"
    head -n "$DOWNLOAD_N" "$LOSS_FILE" | while read -r mid; do
        [[ -z "$mid" ]] && continue
        "$SCRIPT_DIR/download-replay.sh" "$mid" "$OUT_DIR" 2>&1 | sed 's/^/  /'
    done
fi
