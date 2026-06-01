#!/usr/bin/env python3
"""Analyze oztenbot loss replays for competitive patterns."""

import json
import math
import sys
from collections import defaultdict

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

REPLAYS = [
    ("scouting/oztenbot-v16/L-vs-oztenbot-f0ef73c7.json", "razor-thin: 3K/440d vs 4K/440d"),
    ("scouting/oztenbot-v16/L-vs-oztenbot-b20a3093.json", "stomp: 1K/335d vs 4K/500d"),
    ("scouting/oztenbot-v16/L-vs-oztenbot-78e5b382.json", "loss: 1K/365d vs 4K/440d"),
]

SAMPLE_TICKS = [0, 30, 60, 100, 150, 200, 300]

# Known terrain trap zones on sunken_reef
TERRAIN_TRAPS = [
    {"name": "reef_north_1", "x_min": 700, "x_max": 800, "y_max": 640},
    {"name": "reef_north_2", "x_min": 1050, "x_max": 1100, "y_max": 640},
]

def dist(p1, p2):
    return math.sqrt((p1["x"] - p2["x"])**2 + (p1["y"] - p2["y"])**2)

def in_zone(pos, zone):
    cx = zone.get("centerX", zone.get("center", {}).get("x", 1024))
    cy = zone.get("centerY", zone.get("center", {}).get("y", 1024))
    d = math.sqrt((pos["x"] - cx)**2 + (pos["y"] - cy)**2)
    return d <= zone["radius"]

def avg_pos(positions):
    if not positions:
        return {"x": 0, "y": 0}
    return {
        "x": sum(p["x"] for p in positions) / len(positions),
        "y": sum(p["y"] for p in positions) / len(positions),
    }

def pairwise_distances(positions):
    dists = []
    for i in range(len(positions)):
        for j in range(i+1, len(positions)):
            dists.append(dist(positions[i], positions[j]))
    return dists

def near_terrain_trap(pos):
    for trap in TERRAIN_TRAPS:
        if trap["x_min"] <= pos["x"] <= trap["x_max"] and pos["y"] <= trap["y_max"]:
            return trap["name"]
    return None

