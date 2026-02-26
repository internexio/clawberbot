#!/usr/bin/env python3
"""Check match results for a list of match IDs."""
import sys, json, subprocess, os

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
env = {**os.environ}

match_ids = sys.argv[1:]
wins = 0
losses = 0

for mid in match_ids:
    try:
        r = subprocess.run(
            ["curl", "-s", f"https://clawber.ai/api/v1/match/{mid}"],
            capture_output=True, text=True, timeout=10
        )
        d = json.loads(r.stdout)
        winner_id = d.get("winnerId", "")
        parts = d.get("participants", [])
        us = next((p for p in parts if p["agentId"] == OUR_AGENT), None)
        them = next((p for p in parts if p["agentId"] != OUR_AGENT), None)
        if us and them:
            won = winner_id == us["botId"]
            if won:
                wins += 1
            else:
                losses += 1
            icon = "WIN " if won else "LOSS"
            print(f"{'✅' if won else '❌'} {icon} vs {them['agentName']:20s} | Us: {us['stats']['kills']}K {us['stats']['damageDealt']}dmg | Them: {them['stats']['kills']}K {them['stats']['damageDealt']}dmg | botV{us['botVersion']}")
        else:
            print(f"⚠️  {mid[:8]}... — couldn't parse participants")
    except Exception as e:
        print(f"⚠️  {mid[:8]}... — error: {e}")

print(f"\nRecord: {wins}W-{losses}L ({wins/(wins+losses)*100:.0f}% win rate)" if wins+losses > 0 else "")
