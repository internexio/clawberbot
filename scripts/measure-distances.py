#!/usr/bin/env python3
"""Measure actual distances in replay files — wins vs losses.

Extracts per-tick distance measurements to answer:
  1. How far apart are our bots from each other? (ally spread)
  2. How far are our bots from the nearest enemy? (engagement distance)
  3. At what distance do melee attacks land? (effective melee range)
  4. At what distance do abilities fire? (effective ability range)
  5. How far is the nearest ally when a bot dies? (isolation at death)
  6. How far are bots from the nearest ally when they deal damage? (support distance)

Usage:
    ./measure-distances.py scouting/wins-v15b/*.json scouting/velocity-comet/*.json
    ./measure-distances.py --wins scouting/wins-v15b/ --losses match-history/loss-*.json
"""

import json
import math
import os
import sys
from pathlib import Path
from collections import defaultdict

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"


def dist(a, b):
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def analyze_replay(filepath):
    """Extract distance measurements from a single replay."""
    with open(filepath) as f:
        data = json.load(f)

    # Identify our bots vs theirs
    meta = data.get("bots", [])
    our_ids = set()
    their_ids = set()
    for b in meta:
        if b.get("agentId") == OUR_AGENT:
            our_ids.add(b["id"])
        else:
            their_ids.add(b["id"])

    if not our_ids or not their_ids:
        return None

    # Determine if we won — winner field is a bot ID string like "botid:2"
    winner_id = data.get("winner", "")
    we_won = any(winner_id.startswith(bid.split(":")[0]) for bid in our_ids)

    frames = data.get("frames", [])
    map_id = data.get("mapId", "unknown")

    # ── Measurements ─────────────────────────────────────────────
    results = {
        "file": os.path.basename(filepath),
        "map": map_id,
        "won": we_won,
        "ticks": len(frames),
        # Per-tick measurements (sampled every 5 ticks for speed)
        "ally_nearest": [],       # nearest ally distance per bot per tick
        "ally_spread": [],        # max spread among alive allies per tick
        "enemy_nearest": [],      # nearest enemy per bot per tick
        # Event-based measurements
        "melee_distances": [],    # distance to target when melee damage dealt
        "ability_distances": [],  # distance to target when ability fires
        "death_ally_dist": [],    # nearest ally distance when one of our bots dies
        "death_enemy_dist": [],   # nearest enemy when our bot dies
        "damage_ally_dist": [],   # nearest ally when our bot deals damage
        # Phase measurements (early/mid/late)
        "ally_nearest_early": [],  # ticks 0-40
        "ally_nearest_mid": [],    # ticks 40-120
        "ally_nearest_late": [],   # ticks 120+
        "enemy_nearest_early": [],
        "enemy_nearest_mid": [],
        "enemy_nearest_late": [],
    }

    # Index events by tick for fast lookup
    ability_events = defaultdict(list)  # tick -> [ability events]
    damage_events = defaultdict(list)   # tick -> [damage events]
    kill_events = defaultdict(list)     # tick -> [kill events]

    for frame in frames:
        tick = frame["tick"]
        for evt in frame.get("events", []):
            t = evt.get("type")
            if t == "ability":
                ability_events[tick].append(evt)
            elif t == "damage" and evt.get("attackerId") != "zone":
                damage_events[tick].append(evt)
            elif t == "kill":
                kill_events[tick].append(evt)

    for frame in frames:
        tick = frame["tick"]
        bots = {b["id"]: b for b in frame.get("bots", [])}

        our_alive = {bid: bots[bid] for bid in our_ids
                     if bid in bots and bots[bid].get("alive")}
        their_alive = {bid: bots[bid] for bid in their_ids
                       if bid in bots and bots[bid].get("alive")}

        if not our_alive or not their_alive:
            continue

        # Sample every 5 ticks for per-tick stats
        if tick % 5 == 0:
            # Per-bot: nearest ally, nearest enemy
            for bid, bot in our_alive.items():
                # Nearest ally
                other_allies = [b for oid, b in our_alive.items() if oid != bid]
                if other_allies:
                    nearest_ally = min(dist(bot["position"], a["position"])
                                       for a in other_allies)
                    results["ally_nearest"].append(nearest_ally)

                    if tick <= 40:
                        results["ally_nearest_early"].append(nearest_ally)
                    elif tick <= 120:
                        results["ally_nearest_mid"].append(nearest_ally)
                    else:
                        results["ally_nearest_late"].append(nearest_ally)

                # Nearest enemy
                nearest_enemy = min(dist(bot["position"], e["position"])
                                     for e in their_alive.values())
                results["enemy_nearest"].append(nearest_enemy)

                if tick <= 40:
                    results["enemy_nearest_early"].append(nearest_enemy)
                elif tick <= 120:
                    results["enemy_nearest_mid"].append(nearest_enemy)
                else:
                    results["enemy_nearest_late"].append(nearest_enemy)

            # Team spread (max distance between any two allies)
            alive_list = list(our_alive.values())
            if len(alive_list) >= 2:
                max_spread = max(
                    dist(alive_list[i]["position"], alive_list[j]["position"])
                    for i in range(len(alive_list))
                    for j in range(i + 1, len(alive_list))
                )
                results["ally_spread"].append(max_spread)

        # ── Event-based: melee attack distances ──
        for evt in damage_events.get(tick, []):
            attacker_id = evt.get("attackerId")
            target_id = evt.get("targetId")
            dmg = evt.get("damage", 0)

            if attacker_id not in our_ids:
                continue
            if attacker_id not in bots or target_id not in bots:
                continue

            attacker = bots[attacker_id]
            target = bots[target_id]
            d = dist(attacker["position"], target["position"])

            # melee = 10 dmg, ability = 15 dmg
            if dmg == 10:
                results["melee_distances"].append(d)
            # For ability damage, we'll use ability event positions instead

            # Nearest ally when dealing damage
            other_allies = [b for oid, b in our_alive.items() if oid != attacker_id]
            if other_allies:
                nearest_ally = min(dist(attacker["position"], a["position"])
                                   for a in other_allies)
                results["damage_ally_dist"].append(nearest_ally)

        # ── Ability fire distances ──
        for evt in ability_events.get(tick, []):
            bot_id = evt.get("botId")
            if bot_id not in our_ids:
                continue
            if bot_id not in bots:
                continue
            target_pos = evt.get("targetPosition", {})
            if not target_pos:
                continue
            bot = bots[bot_id]
            d = dist(bot["position"], target_pos)
            results["ability_distances"].append(d)

        # ── Death measurements ──
        for evt in kill_events.get(tick, []):
            victim_id = evt.get("victimId") or evt.get("targetId")
            if not victim_id or victim_id not in our_ids:
                continue
            if victim_id not in bots:
                continue
            victim = bots[victim_id]

            # Nearest ally at death
            other_allies = [b for oid, b in our_alive.items()
                           if oid != victim_id]
            if other_allies:
                nearest_ally = min(dist(victim["position"], a["position"])
                                   for a in other_allies)
                results["death_ally_dist"].append(nearest_ally)

            # Nearest enemy at death
            if their_alive:
                nearest_enemy = min(dist(victim["position"], e["position"])
                                     for e in their_alive.values())
                results["death_enemy_dist"].append(nearest_enemy)

    return results


