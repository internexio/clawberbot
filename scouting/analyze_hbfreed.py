#!/usr/bin/env python3
"""
Analyze hbfreed-opus replays: compare our wins vs losses.
L-vs-SEMalytics = hbfreed lost = we WON
W-vs-SEMalytics = hbfreed won  = we LOST
"""

import json
import os
import math
from collections import defaultdict
from itertools import combinations

REPLAY_DIR = "/Users/davidpedersen/Scripts/clawberbot/scouting/hbfreed-opus"
OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
HB_AGENT = "dfe4a24a-3230-4142-b555-1df19bab19cc"


def dist(p1, p2):
    return math.sqrt((p1["x"] - p2["x"]) ** 2 + (p1["y"] - p2["y"]) ** 2)


def avg_pairwise_dist(positions):
    """Average distance between all pairs of positions."""
    if len(positions) < 2:
        return 0
    total = 0
    count = 0
    pairs = list(combinations(positions, 2))
    for p1, p2 in pairs:
        total += dist(p1, p2)
        count += 1
    return total / count if count > 0 else 0


def max_pairwise_dist(positions):
    """Max distance between any pair (spread diameter)."""
    if len(positions) < 2:
        return 0
    pairs = list(combinations(positions, 2))
    return max(dist(p1, p2) for p1, p2 in pairs)


