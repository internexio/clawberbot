#!/bin/bash
# Check results for a batch of matches from a pending file.
#
# Usage:
#   ./batch-results.sh                    # reads pending.txt
#   ./batch-results.sh pending-v15b       # reads pending-v15b.txt
#   ./batch-results.sh pending-v15b.txt   # same thing
#
# Output: W-L summary, per-opponent breakdown, loss details with replay URLs.
# Completed matches are removed from the pending file.
# Loss JSONs are saved to match-history/loss-{matchId}.json.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PENDING_NAME="${1:-pending}"
PENDING=$(pending_file "$PENDING_NAME")

if [[ ! -f "$PENDING" ]]; then
    echo "No pending file: $PENDING"
    exit 1
fi

TOTAL=$(grep -c . "$PENDING" 2>/dev/null || echo 0)
if [[ "$TOTAL" -eq 0 ]]; then
    echo "Pending file is empty: $PENDING"
    exit 0
fi

echo "Checking $TOTAL matches from $(basename "$PENDING")..."
echo ""

# Do everything in Python to avoid bash 3 limitations on macOS
python3 << PYEOF
import json, subprocess, sys, time

AGENT = "${OUR_AGENT_ID}"
API_BASE = "${API_BASE}"
PROJECT_DIR = "${PROJECT_DIR}"
PENDING = "${PENDING}"

with open(PENDING) as f:
    match_ids = [line.strip() for line in f if line.strip()]

remaining = []
wins = 0
losses = 0
errors = 0
opp_wins = {}
opp_losses = {}
loss_lines = []

for mid in match_ids:
    import urllib.request, ssl
    ctx = ssl.create_default_context()
    try:
        req = urllib.request.Request(f"{API_BASE}/match/{mid}")
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"  ? {mid} — API error: {e}")
        remaining.append(mid)
        errors += 1
        continue

    status = data.get("status", "")
    if status != "completed":
        remaining.append(mid)
        continue

    parts = data.get("participants", [])
    us = next((p for p in parts if p.get("agentId") == AGENT), None)
    them = next((p for p in parts if p.get("agentId") != AGENT), None)

    if not us or not them:
        print(f"  ? {mid} — can't find participants")
        remaining.append(mid)
        errors += 1
        continue

    opp = them.get("agentName", "?")
    uk = us.get("stats", {}).get("kills", 0)
    ud = us.get("stats", {}).get("damageDealt", 0)
    tk = them.get("stats", {}).get("kills", 0)
    td = them.get("stats", {}).get("damageDealt", 0)
    # winnerId is authoritative (placement/damage can disagree in timeout games)
    won = data.get("winnerId") == us.get("botId")
    replay = data.get("replayUrl", "")

    if won:
        wins += 1
        opp_wins[opp] = opp_wins.get(opp, 0) + 1
    else:
        losses += 1
        opp_losses[opp] = opp_losses.get(opp, 0) + 1
        loss_lines.append(f"  LOSS vs {opp}: {uk}K/{ud}d vs {tk}K/{td}d ({mid[:8]})")
        # Save loss JSON
        with open(f"{PROJECT_DIR}/match-history/loss-{mid}.json", "w") as lf:
            json.dump(data, lf, indent=2)

    time.sleep(0.15)

# Update pending file
with open(PENDING, "w") as f:
    for mid in remaining:
        f.write(mid + "\n")

# Print summary
played = wins + losses
wr = (wins * 100 // played) if played > 0 else 0

print("=" * 47)
print(f" Results: {wins}W-{losses}L ({wr}% WR)")
if remaining:
    print(f" Still pending: {len(remaining)}")
if errors:
    print(f" Errors: {errors}")
print("=" * 47)

if played > 0:
    print()
    print("Opponents:")
    all_opps = sorted(set(list(opp_wins.keys()) + list(opp_losses.keys())))
    for opp in all_opps:
        w = opp_wins.get(opp, 0)
        l = opp_losses.get(opp, 0)
        marker = " <--" if l > 0 else ""
        print(f"  {w}W-{l}L  {opp}{marker}")

if loss_lines:
    print()
    print("Loss details:")
    for line in loss_lines:
        print(line)

print()
PYEOF