def percentile(vals, p):
    if not vals:
        return 0
    s = sorted(vals)
    idx = int(len(s) * p / 100)
    return s[min(idx, len(s) - 1)]


def median(vals):
    return percentile(vals, 50)


def mean(vals):
    return sum(vals) / len(vals) if vals else 0


def print_stats(label, vals, unit="u"):
    if not vals:
        print(f"  {label}: no data")
        return
    print(f"  {label}: med={median(vals):.0f}{unit}  "
          f"avg={mean(vals):.0f}{unit}  "
          f"p10={percentile(vals, 10):.0f}{unit}  "
          f"p90={percentile(vals, 90):.0f}{unit}  "
          f"(n={len(vals)})")


def main():
    # Collect replay files
    win_files = []
    loss_files = []

    # Parse args
    mode = None
    for arg in sys.argv[1:]:
        if arg == "--wins":
            mode = "wins"
            continue
        elif arg == "--losses":
            mode = "losses"
            continue

        path = Path(arg)
        if path.is_dir():
            files = sorted(path.glob("*.json"))
        else:
            import glob
            files = [Path(f) for f in sorted(glob.glob(arg))]

        for f in files:
            if mode == "wins":
                win_files.append(f)
            elif mode == "losses":
                loss_files.append(f)
            else:
                # Auto-detect from filename
                name = f.name.upper()
                if name.startswith("W-") or name.startswith("WIN"):
                    win_files.append(f)
                elif name.startswith("L-") or name.startswith("LOSS"):
                    loss_files.append(f)
                else:
                    # Will classify after parsing
                    win_files.append(f)  # placeholder

        mode = None

    all_files = [(f, True) for f in win_files] + [(f, False) for f in loss_files]
    if not all_files:
        print("Usage: measure-distances.py [--wins dir/] [--losses dir/] [files...]")
        sys.exit(1)

    # Analyze all replays
    win_results = []
    loss_results = []

    for filepath, expected_win in all_files:
        r = analyze_replay(filepath)
        if not r:
            print(f"  Skipped: {filepath} (couldn't parse)")
            continue
        # Use actual result, not filename guess
        if r["won"]:
            win_results.append(r)
        else:
            loss_results.append(r)

    print(f"\nAnalyzed: {len(win_results)} wins, {len(loss_results)} losses")
    print("=" * 70)

    # ── Aggregate and compare ──
    for label, results in [("WINS", win_results), ("LOSSES", loss_results)]:
        if not results:
            continue
        print(f"\n{'=' * 70}")
        print(f" {label} ({len(results)} matches)")
        print(f"{'=' * 70}")

        # Flatten all measurements
        ally_nearest = [v for r in results for v in r["ally_nearest"]]
        ally_spread = [v for r in results for v in r["ally_spread"]]
        enemy_nearest = [v for r in results for v in r["enemy_nearest"]]
        melee_dist = [v for r in results for v in r["melee_distances"]]
        ability_dist = [v for r in results for v in r["ability_distances"]]
        death_ally = [v for r in results for v in r["death_ally_dist"]]
        death_enemy = [v for r in results for v in r["death_enemy_dist"]]
        damage_ally = [v for r in results for v in r["damage_ally_dist"]]

        print(f"\n  ALLY SPACING (how close are allies to each other?)")
        print_stats("Nearest ally (all ticks)", ally_nearest)
        print_stats("Team spread (max pair)", ally_spread)

        # By phase
        ally_early = [v for r in results for v in r["ally_nearest_early"]]
        ally_mid = [v for r in results for v in r["ally_nearest_mid"]]
        ally_late = [v for r in results for v in r["ally_nearest_late"]]
        print_stats("  Early (t0-40)", ally_early)
        print_stats("  Mid   (t40-120)", ally_mid)
        print_stats("  Late  (t120+)", ally_late)

        print(f"\n  ENGAGEMENT (how close to enemies?)")
        print_stats("Nearest enemy (all ticks)", enemy_nearest)

        enemy_early = [v for r in results for v in r["enemy_nearest_early"]]
        enemy_mid = [v for r in results for v in r["enemy_nearest_mid"]]
        enemy_late = [v for r in results for v in r["enemy_nearest_late"]]
        print_stats("  Early (t0-40)", enemy_early)
        print_stats("  Mid   (t40-120)", enemy_mid)
        print_stats("  Late  (t120+)", enemy_late)

        print(f"\n  WEAPON RANGES (actual firing distances)")
        print_stats("Melee attack dist", melee_dist)
        print_stats("Ability fire dist", ability_dist)

        print(f"\n  SUPPORT (ally proximity during key moments)")
        print_stats("Nearest ally when dealing dmg", damage_ally)
        print_stats("Nearest ally at death", death_ally)
        print_stats("Nearest enemy at death", death_enemy)

    # ── Side-by-side comparison ──
    if win_results and loss_results:
        print(f"\n{'=' * 70}")
        print(f" WINS vs LOSSES — key differences")
        print(f"{'=' * 70}")

        comparisons = [
            ("Nearest ally (med)", "ally_nearest"),
            ("Team spread (med)", "ally_spread"),
            ("Nearest enemy (med)", "enemy_nearest"),
            ("Melee dist (med)", "melee_distances"),
            ("Ability dist (med)", "ability_distances"),
            ("Ally dist at death (med)", "death_ally_dist"),
            ("Ally dist when dealing dmg (med)", "damage_ally_dist"),
        ]

        print(f"\n  {'Metric':<35} {'Wins':>8} {'Losses':>8} {'Delta':>8}")
        print(f"  {'-'*62}")

        for label, key in comparisons:
            w_vals = [v for r in win_results for v in r[key]]
            l_vals = [v for r in loss_results for v in r[key]]
            w_med = median(w_vals) if w_vals else 0
            l_med = median(l_vals) if l_vals else 0
            delta = l_med - w_med
            sign = "+" if delta > 0 else ""
            print(f"  {label:<35} {w_med:>7.0f}u {l_med:>7.0f}u {sign}{delta:>7.0f}u")

        # Phase comparison
        print(f"\n  Nearest ally by phase:")
        for phase, key_suffix in [("Early (t0-40)", "early"),
                                   ("Mid (t40-120)", "mid"),
                                   ("Late (t120+)", "late")]:
            key = f"ally_nearest_{key_suffix}"
            w_vals = [v for r in win_results for v in r[key]]
            l_vals = [v for r in loss_results for v in r[key]]
            w_med = median(w_vals) if w_vals else 0
            l_med = median(l_vals) if l_vals else 0
            delta = l_med - w_med
            sign = "+" if delta > 0 else ""
            print(f"    {phase:<33} {w_med:>7.0f}u {l_med:>7.0f}u {sign}{delta:>7.0f}u")


if __name__ == "__main__":
    main()
