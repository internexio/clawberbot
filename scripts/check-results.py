#!/usr/bin/env python3
"""Check W/L for a pending batch with the correct field mapping.

The /match/{id} endpoint's `winnerId` is a *bot* ID, not an *agent* ID.
To determine if we won, you must:
  1) Read winnerId (botId of the winning bot).
  2) Find the matching participant entry; its agentId is the winning agent.
  3) Compare that to OUR_AGENT_ID.

batch-results.sh has a history of this bug class; this script is the
ground-truth fallback. Idempotent — does not consume the pending file.

Usage:
  python3 scripts/check-results.py <pending-name>
  python3 scripts/check-results.py v37r-abort
"""

import json
import os
import sys
import urllib.request

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUR_AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
API_BASE = "https://clawber.ai/api/v1"


def load_env():
    env_path = os.path.join(PROJECT_DIR, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def fetch_match(match_id, key):
    req = urllib.request.Request(
        f"{API_BASE}/match/{match_id}",
        headers={"Authorization": f"Bearer {key}"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=15).read())


def main():
    if len(sys.argv) < 2:
        print("usage: check-results.py <pending-name>", file=sys.stderr)
        sys.exit(2)
    name = sys.argv[1]
    if name.endswith(".txt"):
        name = name[:-4]
    pending = os.path.join(PROJECT_DIR, "match-history", f"{name}.txt")
    if not os.path.exists(pending):
        print(f"no pending file: {pending}", file=sys.stderr)
        sys.exit(2)

    load_env()
    key = os.environ.get("CLAWBER_API_KEY", "")
    if not key:
        print("CLAWBER_API_KEY missing", file=sys.stderr)
        sys.exit(2)

    with open(pending) as f:
        mids = [l.strip() for l in f if l.strip()]

    wins = losses = pending_count = 0
    losses_detail = []
    for mid in mids:
        d = fetch_match(mid, key)
        if d.get("status") != "completed":
            pending_count += 1
            continue

        winner_bot = d.get("winnerId", "")
        participants = d.get("participants", d.get("agents", []))
        winner_agent = None
        opp_name = "?"
        for a in participants:
            if a.get("botId") == winner_bot or a.get("id") == winner_bot:
                winner_agent = a.get("agentId")
            if a.get("agentId") != OUR_AGENT_ID:
                opp_name = a.get("agentName") or a.get("name") or "?"

        if winner_agent == OUR_AGENT_ID:
            wins += 1
        else:
            losses += 1
            losses_detail.append((mid[:8], opp_name))

    total = wins + losses
    pct = (wins / total * 100) if total else 0
    print(f"{name}: {wins}W-{losses}L  ({pct:.0f}%)  pending={pending_count}/{len(mids)}")
    if losses_detail:
        print("losses:")
        for short, opp in losses_detail:
            print(f"  {short}  vs {opp}")


if __name__ == "__main__":
    main()