def analyze_replay(filepath, label):
    with open(filepath) as f:
        data = json.load(f)

    match_id = data["matchId"]
    map_id = data.get("mapId", "unknown")
    duration = data["duration"]
    winner = data["winner"]

    # Classify bots
    our_bots = []
    enemy_bots = []
    for b in data["bots"]:
        if b["agentId"] == OUR_AGENT:
            our_bots.append(b["id"])
        else:
            enemy_bots.append(b["id"])

    # Determine winner team
    winner_is_us = any(winner.startswith(bid.split(":")[0]) for bid in our_bots)
    winner_agent = "SEMalytics" if winner_is_us else "oztenbot"

    print(f"\n{'='*80}")
    print(f"REPLAY: {filepath.split('/')[-1]} ({label})")
    print(f"{'='*80}")
    print(f"  Map: {map_id}")
    print(f"  Duration: {duration} ticks ({duration/10:.1f}s)")
    print(f"  Winner: {winner_agent} (bot {winner})")

    # === 2. Spawn spread ===
    frame0 = data["frames"][0]
    bot_map_0 = {b["id"]: b for b in frame0["bots"]}

    our_spawn_pos = [bot_map_0[bid]["position"] for bid in our_bots]
    enemy_spawn_pos = [bot_map_0[bid]["position"] for bid in enemy_bots]

    our_spawn_dists = pairwise_distances(our_spawn_pos)
    enemy_spawn_dists = pairwise_distances(enemy_spawn_pos)

    print(f"\n  --- Spawn Spread ---")
    print(f"  SEMalytics: avg={sum(our_spawn_dists)/len(our_spawn_dists):.0f}u, max={max(our_spawn_dists):.0f}u")
    for i, bid in enumerate(our_bots):
        p = bot_map_0[bid]["position"]
        trap = near_terrain_trap(p)
        trap_str = f" ** NEAR TRAP: {trap} **" if trap else ""
        print(f"    Bot {i}: ({p['x']:.0f}, {p['y']:.0f}){trap_str}")

    print(f"  oztenbot:   avg={sum(enemy_spawn_dists)/len(enemy_spawn_dists):.0f}u, max={max(enemy_spawn_dists):.0f}u")
    for i, bid in enumerate(enemy_bots):
        p = bot_map_0[bid]["position"]
        print(f"    Bot {i}: ({p['x']:.0f}, {p['y']:.0f})")

    # === 3. Death timeline ===
    print(f"\n  --- Death Timeline ---")
    deaths = []
    ability_counts = defaultdict(int)  # bot_id -> count
    attack_counts = defaultdict(int)

    # Track positions for stuck detection
    bot_positions = defaultdict(list)  # bot_id -> [(tick, x, y)]

    for frame in data["frames"]:
        tick = frame["tick"]
        bot_map = {b["id"]: b for b in frame["bots"]}

        # Track positions
        for bid in our_bots + enemy_bots:
            b = bot_map[bid]
            if b["alive"]:
                bot_positions[bid].append((tick, b["position"]["x"], b["position"]["y"]))

        # Count events
        for event in frame.get("events", []):
            if event["type"] == "ability":
                ability_counts[event.get("casterId", event.get("botId", "?"))] += 1
            elif event["type"] == "attack":
                attack_counts[event.get("attackerId", event.get("botId", "?"))] += 1
            elif event["type"] == "death" or event["type"] == "bot_death":
                bot_id = event.get("botId", event.get("targetId", "?"))
                killer = event.get("killerId", event.get("attackerId", "?"))
                team = "SEMalytics" if bot_id in our_bots else "oztenbot"
                deaths.append((tick, bot_id, team, killer))

    # If no death events found, detect from health transitions
    if not deaths:
        prev_alive = {bid: True for bid in our_bots + enemy_bots}
        for frame in data["frames"]:
            tick = frame["tick"]
            bot_map = {b["id"]: b for b in frame["bots"]}
            for bid in our_bots + enemy_bots:
                b = bot_map[bid]
                if prev_alive[bid] and not b["alive"]:
                    team = "SEMalytics" if bid in our_bots else "oztenbot"
                    deaths.append((tick, bid, team, "unknown"))
                prev_alive[bid] = b["alive"]

    deaths.sort(key=lambda x: x[0])
    for tick, bid, team, killer in deaths:
        idx = our_bots.index(bid) if bid in our_bots else enemy_bots.index(bid)
        killer_team = ""
        if killer != "unknown" and killer != "?":
            killer_team = " (by SEMalytics)" if killer in our_bots else " (by oztenbot)"
            if killer == "zone":
                killer_team = " (by ZONE)"
        print(f"    Tick {tick:4d} ({tick/10:5.1f}s): {team} #{idx+1} dies{killer_team}")

    # === 4. Ability counts ===
    print(f"\n  --- Ability & Attack Counts ---")
    our_abilities = sum(ability_counts[bid] for bid in our_bots)
    enemy_abilities = sum(ability_counts[bid] for bid in enemy_bots)
    our_attacks = sum(attack_counts[bid] for bid in our_bots)
    enemy_attacks = sum(attack_counts[bid] for bid in enemy_bots)
    print(f"  SEMalytics: {our_abilities} abilities, {our_attacks} melee attacks")
    print(f"  oztenbot:   {enemy_abilities} abilities, {enemy_attacks} melee attacks")

    # If no events tracked abilities, try counting from frame data differently
    if our_abilities == 0 and enemy_abilities == 0:
        # Check event types more carefully
        event_types = set()
        for frame in data["frames"]:
            for event in frame.get("events", []):
                event_types.add(event["type"])
        print(f"  (Event types found: {event_types})")

    # === 5. Final positions ===
    print(f"\n  --- Final State (Tick {duration}) ---")
    last_frame = data["frames"][-1]
    last_zone = last_frame["zone"]
    bot_map_last = {b["id"]: b for b in last_frame["bots"]}

    print(f"  Zone: center=({last_zone.get('centerX', 1024):.0f}, {last_zone.get('centerY', 1024):.0f}), radius={last_zone['radius']:.0f}")

    for label_team, bot_list in [("SEMalytics", our_bots), ("oztenbot", enemy_bots)]:
        alive_count = sum(1 for bid in bot_list if bot_map_last[bid]["alive"])
        total_hp = sum(bot_map_last[bid]["health"] for bid in bot_list if bot_map_last[bid]["alive"])
        print(f"  {label_team}: {alive_count} alive, {total_hp:.0f} total HP")
        for i, bid in enumerate(bot_list):
            b = bot_map_last[bid]
            p = b["position"]
            iz = in_zone(p, last_zone)
            status = f"HP={b['health']:.0f}" if b["alive"] else "DEAD"
            zone_str = "IN-ZONE" if iz else "OUT-ZONE"
            trap = near_terrain_trap(p)
            trap_str = f" ** TRAP: {trap} **" if trap else ""
            print(f"    Bot {i}: ({p['x']:.0f}, {p['y']:.0f}) {status} {zone_str}{trap_str}")

    # === 6. Stuck detection (same pos for 20+ ticks) ===
    print(f"\n  --- Stuck Detection (20+ ticks same position) ---")
    stuck_found = False
    for bid in our_bots:
        positions = bot_positions[bid]
        if len(positions) < 20:
            continue
        streak = 1
        streak_start = positions[0][0]
        for k in range(1, len(positions)):
            dx = abs(positions[k][1] - positions[k-1][1])
            dy = abs(positions[k][2] - positions[k-1][2])
            if dx < 1.0 and dy < 1.0:
                streak += 1
                if streak >= 20:
                    idx = our_bots.index(bid)
                    print(f"    ** SEMalytics #{idx+1} STUCK at ({positions[k][1]:.0f}, {positions[k][2]:.0f}) for {streak} ticks starting tick {streak_start} **")
                    stuck_found = True
            else:
                streak = 1
                streak_start = positions[k][0]
    if not stuck_found:
        print("    No stuck bots detected (< 1u movement threshold)")

    # Also check enemy for completeness
    for bid in enemy_bots:
        positions = bot_positions[bid]
        if len(positions) < 20:
            continue
        streak = 1
        streak_start = positions[0][0]
        for k in range(1, len(positions)):
            dx = abs(positions[k][1] - positions[k-1][1])
            dy = abs(positions[k][2] - positions[k-1][2])
            if dx < 1.0 and dy < 1.0:
                streak += 1
                if streak >= 20:
                    idx = enemy_bots.index(bid)
                    print(f"    ** oztenbot #{idx+1} STUCK at ({positions[k][1]:.0f}, {positions[k][2]:.0f}) for {streak} ticks starting tick {streak_start} **")
            else:
                streak = 1
                streak_start = positions[k][0]

    # === 7. Terrain trap proximity ===
    print(f"\n  --- Terrain Trap Proximity (any bot passing through trap zones) ---")
    trap_visits = defaultdict(list)  # bid -> [(tick, trap_name)]
    for bid in our_bots:
        for tick, x, y in bot_positions[bid]:
            trap = near_terrain_trap({"x": x, "y": y})
            if trap:
                trap_visits[bid].append((tick, trap))

    if trap_visits:
        for bid, visits in trap_visits.items():
            idx = our_bots.index(bid)
            first_tick = visits[0][0]
            last_tick = visits[-1][0]
            print(f"    SEMalytics #{idx+1}: in trap zone '{visits[0][1]}' from tick {first_tick}-{last_tick} ({len(visits)} ticks)")
    else:
        print("    No bots visited known terrain trap zones")

    # === 8. oztenbot behavior sampling ===
    print(f"\n  --- oztenbot Behavior (position samples) ---")
    frame_idx = {frame["tick"]: frame for frame in data["frames"]}

    for sample_tick in SAMPLE_TICKS:
        if sample_tick >= duration:
            print(f"    Tick {sample_tick}: match already over")
            continue
        frame = frame_idx.get(sample_tick)
        if not frame:
            # Find closest
            closest = min(data["frames"], key=lambda f: abs(f["tick"] - sample_tick))
            frame = closest
            sample_tick = closest["tick"]

        bot_map = {b["id"]: b for b in frame["bots"]}
        alive_enemy = [bid for bid in enemy_bots if bot_map[bid]["alive"]]
        alive_us = [bid for bid in our_bots if bot_map[bid]["alive"]]

        if not alive_enemy:
            print(f"    Tick {sample_tick}: all oztenbot dead")
            continue

        enemy_positions = [bot_map[bid]["position"] for bid in alive_enemy]
        enemy_avg = avg_pos(enemy_positions)
        enemy_pairwise = pairwise_distances(enemy_positions) if len(enemy_positions) > 1 else [0]

        our_positions = [bot_map[bid]["position"] for bid in alive_us] if alive_us else []
        our_avg = avg_pos(our_positions) if our_positions else {"x": 0, "y": 0}

        # Distance between team centroids
        centroid_dist = dist(enemy_avg, our_avg) if our_positions else 0

        zone = frame["zone"]
        zone_center = {"x": zone.get("centerX", 1024), "y": zone.get("centerY", 1024)}
        enemy_zone_dist = dist(enemy_avg, zone_center)
        our_zone_dist = dist(our_avg, zone_center) if our_positions else 0

        print(f"    Tick {sample_tick:4d}: oz={len(alive_enemy)} alive, avg spread={sum(enemy_pairwise)/len(enemy_pairwise):.0f}u, "
              f"centroid=({enemy_avg['x']:.0f},{enemy_avg['y']:.0f}), "
              f"dist_to_zone={enemy_zone_dist:.0f}u, "
              f"dist_to_us={centroid_dist:.0f}u")

        # Show individual positions at key ticks
        if sample_tick in [0, 100, 200]:
            for i, bid in enumerate(enemy_bots):
                b = bot_map[bid]
                if b["alive"]:
                    p = b["position"]
                    # Find nearest ally
                    nearest_ally = min(
                        [dist(p, bot_map[ob]["position"]) for ob in alive_enemy if ob != bid],
                        default=0
                    )
                    # Find nearest enemy (us)
                    nearest_enemy = min(
                        [dist(p, bot_map[ob]["position"]) for ob in alive_us],
                        default=0
                    ) if alive_us else 0
                    print(f"             oz#{i+1}: ({p['x']:.0f},{p['y']:.0f}) HP={b['health']:.0f} nearest_ally={nearest_ally:.0f}u nearest_enemy={nearest_enemy:.0f}u")

    # === Behavioral summary ===
    print(f"\n  --- oztenbot Behavioral Pattern ---")

    # Check convergence: compare spread at tick 0 vs tick 60
    if 60 < duration:
        f0 = frame_idx.get(0, data["frames"][0])
        f60 = frame_idx.get(60, min(data["frames"], key=lambda f: abs(f["tick"] - 60)))

        bm0 = {b["id"]: b for b in f0["bots"]}
        bm60 = {b["id"]: b for b in f60["bots"]}

        alive_e0 = [bid for bid in enemy_bots if bm0[bid]["alive"]]
        alive_e60 = [bid for bid in enemy_bots if bm60[bid]["alive"]]

        spread0 = sum(pairwise_distances([bm0[bid]["position"] for bid in alive_e0])) / max(len(pairwise_distances([bm0[bid]["position"] for bid in alive_e0])), 1)
        spread60 = sum(pairwise_distances([bm60[bid]["position"] for bid in alive_e60])) / max(len(pairwise_distances([bm60[bid]["position"] for bid in alive_e60])), 1) if len(alive_e60) > 1 else 0

        convergence_pct = (spread0 - spread60) / spread0 * 100 if spread0 > 0 else 0

        if convergence_pct > 30:
            print(f"    CONVERGING: spread dropped {convergence_pct:.0f}% (from {spread0:.0f}u to {spread60:.0f}u by tick 60)")
        elif convergence_pct > 10:
            print(f"    MODERATE CONVERGE: spread dropped {convergence_pct:.0f}% (from {spread0:.0f}u to {spread60:.0f}u by tick 60)")
        elif convergence_pct < -10:
            print(f"    SPREADING: spread increased {-convergence_pct:.0f}% (from {spread0:.0f}u to {spread60:.0f}u by tick 60)")
        else:
            print(f"    STABLE FORMATION: spread changed {convergence_pct:.0f}% (from {spread0:.0f}u to {spread60:.0f}u by tick 60)")

    # Check zone camping: is enemy centroid near zone center in mid-late game?
    mid_tick = min(150, duration - 1)
    if mid_tick > 0:
        f_mid = frame_idx.get(mid_tick, min(data["frames"], key=lambda f: abs(f["tick"] - mid_tick)))
        bm_mid = {b["id"]: b for b in f_mid["bots"]}
        alive_e_mid = [bid for bid in enemy_bots if bm_mid[bid]["alive"]]
        if alive_e_mid:
            mid_positions = [bm_mid[bid]["position"] for bid in alive_e_mid]
            mid_avg = avg_pos(mid_positions)
            zone_mid = f_mid["zone"]
            zone_center_mid = {"x": zone_mid.get("centerX", 1024), "y": zone_mid.get("centerY", 1024)}
            mid_zone_dist = dist(mid_avg, zone_center_mid)
            zone_radius = zone_mid["radius"]
            if mid_zone_dist < zone_radius * 0.3:
                print(f"    ZONE CAMPING: centroid is {mid_zone_dist:.0f}u from zone center (radius {zone_radius:.0f}u) at tick {mid_tick}")
            elif mid_zone_dist < zone_radius * 0.6:
                print(f"    ZONE AWARE: centroid is {mid_zone_dist:.0f}u from zone center (radius {zone_radius:.0f}u) at tick {mid_tick}")
            else:
                print(f"    NOT ZONE FOCUSED: centroid is {mid_zone_dist:.0f}u from zone center (radius {zone_radius:.0f}u) at tick {mid_tick}")

    # Check aggression: how quickly do they close to attack range?
    first_contact_tick = None
    for frame in data["frames"]:
        bot_map = {b["id"]: b for b in frame["bots"]}
        for ebid in enemy_bots:
            if not bot_map[ebid]["alive"]:
                continue
            for obid in our_bots:
                if not bot_map[obid]["alive"]:
                    continue
                d = dist(bot_map[ebid]["position"], bot_map[obid]["position"])
                if d < 200:
                    first_contact_tick = frame["tick"]
                    break
            if first_contact_tick:
                break
        if first_contact_tick:
            break

    if first_contact_tick:
        print(f"    FIRST CONTACT: tick {first_contact_tick} ({first_contact_tick/10:.1f}s)")

    # Track HP over time for damage curve
    print(f"\n  --- HP Timeline (team total) ---")
    hp_samples = [0, 50, 100, 150, 200, 250, 300]
    for t in hp_samples:
        if t >= duration:
            break
        frame = frame_idx.get(t, min(data["frames"], key=lambda f: abs(f["tick"] - t)))
        bm = {b["id"]: b for b in frame["bots"]}
        our_hp = sum(bm[bid]["health"] for bid in our_bots if bm[bid]["alive"])
        our_alive = sum(1 for bid in our_bots if bm[bid]["alive"])
        enemy_hp = sum(bm[bid]["health"] for bid in enemy_bots if bm[bid]["alive"])
        enemy_alive = sum(1 for bid in enemy_bots if bm[bid]["alive"])
        diff = our_hp - enemy_hp
        print(f"    Tick {t:4d}: SEMalytics {our_alive}x {our_hp:3.0f}HP | oztenbot {enemy_alive}x {enemy_hp:3.0f}HP | diff={diff:+.0f}")

    return {
        "match_id": match_id,
        "map": map_id,
        "duration": duration,
        "winner": winner_agent,
        "our_spawn_spread": {"avg": sum(our_spawn_dists)/len(our_spawn_dists), "max": max(our_spawn_dists)},
        "enemy_spawn_spread": {"avg": sum(enemy_spawn_dists)/len(enemy_spawn_dists), "max": max(enemy_spawn_dists)},
        "deaths": deaths,
        "our_abilities": our_abilities,
        "enemy_abilities": enemy_abilities,
        "our_attacks": our_attacks,
        "enemy_attacks": enemy_attacks,
    }


