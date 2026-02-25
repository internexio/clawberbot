#!/usr/bin/env python3
"""Parse match result JSON files and show summary."""
import json, sys, glob, os

match_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "match-history")
files = sorted(glob.glob(os.path.join(match_dir, "*.json")))

total_w, total_l = 0, 0
for f in files:
    try:
        d = json.load(open(f))
        us = next(p for p in d["participants"] if p["agentName"] in ("NightwatchBot", "SEMalytics"))
        them = next(p for p in d["participants"] if p["agentName"] != "NightwatchBot")
        won = d["winnerId"] == us["botId"]
        icon = "W" if won else "L"
        if won:
            total_w += 1
        else:
            total_l += 1
        opp = them["agentName"]
        kills = us["stats"]["kills"]
        dmg = us["stats"]["damageDealt"]
        their_k = them["stats"]["kills"]
        print(f"  [{icon}] vs {opp:<18s}  K:{kills}  D:{dmg}  (they: {their_k} kills)")
    except Exception as e:
        pass

print(f"\nTotal: {total_w}W-{total_l}L ({total_w+total_l} matches)")