def analyze_replay(filepath):
    with open(filepath) as f:
        data = json.load(f)

    # Identify our bots vs their bots
    our_bot_ids = set()
    hb_bot_ids = set()
    for bot in data["bots"]:
        if bot["agentId"] == OUR_AGENT:
            our_bot_ids.add(bot["id"])
        else:
            hb_bot_ids.add(bot["id"])

    if not our_bot_ids or not hb_bot_ids:
        return None  # Not a SEMalytics vs hbfreed match

    result = {
        "file": os.path.basename(filepath),
        "matchId": data["matchId"],
        "mapId": data["mapId"],
        "duration": data["duration"],  # total ticks
    }

    frames = data["frames"]

    # === 1. SPAWN SPREAD (tick 0) ===
    frame0 = frames[0]
    our_positions_t0 = []
    hb_positions_t0 = []
    for bot in frame0["bots"]:
        if bot["id"] in our_bot_ids:
            our_positions_t0.append(bot["position"])
        elif bot["id"] in hb_bot_ids:
            hb_positions_t0.append(bot["position"])

    result["our_spawn_avg_dist"] = avg_pairwise_dist(our_positions_t0)
    result["our_spawn_max_dist"] = max_pairwise_dist(our_positions_t0)
    result["hb_spawn_avg_dist"] = avg_pairwise_dist(hb_positions_t0)
    result["hb_spawn_max_dist"] = max_pairwise_dist(hb_positions_t0)

    # === 2. TIME TO FIRST KILL (each side) ===
    our_first_kill_tick = None
    hb_first_kill_tick = None
    all_kills = []

    for frame in frames:
        for event in frame["events"]:
            if event["type"] == "kill":
                kill_tick = event["tick"]
                killer_id = event["killerId"]
                victim_id = event["victimId"]
                all_kills.append(event)

                if killer_id in our_bot_ids and our_first_kill_tick is None:
                    our_first_kill_tick = kill_tick
                elif killer_id in hb_bot_ids and hb_first_kill_tick is None:
                    hb_first_kill_tick = kill_tick

    result["our_first_kill_tick"] = our_first_kill_tick
    result["hb_first_kill_tick"] = hb_first_kill_tick
    result["total_kills"] = len(all_kills)

    # Count kills by side
    our_kills = sum(1 for k in all_kills if k["killerId"] in our_bot_ids)
    hb_kills = sum(1 for k in all_kills if k["killerId"] in hb_bot_ids)
    # Zone kills (neither side gets credit, or killerId might be zone)
    zone_kills = len(all_kills) - our_kills - hb_kills
    result["our_total_kills"] = our_kills
    result["hb_total_kills"] = hb_kills
    result["zone_kills"] = zone_kills

    # === 3. PACK FORMATION TIME ===
    # When do ALL alive bots converge within 300u avg pairwise distance?
    our_pack_tick = None
    hb_pack_tick = None

    for frame in frames:
        tick = frame["tick"]
        our_alive_pos = []
        hb_alive_pos = []
        for bot in frame["bots"]:
            if bot["alive"]:
                if bot["id"] in our_bot_ids:
                    our_alive_pos.append(bot["position"])
                elif bot["id"] in hb_bot_ids:
                    hb_alive_pos.append(bot["position"])

        if our_pack_tick is None and len(our_alive_pos) >= 3:
            avg_d = avg_pairwise_dist(our_alive_pos)
            if avg_d <= 300:
                our_pack_tick = tick

        if hb_pack_tick is None and len(hb_alive_pos) >= 3:
            avg_d = avg_pairwise_dist(hb_alive_pos)
            if avg_d <= 300:
                hb_pack_tick = tick

    result["our_pack_tick"] = our_pack_tick
    result["hb_pack_tick"] = hb_pack_tick

    # === 4. ABILITY USAGE ===
    our_abilities = 0
    hb_abilities = 0
    our_attacks = 0  # melee damage events
    hb_attacks = 0

    for frame in frames:
        for event in frame["events"]:
            if event["type"] == "ability":
                if event["botId"] in our_bot_ids:
                    our_abilities += 1
                elif event["botId"] in hb_bot_ids:
                    hb_abilities += 1
            elif event["type"] == "damage":
                attacker = event["attackerId"]
                dmg = event["damage"]
                if attacker in our_bot_ids:
                    if dmg == 10:
                        our_attacks += 1
                elif attacker in hb_bot_ids:
                    if dmg == 10:
                        hb_attacks += 1

    result["our_abilities"] = our_abilities
    result["hb_abilities"] = hb_abilities
    result["our_melee_attacks"] = our_attacks
    result["hb_melee_attacks"] = hb_attacks

    # === 5. FIRST 30 TICKS ===
    our_alive_at_30 = 5
    hb_alive_at_30 = 5
    our_alive_at_50 = 5
    hb_alive_at_50 = 5

    # Track bot death ticks
    our_death_ticks = []
    hb_death_ticks = []

    for frame in frames:
        for event in frame["events"]:
            if event["type"] == "kill":
                victim = event["victimId"]
                tick = event["tick"]
                if victim in our_bot_ids:
                    our_death_ticks.append(tick)
                elif victim in hb_bot_ids:
                    hb_death_ticks.append(tick)

    our_alive_at_30 = 5 - sum(1 for t in our_death_ticks if t <= 30)
    hb_alive_at_30 = 5 - sum(1 for t in hb_death_ticks if t <= 30)
    our_alive_at_50 = 5 - sum(1 for t in our_death_ticks if t <= 50)
    hb_alive_at_50 = 5 - sum(1 for t in hb_death_ticks if t <= 50)

    result["our_alive_at_30"] = our_alive_at_30
    result["hb_alive_at_30"] = hb_alive_at_30
    result["our_alive_at_50"] = our_alive_at_50
    result["hb_alive_at_50"] = hb_alive_at_50
    result["our_deaths_first_30"] = 5 - our_alive_at_30
    result["hb_deaths_first_30"] = 5 - hb_alive_at_30

    # === 6. DAMAGE EFFICIENCY ===
    our_total_damage = 0
    hb_total_damage = 0

    for frame in frames:
        for event in frame["events"]:
            if event["type"] == "damage":
                attacker = event["attackerId"]
                dmg = event["damage"]
                if attacker in our_bot_ids:
                    our_total_damage += dmg
                elif attacker in hb_bot_ids:
                    hb_total_damage += dmg

    result["our_total_damage"] = our_total_damage
    result["hb_total_damage"] = hb_total_damage

    our_total_actions = our_abilities + our_attacks
    hb_total_actions = hb_abilities + hb_attacks
    result["our_damage_per_action"] = our_total_damage / our_total_actions if our_total_actions > 0 else 0
    result["hb_damage_per_action"] = hb_total_damage / hb_total_actions if hb_total_actions > 0 else 0

    # === 7. HEALTH TOTALS AT KEY TICKS ===
    for check_tick in [30, 50, 80]:
        if check_tick < len(frames):
            frame = frames[check_tick]
            our_hp = sum(b["health"] for b in frame["bots"] if b["id"] in our_bot_ids and b["alive"])
            hb_hp = sum(b["health"] for b in frame["bots"] if b["id"] in hb_bot_ids and b["alive"])
            result[f"our_hp_at_{check_tick}"] = our_hp
            result[f"hb_hp_at_{check_tick}"] = hb_hp
        else:
            result[f"our_hp_at_{check_tick}"] = None
            result[f"hb_hp_at_{check_tick}"] = None

    # === EXTRA: Who gets first blood? ===
    if all_kills:
        first_kill = all_kills[0]
        result["first_blood_side"] = "us" if first_kill["killerId"] in our_bot_ids else "them"
        result["first_blood_tick"] = first_kill["tick"]
    else:
        result["first_blood_side"] = None
        result["first_blood_tick"] = None

    # === EXTRA: Distance between teams at spawn ===
    # Average distance from our centroid to their centroid
    if our_positions_t0 and hb_positions_t0:
        our_cx = sum(p["x"] for p in our_positions_t0) / len(our_positions_t0)
        our_cy = sum(p["y"] for p in our_positions_t0) / len(our_positions_t0)
        hb_cx = sum(p["x"] for p in hb_positions_t0) / len(hb_positions_t0)
        hb_cy = sum(p["y"] for p in hb_positions_t0) / len(hb_positions_t0)
        result["team_spawn_distance"] = math.sqrt((our_cx - hb_cx) ** 2 + (our_cy - hb_cy) ** 2)
    else:
        result["team_spawn_distance"] = None

    # === EXTRA: Our centroid distance to zone center at tick 0 ===
    zone = frame0["zone"]
    if our_positions_t0:
        our_cx = sum(p["x"] for p in our_positions_t0) / len(our_positions_t0)
        our_cy = sum(p["y"] for p in our_positions_t0) / len(our_positions_t0)
        result["our_dist_to_zone_center_t0"] = math.sqrt(
            (our_cx - zone["centerX"]) ** 2 + (our_cy - zone["centerY"]) ** 2
        )
    else:
        result["our_dist_to_zone_center_t0"] = None

    return result