# Run all replays
results = []
for filepath, label in REPLAYS:
    try:
        result = analyze_replay(filepath, label)
        results.append(result)
    except Exception as e:
        print(f"\nERROR analyzing {filepath}: {e}")
        import traceback
        traceback.print_exc()

# === Cross-replay summary ===
print(f"\n{'='*80}")
print(f"CROSS-REPLAY SUMMARY")
print(f"{'='*80}")

print(f"\n  --- Spawn Spread Comparison ---")
for r in results:
    print(f"  {r['match_id'][-8:]}: SEMalytics avg={r['our_spawn_spread']['avg']:.0f}u max={r['our_spawn_spread']['max']:.0f}u | "
          f"oztenbot avg={r['enemy_spawn_spread']['avg']:.0f}u max={r['enemy_spawn_spread']['max']:.0f}u")

print(f"\n  --- Ability/Attack Comparison ---")
for r in results:
    print(f"  {r['match_id'][-8:]}: SEMalytics {r['our_abilities']}abil/{r['our_attacks']}atk | "
          f"oztenbot {r['enemy_abilities']}abil/{r['enemy_attacks']}atk")

print(f"\n  --- Death Order Patterns ---")
for r in results:
    our_deaths = [(t, bid) for t, bid, team, k in r['deaths'] if team == "SEMalytics"]
    enemy_deaths = [(t, bid) for t, bid, team, k in r['deaths'] if team == "oztenbot"]
    first_death_team = r['deaths'][0][2] if r['deaths'] else "none"
    first_death_tick = r['deaths'][0][0] if r['deaths'] else 0
    print(f"  {r['match_id'][-8:]}: first death={first_death_team} at tick {first_death_tick}, "
          f"our deaths={len(our_deaths)}, their deaths={len(enemy_deaths)}")