def main():
    wins = []  # L-vs-SEMalytics = hbfreed lost = we won
    losses = []  # W-vs-SEMalytics = hbfreed won = we lost

    for filename in sorted(os.listdir(REPLAY_DIR)):
        if not filename.endswith(".json"):
            continue
        # Skip non-SEMalytics matches
        if "SEMalytics" not in filename:
            continue

        filepath = os.path.join(REPLAY_DIR, filename)
        result = analyze_replay(filepath)
        if result is None:
            continue

        if filename.startswith("L-"):
            wins.append(result)
        elif filename.startswith("W-"):
            losses.append(result)

    print(f"{'=' * 80}")
    print(f"HBFREED-OPUS REPLAY ANALYSIS: {len(wins)} WINS vs {len(losses)} LOSSES")
    print(f"{'=' * 80}")

    # === INDIVIDUAL MATCH SUMMARIES ===
    print(f"\n{'=' * 80}")
    print("INDIVIDUAL MATCH DETAILS")
    print(f"{'=' * 80}")

    for label, matches in [("OUR WINS", wins), ("OUR LOSSES", losses)]:
        print(f"\n--- {label} ---")
        for m in matches:
            fb = f"FB={'us' if m['first_blood_side'] == 'us' else 'them'}@{m['first_blood_tick']}" if m[
                "first_blood_tick"
            ] else "no kills"
            print(
                f"  {m['file'][:40]:<40} map={m['mapId']:<16} "
                f"spawn_spread={m['our_spawn_avg_dist']:.0f}u "
                f"pack@{m['our_pack_tick'] or 'never':<5} "
                f"{fb} "
                f"alive@30={m['our_alive_at_30']}v{m['hb_alive_at_30']} "
                f"abilities={m['our_abilities']}v{m['hb_abilities']} "
                f"dur={m['duration']}"
            )

    # === STATISTICAL COMPARISON ===
    def avg(lst):
        return sum(lst) / len(lst) if lst else 0

    def median(lst):
        if not lst:
            return 0
        s = sorted(lst)
        n = len(s)
        if n % 2 == 0:
            return (s[n // 2 - 1] + s[n // 2]) / 2
        return s[n // 2]

    print(f"\n{'=' * 80}")
    print("STATISTICAL COMPARISON: WINS vs LOSSES")
    print(f"{'=' * 80}")

    # 1. Spawn spread
    print(f"\n--- 1. SPAWN SPREAD (our bots avg pairwise distance at tick 0) ---")
    win_spreads = [m["our_spawn_avg_dist"] for m in wins]
    loss_spreads = [m["our_spawn_avg_dist"] for m in losses]
    print(f"  WINS:   avg={avg(win_spreads):.0f}u  median={median(win_spreads):.0f}u  range=[{min(win_spreads):.0f}-{max(win_spreads):.0f}]")
    print(f"  LOSSES: avg={avg(loss_spreads):.0f}u  median={median(loss_spreads):.0f}u  range=[{min(loss_spreads):.0f}-{max(loss_spreads):.0f}]")
    print(f"  MAX spawn spread (diameter):")
    win_max_spreads = [m["our_spawn_max_dist"] for m in wins]
    loss_max_spreads = [m["our_spawn_max_dist"] for m in losses]
    print(f"  WINS:   avg={avg(win_max_spreads):.0f}u  median={median(win_max_spreads):.0f}u")
    print(f"  LOSSES: avg={avg(loss_max_spreads):.0f}u  median={median(loss_max_spreads):.0f}u")

    # Also show hbfreed spawn spread
    hb_win_spreads = [m["hb_spawn_avg_dist"] for m in wins]
    hb_loss_spreads = [m["hb_spawn_avg_dist"] for m in losses]
    print(f"  HB spawn spread (when we win):  avg={avg(hb_win_spreads):.0f}u")
    print(f"  HB spawn spread (when we lose): avg={avg(hb_loss_spreads):.0f}u")

    # 2. Time to first kill
    print(f"\n--- 2. TIME TO FIRST KILL ---")
    our_fk_wins = [m["our_first_kill_tick"] for m in wins if m["our_first_kill_tick"] is not None]
    our_fk_losses = [m["our_first_kill_tick"] for m in losses if m["our_first_kill_tick"] is not None]
    hb_fk_wins = [m["hb_first_kill_tick"] for m in wins if m["hb_first_kill_tick"] is not None]
    hb_fk_losses = [m["hb_first_kill_tick"] for m in losses if m["hb_first_kill_tick"] is not None]
    print(f"  OUR first kill (when we WIN):  avg={avg(our_fk_wins):.0f}  median={median(our_fk_wins):.0f}  ({len(our_fk_wins)}/{len(wins)} matches)")
    print(f"  OUR first kill (when we LOSE): avg={avg(our_fk_losses):.0f}  median={median(our_fk_losses):.0f}  ({len(our_fk_losses)}/{len(losses)} matches)")
    print(f"  HB first kill (when we WIN):   avg={avg(hb_fk_wins):.0f}  median={median(hb_fk_wins):.0f}  ({len(hb_fk_wins)}/{len(wins)} matches)")
    print(f"  HB first kill (when we LOSE):  avg={avg(hb_fk_losses):.0f}  median={median(hb_fk_losses):.0f}  ({len(hb_fk_losses)}/{len(losses)} matches)")

    # First blood stats
    print(f"\n  FIRST BLOOD:")
    fb_us_wins = sum(1 for m in wins if m["first_blood_side"] == "us")
    fb_us_losses = sum(1 for m in losses if m["first_blood_side"] == "us")
    print(f"  We get first blood in WINS:   {fb_us_wins}/{len(wins)} ({100*fb_us_wins/len(wins):.0f}%)")
    print(f"  We get first blood in LOSSES: {fb_us_losses}/{len(losses)} ({100*fb_us_losses/len(losses):.0f}%)")

    # 3. Pack formation time
    print(f"\n--- 3. PACK FORMATION TIME (avg pairwise <= 300u) ---")
    our_pack_wins = [m["our_pack_tick"] for m in wins if m["our_pack_tick"] is not None]
    our_pack_losses = [m["our_pack_tick"] for m in losses if m["our_pack_tick"] is not None]
    hb_pack_wins = [m["hb_pack_tick"] for m in wins if m["hb_pack_tick"] is not None]
    hb_pack_losses = [m["hb_pack_tick"] for m in losses if m["hb_pack_tick"] is not None]
    print(f"  OUR pack time (WINS):   avg={avg(our_pack_wins):.0f}  median={median(our_pack_wins):.0f}  ({len(our_pack_wins)}/{len(wins)} formed)")
    print(f"  OUR pack time (LOSSES): avg={avg(our_pack_losses):.0f}  median={median(our_pack_losses):.0f}  ({len(our_pack_losses)}/{len(losses)} formed)")
    print(f"  HB pack time (we WIN):  avg={avg(hb_pack_wins):.0f}  median={median(hb_pack_wins):.0f}  ({len(hb_pack_wins)}/{len(wins)} formed)")
    print(f"  HB pack time (we LOSE): avg={avg(hb_pack_losses):.0f}  median={median(hb_pack_losses):.0f}  ({len(hb_pack_losses)}/{len(losses)} formed)")

    # 4. Ability usage
    print(f"\n--- 4. ABILITY USAGE ---")
    our_ab_wins = [m["our_abilities"] for m in wins]
    our_ab_losses = [m["our_abilities"] for m in losses]
    hb_ab_wins = [m["hb_abilities"] for m in wins]
    hb_ab_losses = [m["hb_abilities"] for m in losses]
    print(f"  OUR abilities (WINS):   avg={avg(our_ab_wins):.1f}  median={median(our_ab_wins):.0f}")
    print(f"  OUR abilities (LOSSES): avg={avg(our_ab_losses):.1f}  median={median(our_ab_losses):.0f}")
    print(f"  HB abilities (we WIN):  avg={avg(hb_ab_wins):.1f}  median={median(hb_ab_wins):.0f}")
    print(f"  HB abilities (we LOSE): avg={avg(hb_ab_losses):.1f}  median={median(hb_ab_losses):.0f}")

    # Ability ratio
    print(f"  OUR/HB ability ratio (WINS):   {avg(our_ab_wins)/avg(hb_ab_wins):.2f}x")
    print(f"  OUR/HB ability ratio (LOSSES): {avg(our_ab_losses)/avg(hb_ab_losses):.2f}x")

    # Melee attacks
    our_melee_wins = [m["our_melee_attacks"] for m in wins]
    our_melee_losses = [m["our_melee_attacks"] for m in losses]
    hb_melee_wins = [m["hb_melee_attacks"] for m in wins]
    hb_melee_losses = [m["hb_melee_attacks"] for m in losses]
    print(f"  OUR melee attacks (WINS):   avg={avg(our_melee_wins):.1f}")
    print(f"  OUR melee attacks (LOSSES): avg={avg(our_melee_losses):.1f}")
    print(f"  HB melee attacks (we WIN):  avg={avg(hb_melee_wins):.1f}")
    print(f"  HB melee attacks (we LOSE): avg={avg(hb_melee_losses):.1f}")

    # 5. First 30 ticks
    print(f"\n--- 5. FIRST 30 TICKS (bots alive) ---")
    our_a30_wins = [m["our_alive_at_30"] for m in wins]
    our_a30_losses = [m["our_alive_at_30"] for m in losses]
    hb_a30_wins = [m["hb_alive_at_30"] for m in wins]
    hb_a30_losses = [m["hb_alive_at_30"] for m in losses]
    print(f"  OUR alive@30 (WINS):   avg={avg(our_a30_wins):.1f}  distribution={sorted(our_a30_wins)}")
    print(f"  OUR alive@30 (LOSSES): avg={avg(our_a30_losses):.1f}  distribution={sorted(our_a30_losses)}")
    print(f"  HB alive@30 (we WIN):  avg={avg(hb_a30_wins):.1f}  distribution={sorted(hb_a30_wins)}")
    print(f"  HB alive@30 (we LOSE): avg={avg(hb_a30_losses):.1f}  distribution={sorted(hb_a30_losses)}")

    # At tick 50
    our_a50_wins = [m["our_alive_at_50"] for m in wins]
    our_a50_losses = [m["our_alive_at_50"] for m in losses]
    hb_a50_wins = [m["hb_alive_at_50"] for m in wins]
    hb_a50_losses = [m["hb_alive_at_50"] for m in losses]
    print(f"\n  TICK 50:")
    print(f"  OUR alive@50 (WINS):   avg={avg(our_a50_wins):.1f}  distribution={sorted(our_a50_wins)}")
    print(f"  OUR alive@50 (LOSSES): avg={avg(our_a50_losses):.1f}  distribution={sorted(our_a50_losses)}")
    print(f"  HB alive@50 (we WIN):  avg={avg(hb_a50_wins):.1f}  distribution={sorted(hb_a50_wins)}")
    print(f"  HB alive@50 (we LOSE): avg={avg(hb_a50_losses):.1f}  distribution={sorted(hb_a50_losses)}")

    # 6. Damage efficiency
    print(f"\n--- 6. DAMAGE EFFICIENCY ---")
    our_dmg_wins = [m["our_total_damage"] for m in wins]
    our_dmg_losses = [m["our_total_damage"] for m in losses]
    hb_dmg_wins = [m["hb_total_damage"] for m in wins]
    hb_dmg_losses = [m["hb_total_damage"] for m in losses]
    print(f"  OUR total damage (WINS):   avg={avg(our_dmg_wins):.0f}")
    print(f"  OUR total damage (LOSSES): avg={avg(our_dmg_losses):.0f}")
    print(f"  HB total damage (we WIN):  avg={avg(hb_dmg_wins):.0f}")
    print(f"  HB total damage (we LOSE): avg={avg(hb_dmg_losses):.0f}")

    our_eff_wins = [m["our_damage_per_action"] for m in wins]
    our_eff_losses = [m["our_damage_per_action"] for m in losses]
    hb_eff_wins = [m["hb_damage_per_action"] for m in wins]
    hb_eff_losses = [m["hb_damage_per_action"] for m in losses]
    print(f"  OUR dmg/action (WINS):   avg={avg(our_eff_wins):.2f}")
    print(f"  OUR dmg/action (LOSSES): avg={avg(our_eff_losses):.2f}")
    print(f"  HB dmg/action (we WIN):  avg={avg(hb_eff_wins):.2f}")
    print(f"  HB dmg/action (we LOSE): avg={avg(hb_eff_losses):.2f}")

    # HP at tick 30, 50, 80
    print(f"\n  HEALTH TOTALS:")
    for t in [30, 50, 80]:
        our_hp_w = [m[f"our_hp_at_{t}"] for m in wins if m[f"our_hp_at_{t}"] is not None]
        our_hp_l = [m[f"our_hp_at_{t}"] for m in losses if m[f"our_hp_at_{t}"] is not None]
        hb_hp_w = [m[f"hb_hp_at_{t}"] for m in wins if m[f"hb_hp_at_{t}"] is not None]
        hb_hp_l = [m[f"hb_hp_at_{t}"] for m in losses if m[f"hb_hp_at_{t}"] is not None]
        if our_hp_w and our_hp_l:
            print(f"  Tick {t}: WINS  us={avg(our_hp_w):.0f}hp vs hb={avg(hb_hp_w):.0f}hp (delta={avg(our_hp_w)-avg(hb_hp_w):+.0f})")
            print(f"         LOSSES us={avg(our_hp_l):.0f}hp vs hb={avg(hb_hp_l):.0f}hp (delta={avg(our_hp_l)-avg(hb_hp_l):+.0f})")

    # 7. Map correlation
    print(f"\n--- 7. MAP CORRELATION ---")
    map_wins = defaultdict(int)
    map_losses = defaultdict(int)
    for m in wins:
        map_wins[m["mapId"]] += 1
    for m in losses:
        map_losses[m["mapId"]] += 1

    all_maps = set(map_wins.keys()) | set(map_losses.keys())
    for map_id in sorted(all_maps):
        w = map_wins[map_id]
        l = map_losses[map_id]
        total = w + l
        wr = 100 * w / total if total > 0 else 0
        print(f"  {map_id:<20} {w}W-{l}L ({wr:.0f}% WR)")

    # === CORRELATION ANALYSIS ===
    print(f"\n{'=' * 80}")
    print("CORRELATION: SPAWN SPREAD vs OUTCOME")
    print(f"{'=' * 80}")

    # Combine all matches with outcome label
    all_matches = [(m, "WIN") for m in wins] + [(m, "LOSS") for m in losses]
    all_matches.sort(key=lambda x: x[0]["our_spawn_avg_dist"])

    print(f"  {'Spawn Spread':<15} {'Outcome':<8} {'Alive@30':<10} {'First Blood':<15} {'Map'}")
    print(f"  {'-'*15} {'-'*8} {'-'*10} {'-'*15} {'-'*20}")
    for m, outcome in all_matches:
        fb = f"{'us' if m['first_blood_side'] == 'us' else 'them'}@{m['first_blood_tick']}" if m[
            "first_blood_tick"
        ] else "N/A"
        print(
            f"  {m['our_spawn_avg_dist']:>10.0f}u    {outcome:<8} "
            f"{m['our_alive_at_30']}v{m['hb_alive_at_30']}      "
            f"{fb:<15} {m['mapId']}"
        )

    # === STRONGEST DIFFERENTIATORS ===
    print(f"\n{'=' * 80}")
    print("STRONGEST DIFFERENTIATORS (sorted by effect size)")
    print(f"{'=' * 80}")

    diffs = []

    # For each numeric metric, compute effect size (difference of means / pooled std)
    def effect_size(win_vals, loss_vals, name, higher_is_better=True):
        if not win_vals or not loss_vals:
            return None
        w_mean = avg(win_vals)
        l_mean = avg(loss_vals)
        diff = w_mean - l_mean
        if not higher_is_better:
            diff = -diff
        # Use simple ratio for interpretability
        return {
            "name": name,
            "win_mean": w_mean,
            "loss_mean": l_mean,
            "diff": w_mean - l_mean,
            "abs_diff": abs(w_mean - l_mean),
            "direction": "higher in wins" if w_mean > l_mean else "higher in losses",
        }

    metrics = [
        ([m["our_spawn_avg_dist"] for m in wins], [m["our_spawn_avg_dist"] for m in losses], "Our spawn spread", False),
        ([m["our_alive_at_30"] for m in wins], [m["our_alive_at_30"] for m in losses], "Our alive at tick 30", True),
        ([m["our_alive_at_50"] for m in wins], [m["our_alive_at_50"] for m in losses], "Our alive at tick 50", True),
        ([m["our_abilities"] for m in wins], [m["our_abilities"] for m in losses], "Our abilities fired", True),
        ([m["hb_abilities"] for m in wins], [m["hb_abilities"] for m in losses], "HB abilities fired (when we...)", False),
        ([m["our_total_damage"] for m in wins], [m["our_total_damage"] for m in losses], "Our total damage", True),
        ([m["hb_total_damage"] for m in wins], [m["hb_total_damage"] for m in losses], "HB total damage (when we...)", False),
        ([m["our_first_kill_tick"] for m in wins if m["our_first_kill_tick"]], [m["our_first_kill_tick"] for m in losses if m["our_first_kill_tick"]], "Our first kill tick", False),
        ([m["hb_first_kill_tick"] for m in wins if m["hb_first_kill_tick"]], [m["hb_first_kill_tick"] for m in losses if m["hb_first_kill_tick"]], "HB first kill tick", True),
        ([m["our_pack_tick"] for m in wins if m["our_pack_tick"]], [m["our_pack_tick"] for m in losses if m["our_pack_tick"]], "Our pack formation tick", False),
    ]

    for win_vals, loss_vals, name, higher_better in metrics:
        es = effect_size(win_vals, loss_vals, name, higher_better)
        if es:
            diffs.append(es)

    # Sort by absolute difference (normalized by mean to make comparable)
    for d in diffs:
        mean_scale = max(abs(d["win_mean"]), abs(d["loss_mean"]), 1)
        d["normalized_diff"] = d["abs_diff"] / mean_scale

    diffs.sort(key=lambda x: x["normalized_diff"], reverse=True)

    for d in diffs:
        print(f"  {d['name']:<35} WINS={d['win_mean']:.1f}  LOSSES={d['loss_mean']:.1f}  diff={d['diff']:+.1f} ({d['direction']})")

    # === FINAL SUMMARY ===
    print(f"\n{'=' * 80}")
    print("KEY FINDINGS SUMMARY")
    print(f"{'=' * 80}")

    # Compute some key differentiators
    win_hp_advantage_at_30 = avg([m["our_hp_at_30"] - m["hb_hp_at_30"] for m in wins if m["our_hp_at_30"] is not None])
    loss_hp_advantage_at_30 = avg([m["our_hp_at_30"] - m["hb_hp_at_30"] for m in losses if m["our_hp_at_30"] is not None])

    print(f"\n  HP advantage at tick 30:")
    print(f"    WINS:   {win_hp_advantage_at_30:+.0f} HP")
    print(f"    LOSSES: {loss_hp_advantage_at_30:+.0f} HP")

    # First blood correlation
    print(f"\n  First blood correlation:")
    print(f"    We get first blood: {fb_us_wins}/{len(wins)} wins ({100*fb_us_wins/len(wins):.0f}%) vs {fb_us_losses}/{len(losses)} losses ({100*fb_us_losses/len(losses):.0f}%)")

    # Duration
    win_durations = [m["duration"] for m in wins]
    loss_durations = [m["duration"] for m in losses]
    print(f"\n  Match duration:")
    print(f"    WINS:   avg={avg(win_durations):.0f} ticks")
    print(f"    LOSSES: avg={avg(loss_durations):.0f} ticks")


if __name__ == "__main__":
    main()
