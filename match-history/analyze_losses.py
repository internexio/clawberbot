#!/usr/bin/env python3
"""
Comprehensive Clawber.ai Battle Replay Analyzer
Analyzes 3 loss replays for SEMalytics to understand why we lost.
"""

import json
import math
from collections import defaultdict, Counter
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional

# ── Configuration ─────────────────────────────────────────────────────────────

OUR_AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

REPLAY_FILES = [
    "/Users/davidpedersen/Scripts/clawberbot/match-history/match_1772146080196_8z0qrx.json",
    "/Users/davidpedersen/Scripts/clawberbot/match-history/match_1772146457890_y2imsz.json",
    "/Users/davidpedersen/Scripts/clawberbot/match-history/match_1772146579245_qka0og.json",
]

ATTACK_RANGE = 200
ABILITY_CAST_RANGE = 500
ABILITY_BLAST_RADIUS = 150
ARENA_SIZE = 2048
BOT_SPEED = 12
ZONE_INITIAL_RADIUS = 1126.4
ZONE_FINAL_RADIUS = 300
ZONE_SHRINK_TICKS = 800  # 80 seconds * 10 ticks/sec
ZONE_DAMAGE = 3

# ── Utilities ─────────────────────────────────────────────────────────────────

def dist(p1, p2):
    return math.sqrt((p1["x"] - p2["x"])**2 + (p1["y"] - p2["y"])**2)


def avg(values):
    return sum(values) / len(values) if values else 0


def median(values):
    if not values:
        return 0
    s = sorted(values)
    n = len(s)
    if n % 2 == 0:
        return (s[n//2 - 1] + s[n//2]) / 2
    return s[n//2]


def centroid(positions):
    if not positions:
        return {"x": 0, "y": 0}
    return {
        "x": avg([p["x"] for p in positions]),
        "y": avg([p["y"] for p in positions]),
    }


def avg_team_spread(positions):
    """Average pairwise distance between team members."""
    if len(positions) < 2:
        return 0
    dists = []
    for i in range(len(positions)):
        for j in range(i + 1, len(positions)):
            dists.append(dist(positions[i], positions[j]))
    return avg(dists)


def zone_radius_at_tick(tick):
    """Approximate zone radius at a given tick."""
    if tick >= ZONE_SHRINK_TICKS:
        return ZONE_FINAL_RADIUS
    progress = tick / ZONE_SHRINK_TICKS
    return ZONE_INITIAL_RADIUS - (ZONE_INITIAL_RADIUS - ZONE_FINAL_RADIUS) * progress


def is_outside_zone(pos, zone_center, zone_radius):
    """Check if a position is outside the zone."""
    d = math.sqrt((pos["x"] - zone_center["x"])**2 + (pos["y"] - zone_center["y"])**2)
    return d > zone_radius


# ── Analysis Functions ────────────────────────────────────────────────────────

def load_match(filepath):
    with open(filepath) as f:
        data = json.load(f)

    our_bot_ids = set()
    enemy_bot_ids = set()
    our_names = {}
    enemy_names = {}
    enemy_agent_name = ""

    for b in data["bots"]:
        if b["agentId"] == OUR_AGENT_ID:
            our_bot_ids.add(b["id"])
            our_names[b["id"]] = b["name"]
        else:
            enemy_bot_ids.add(b["id"])
            enemy_names[b["id"]] = b["name"]
            enemy_agent_name = b["name"].rsplit(" #", 1)[0]

    return {
        "data": data,
        "our_ids": our_bot_ids,
        "enemy_ids": enemy_bot_ids,
        "our_names": our_names,
        "enemy_names": enemy_names,
        "enemy_agent": enemy_agent_name,
        "match_id": data["matchId"],
        "duration": data["duration"],
        "winner_id": data["winner"],
    }


def analyze_death_timeline(match):
    """Track when each bot dies and who gets the kills."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    deaths = []

    for frame in data["frames"]:
        tick = frame["tick"]
        for ev in frame.get("events", []):
            if ev["type"] == "kill":
                victim = ev["victimId"]
                killer = ev.get("killerId")
                team = "OURS" if victim in our_ids else "ENEMY"
                if killer:
                    killer_label = f"{'Us' if killer in our_ids else 'Them'} #{killer.split(':')[1]}"
                else:
                    killer_label = "ZONE"
                deaths.append({
                    "tick": tick,
                    "time_sec": tick / 10.0,
                    "victim": victim,
                    "killer": killer,
                    "team": team,
                    "victim_label": f"{'Us' if team == 'OURS' else 'Them'} #{victim.split(':')[1]}",
                    "killer_label": killer_label,
                })

    our_deaths = [d for d in deaths if d["team"] == "OURS"]
    enemy_deaths = [d for d in deaths if d["team"] == "ENEMY"]

    return {
        "all_deaths": deaths,
        "our_deaths": our_deaths,
        "enemy_deaths": enemy_deaths,
        "our_first_death_tick": our_deaths[0]["tick"] if our_deaths else None,
        "enemy_first_death_tick": enemy_deaths[0]["tick"] if enemy_deaths else None,
        "our_kills": len(enemy_deaths),
        "enemy_kills": len(our_deaths),
    }


def analyze_damage_pacing(match):
    """Track damage events over time - when fights start, burst windows."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    damage_to_us = []  # (tick, target, attacker, amount, type)
    damage_to_them = []

    for frame in data["frames"]:
        tick = frame["tick"]
        for ev in frame.get("events", []):
            if ev["type"] == "damage":
                target = ev["targetId"]
                attacker = ev["attackerId"]
                dmg = ev["damage"]
                dmg_type = "zone" if dmg == ZONE_DAMAGE else ("ability" if dmg == 15 else "melee")

                entry = (tick, target, attacker, dmg, dmg_type)
                if target in our_ids:
                    damage_to_us.append(entry)
                elif target in enemy_ids:
                    damage_to_them.append(entry)

    # Find first combat tick (non-zone damage)
    combat_to_us = [d for d in damage_to_us if d[4] != "zone"]
    combat_to_them = [d for d in damage_to_them if d[4] != "zone"]

    first_combat_tick = None
    all_combat = sorted(combat_to_us + combat_to_them, key=lambda x: x[0])
    if all_combat:
        first_combat_tick = all_combat[0][0]

    # Damage per 10-tick window (1 second)
    def bucket_damage(events, window=10):
        buckets = defaultdict(int)
        for tick, _, _, dmg, dtype in events:
            if dtype != "zone":
                buckets[tick // window] += dmg
        return buckets

    us_buckets = bucket_damage(damage_to_us)
    them_buckets = bucket_damage(damage_to_them)

    # Find burst windows (top 5 damage seconds against us)
    top_burst_against_us = sorted(us_buckets.items(), key=lambda x: -x[1])[:5]

    # Damage by type
    dmg_types_to_us = Counter()
    dmg_types_to_them = Counter()
    for _, _, _, dmg, dtype in damage_to_us:
        dmg_types_to_us[dtype] += dmg
    for _, _, _, dmg, dtype in damage_to_them:
        dmg_types_to_them[dtype] += dmg

    total_dmg_to_us = sum(d[3] for d in damage_to_us)
    total_dmg_to_them = sum(d[3] for d in damage_to_them)

    return {
        "total_dmg_to_us": total_dmg_to_us,
        "total_dmg_to_them": total_dmg_to_them,
        "first_combat_tick": first_combat_tick,
        "dmg_types_to_us": dict(dmg_types_to_us),
        "dmg_types_to_them": dict(dmg_types_to_them),
        "top_burst_against_us": [(window * 10, dmg) for window, dmg in top_burst_against_us],
        "combat_dmg_to_us": combat_to_us,
        "combat_dmg_to_them": combat_to_them,
    }


def analyze_clustering(match, key_ticks=None):
    """Analyze team clustering at key moments."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    results = {}

    for frame in data["frames"]:
        tick = frame["tick"]
        if key_ticks is not None and tick not in key_ticks:
            continue

        our_alive_pos = []
        enemy_alive_pos = []

        for b in frame["bots"]:
            if not b["alive"]:
                continue
            if b["id"] in our_ids:
                our_alive_pos.append(b["position"])
            elif b["id"] in enemy_ids:
                enemy_alive_pos.append(b["position"])

        results[tick] = {
            "our_spread": avg_team_spread(our_alive_pos),
            "enemy_spread": avg_team_spread(enemy_alive_pos),
            "our_alive": len(our_alive_pos),
            "enemy_alive": len(enemy_alive_pos),
            "our_centroid": centroid(our_alive_pos),
            "enemy_centroid": centroid(enemy_alive_pos),
            "inter_team_dist": dist(centroid(our_alive_pos), centroid(enemy_alive_pos)) if our_alive_pos and enemy_alive_pos else None,
        }

    return results


def analyze_clustering_over_time(match):
    """Track clustering every 20 ticks for full picture."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    records = []

    for frame in data["frames"]:
        tick = frame["tick"]
        if tick % 20 != 0:
            continue

        our_alive_pos = []
        enemy_alive_pos = []

        for b in frame["bots"]:
            if not b["alive"]:
                continue
            if b["id"] in our_ids:
                our_alive_pos.append(b["position"])
            elif b["id"] in enemy_ids:
                enemy_alive_pos.append(b["position"])

        records.append({
            "tick": tick,
            "our_spread": avg_team_spread(our_alive_pos),
            "enemy_spread": avg_team_spread(enemy_alive_pos),
            "our_alive": len(our_alive_pos),
            "enemy_alive": len(enemy_alive_pos),
        })

    return records


def analyze_kiting(match):
    """Detect kiting: enemies staying near max attack range (180-220) instead of closing."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    # For each damage event, find distance between attacker and target
    engagement_distances = []  # (tick, attacker, target, distance, dmg_type)

    # Build position index by tick
    tick_positions = {}
    for frame in data["frames"]:
        tick = frame["tick"]
        pos_map = {}
        for b in frame["bots"]:
            pos_map[b["id"]] = b["position"]
        tick_positions[tick] = pos_map

    for frame in data["frames"]:
        tick = frame["tick"]
        for ev in frame.get("events", []):
            if ev["type"] == "damage" and ev["damage"] != ZONE_DAMAGE:
                attacker = ev["attackerId"]
                target = ev["targetId"]
                dmg = ev["damage"]

                if tick in tick_positions and attacker in tick_positions[tick] and target in tick_positions[tick]:
                    d = dist(tick_positions[tick][attacker], tick_positions[tick][target])
                    dmg_type = "ability" if dmg == 15 else "melee"
                    engagement_distances.append((tick, attacker, target, d, dmg_type))

    # Separate: enemy attacking us vs us attacking them
    enemy_melee_dists = [d for _, atk, tgt, d, t in engagement_distances
                         if atk in enemy_ids and tgt in our_ids and t == "melee"]
    our_melee_dists = [d for _, atk, tgt, d, t in engagement_distances
                       if atk in our_ids and tgt in enemy_ids and t == "melee"]
    enemy_ability_dists = [d for _, atk, tgt, d, t in engagement_distances
                           if atk in enemy_ids and tgt in our_ids and t == "ability"]
    our_ability_dists = [d for _, atk, tgt, d, t in engagement_distances
                         if atk in our_ids and tgt in enemy_ids and t == "ability"]

    # Track distance between nearest enemy and our bots during combat ticks
    # (for kiting: they hover near max range)
    nearest_enemy_dists_during_combat = []

    for frame in data["frames"]:
        tick = frame["tick"]
        our_pos = {}
        enemy_pos = {}

        for b in frame["bots"]:
            if not b["alive"]:
                continue
            if b["id"] in our_ids:
                our_pos[b["id"]] = b["position"]
            elif b["id"] in enemy_ids:
                enemy_pos[b["id"]] = b["position"]

        if not our_pos or not enemy_pos:
            continue

        # For each of our bots, find nearest enemy
        for our_id, our_p in our_pos.items():
            min_d = min(dist(our_p, ep) for ep in enemy_pos.values())
            nearest_enemy_dists_during_combat.append((tick, our_id, min_d))

    # Only during active combat (after first damage, before last death)
    first_dmg_tick = min((e[0] for e in engagement_distances), default=0)
    combat_dists = [(t, bid, d) for t, bid, d in nearest_enemy_dists_during_combat
                    if t >= first_dmg_tick and d < 500]

    # Distribution of nearest enemy distances during combat
    if combat_dists:
        just_dists = [d for _, _, d in combat_dists]
        dist_ranges = {
            "0-100 (very close)": len([d for d in just_dists if d < 100]),
            "100-150 (close)": len([d for d in just_dists if 100 <= d < 150]),
            "150-200 (attack range edge)": len([d for d in just_dists if 150 <= d < 200]),
            "200-250 (just outside range)": len([d for d in just_dists if 200 <= d < 250]),
            "250-350 (kiting zone)": len([d for d in just_dists if 250 <= d < 350]),
            "350-500 (approaching)": len([d for d in just_dists if 350 <= d < 500]),
        }
    else:
        dist_ranges = {}

    return {
        "enemy_melee_dists": {"avg": avg(enemy_melee_dists), "med": median(enemy_melee_dists), "count": len(enemy_melee_dists)},
        "our_melee_dists": {"avg": avg(our_melee_dists), "med": median(our_melee_dists), "count": len(our_melee_dists)},
        "enemy_ability_dists": {"avg": avg(enemy_ability_dists), "med": median(enemy_ability_dists), "count": len(enemy_ability_dists)},
        "our_ability_dists": {"avg": avg(our_ability_dists), "med": median(our_ability_dists), "count": len(our_ability_dists)},
        "combat_proximity_distribution": dist_ranges,
        "all_engagement_distances": engagement_distances,
    }


def analyze_focus_fire(match):
    """Detect focus fire: is damage concentrated on one bot at a time?"""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    # Track health of each of our bots over time
    our_health_timeline = {bid: [] for bid in our_ids}
    enemy_health_timeline = {bid: [] for bid in enemy_ids}

    for frame in data["frames"]:
        tick = frame["tick"]
        for b in frame["bots"]:
            if b["id"] in our_ids:
                our_health_timeline[b["id"]].append((tick, b["health"], b["alive"]))
            elif b["id"] in enemy_ids:
                enemy_health_timeline[b["id"]].append((tick, b["health"], b["alive"]))

    # For each tick window, check how many of our bots are taking damage
    # Window: 10 ticks (1 second)
    dmg_per_bot_per_window = defaultdict(lambda: defaultdict(int))

    for frame in data["frames"]:
        tick = frame["tick"]
        window = tick // 10
        for ev in frame.get("events", []):
            if ev["type"] == "damage" and ev["targetId"] in our_ids and ev["damage"] != ZONE_DAMAGE:
                dmg_per_bot_per_window[window][ev["targetId"]] += ev["damage"]

    # Measure focus: in each window with damage, what % goes to the most-damaged bot?
    focus_ratios = []
    for window, bot_dmg in sorted(dmg_per_bot_per_window.items()):
        total = sum(bot_dmg.values())
        max_dmg = max(bot_dmg.values())
        n_targets = len(bot_dmg)
        focus_ratios.append({
            "window_start_tick": window * 10,
            "total_dmg": total,
            "max_single_bot_dmg": max_dmg,
            "focus_ratio": max_dmg / total if total > 0 else 0,
            "num_targets": n_targets,
        })

    # Same analysis for enemy (are WE focus firing?)
    enemy_dmg_per_bot_per_window = defaultdict(lambda: defaultdict(int))
    for frame in data["frames"]:
        tick = frame["tick"]
        window = tick // 10
        for ev in frame.get("events", []):
            if ev["type"] == "damage" and ev["targetId"] in enemy_ids and ev["damage"] != ZONE_DAMAGE:
                enemy_dmg_per_bot_per_window[window][ev["targetId"]] += ev["damage"]

    our_focus_ratios = []
    for window, bot_dmg in sorted(enemy_dmg_per_bot_per_window.items()):
        total = sum(bot_dmg.values())
        max_dmg = max(bot_dmg.values())
        our_focus_ratios.append({
            "window_start_tick": window * 10,
            "total_dmg": total,
            "max_single_bot_dmg": max_dmg,
            "focus_ratio": max_dmg / total if total > 0 else 0,
            "num_targets": len(bot_dmg),
        })

    # Track which of our bots gets targeted and when
    damage_taken_per_bot = defaultdict(int)
    for frame in data["frames"]:
        for ev in frame.get("events", []):
            if ev["type"] == "damage" and ev["targetId"] in our_ids and ev["damage"] != ZONE_DAMAGE:
                damage_taken_per_bot[ev["targetId"]] += ev["damage"]

    return {
        "enemy_focus_on_us": focus_ratios,
        "our_focus_on_them": our_focus_ratios,
        "avg_enemy_focus_ratio": avg([f["focus_ratio"] for f in focus_ratios]),
        "avg_our_focus_ratio": avg([f["focus_ratio"] for f in our_focus_ratios]),
        "damage_taken_per_bot": dict(damage_taken_per_bot),
        "our_health_timeline": our_health_timeline,
        "enemy_health_timeline": enemy_health_timeline,
    }


def analyze_ability_usage(match):
    """Detect AoE ability usage and effectiveness."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    ability_events = []

    for frame in data["frames"]:
        tick = frame["tick"]
        for ev in frame.get("events", []):
            if ev["type"] == "ability":
                caster = ev["botId"]
                target_pos = ev["targetPosition"]
                team = "ours" if caster in our_ids else "enemy"
                ability_events.append({
                    "tick": tick,
                    "caster": caster,
                    "team": team,
                    "target_pos": target_pos,
                })

    # Match abilities to damage events on same tick
    ability_damage = []
    for frame in data["frames"]:
        tick = frame["tick"]
        abilities_this_tick = [ev for ev in frame.get("events", []) if ev["type"] == "ability"]
        damages_this_tick = [ev for ev in frame.get("events", []) if ev["type"] == "damage" and ev["damage"] == 15]

        for ab in abilities_this_tick:
            caster = ab["botId"]
            team = "ours" if caster in our_ids else "enemy"
            targets_hit = [d["targetId"] for d in damages_this_tick if d["attackerId"] == caster]
            ability_damage.append({
                "tick": tick,
                "caster": caster,
                "team": team,
                "targets_hit": len(targets_hit),
                "target_ids": targets_hit,
            })

    our_abilities = [a for a in ability_damage if a["team"] == "ours"]
    enemy_abilities = [a for a in ability_damage if a["team"] == "enemy"]

    our_total_ability_hits = sum(a["targets_hit"] for a in our_abilities)
    enemy_total_ability_hits = sum(a["targets_hit"] for a in enemy_abilities)

    # Multi-hit abilities (AoE hitting 2+)
    our_multi_hits = [a for a in our_abilities if a["targets_hit"] >= 2]
    enemy_multi_hits = [a for a in enemy_abilities if a["targets_hit"] >= 2]

    return {
        "our_abilities_cast": len(our_abilities),
        "enemy_abilities_cast": len(enemy_abilities),
        "our_total_ability_hits": our_total_ability_hits,
        "enemy_total_ability_hits": enemy_total_ability_hits,
        "our_avg_hits_per_ability": avg([a["targets_hit"] for a in our_abilities]),
        "enemy_avg_hits_per_ability": avg([a["targets_hit"] for a in enemy_abilities]),
        "our_multi_hit_abilities": len(our_multi_hits),
        "enemy_multi_hit_abilities": len(enemy_multi_hits),
        "our_ability_details": our_abilities,
        "enemy_ability_details": enemy_abilities,
    }


def analyze_zone_awareness(match):
    """Track which bots are outside the zone and when."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    our_outside_ticks = defaultdict(int)  # bot_id -> ticks outside zone
    enemy_outside_ticks = defaultdict(int)
    our_zone_deaths = 0
    enemy_zone_deaths = 0

    for frame in data["frames"]:
        tick = frame["tick"]
        zone = frame.get("zone", {})
        zone_center = {"x": zone.get("centerX", 1024), "y": zone.get("centerY", 1024)}
        zone_radius = zone.get("radius", ZONE_INITIAL_RADIUS)

        for b in frame["bots"]:
            if not b["alive"]:
                continue
            if is_outside_zone(b["position"], zone_center, zone_radius):
                if b["id"] in our_ids:
                    our_outside_ticks[b["id"]] += 1
                elif b["id"] in enemy_ids:
                    enemy_outside_ticks[b["id"]] += 1

    # Count zone damage events
    for frame in data["frames"]:
        for ev in frame.get("events", []):
            if ev["type"] == "damage" and ev["damage"] == ZONE_DAMAGE:
                if ev["targetId"] in our_ids:
                    our_zone_deaths += ev["damage"]
                elif ev["targetId"] in enemy_ids:
                    enemy_zone_deaths += ev["damage"]

    return {
        "our_total_ticks_outside": sum(our_outside_ticks.values()),
        "enemy_total_ticks_outside": sum(enemy_outside_ticks.values()),
        "our_outside_per_bot": dict(our_outside_ticks),
        "enemy_outside_per_bot": dict(enemy_outside_ticks),
        "our_zone_damage_taken": our_zone_deaths,
        "enemy_zone_damage_taken": enemy_zone_deaths,
    }


def analyze_movement_patterns(match):
    """Analyze convergence, splitting, and surrounding behavior."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    # Track distance of each team's centroid from arena center over time
    arena_center = {"x": 1024, "y": 1024}

    convergence = []

    for frame in data["frames"]:
        tick = frame["tick"]
        if tick % 10 != 0:  # Sample every second
            continue

        our_alive_pos = [b["position"] for b in frame["bots"] if b["alive"] and b["id"] in our_ids]
        enemy_alive_pos = [b["position"] for b in frame["bots"] if b["alive"] and b["id"] in enemy_ids]

        zone = frame.get("zone", {})
        zone_center = {"x": zone.get("centerX", 1024), "y": zone.get("centerY", 1024)}

        our_c = centroid(our_alive_pos) if our_alive_pos else None
        enemy_c = centroid(enemy_alive_pos) if enemy_alive_pos else None

        convergence.append({
            "tick": tick,
            "our_dist_from_zone_center": dist(our_c, zone_center) if our_c else None,
            "enemy_dist_from_zone_center": dist(enemy_c, zone_center) if enemy_c else None,
            "our_alive": len(our_alive_pos),
            "enemy_alive": len(enemy_alive_pos),
        })

    # Detect splitting: periods where enemy spread increases suddenly
    # Track enemy spread change over time
    spread_timeline = []
    prev_spread = None
    for frame in data["frames"]:
        tick = frame["tick"]
        if tick % 5 != 0:
            continue
        enemy_alive_pos = [b["position"] for b in frame["bots"] if b["alive"] and b["id"] in enemy_ids]
        spread = avg_team_spread(enemy_alive_pos)
        if prev_spread is not None:
            spread_timeline.append((tick, spread, spread - prev_spread))
        prev_spread = spread

    # Detect surrounding: are enemies on both sides of our centroid?
    surround_scores = []
    for frame in data["frames"]:
        tick = frame["tick"]
        if tick % 20 != 0:
            continue
        our_alive_pos = [b["position"] for b in frame["bots"] if b["alive"] and b["id"] in our_ids]
        enemy_alive_pos = [b["position"] for b in frame["bots"] if b["alive"] and b["id"] in enemy_ids]

        if len(our_alive_pos) < 1 or len(enemy_alive_pos) < 2:
            continue

        our_c = centroid(our_alive_pos)

        # Calculate angles from our centroid to each enemy
        angles = []
        for ep in enemy_alive_pos:
            angle = math.atan2(ep["y"] - our_c["y"], ep["x"] - our_c["x"])
            angles.append(angle)

        # Surround score: max angular gap between enemies
        # If enemies surround us, the gaps between adjacent angles are small and even
        # If enemies are clustered, there's one big gap
        angles.sort()
        if len(angles) >= 2:
            gaps = []
            for i in range(len(angles)):
                gap = angles[(i + 1) % len(angles)] - angles[i]
                if gap < 0:
                    gap += 2 * math.pi
                gaps.append(gap)
            max_gap = max(gaps)
            # Lower max_gap = more surrounded. Full surround = max_gap ~72deg for 5 bots
            # Clustered = max_gap ~300deg
            surround_score = 1.0 - (max_gap / (2 * math.pi))  # 0=clustered, 1=surrounded
            surround_scores.append((tick, surround_score, len(enemy_alive_pos)))

    return {
        "convergence": convergence,
        "spread_timeline": spread_timeline,
        "surround_scores": surround_scores,
    }


def analyze_engagement_position(match):
    """Where on the map does the first engagement happen?"""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    first_combat_tick = None
    first_combat_pos = None

    for frame in data["frames"]:
        tick = frame["tick"]
        for ev in frame.get("events", []):
            if ev["type"] == "damage" and ev["damage"] != ZONE_DAMAGE:
                first_combat_tick = tick
                # Get positions of all bots at this tick
                positions = {b["id"]: b["position"] for b in frame["bots"] if b["alive"]}
                attacker_pos = positions.get(ev["attackerId"])
                target_pos = positions.get(ev["targetId"])

                our_pos = [positions[bid] for bid in our_ids if bid in positions]
                enemy_pos = [positions[bid] for bid in enemy_ids if bid in positions]

                first_combat_pos = {
                    "attacker_pos": attacker_pos,
                    "target_pos": target_pos,
                    "our_centroid": centroid(our_pos),
                    "enemy_centroid": centroid(enemy_pos),
                    "our_spread": avg_team_spread(our_pos),
                    "enemy_spread": avg_team_spread(enemy_pos),
                }
                break
        if first_combat_tick:
            break

    # Also find spawn positions
    frame0 = data["frames"][0]
    our_spawn = [b["position"] for b in frame0["bots"] if b["id"] in our_ids]
    enemy_spawn = [b["position"] for b in frame0["bots"] if b["id"] in enemy_ids]

    return {
        "first_combat_tick": first_combat_tick,
        "first_combat_sec": first_combat_tick / 10.0 if first_combat_tick else None,
        "first_combat_details": first_combat_pos,
        "our_spawn_centroid": centroid(our_spawn),
        "enemy_spawn_centroid": centroid(enemy_spawn),
        "our_spawn_spread": avg_team_spread(our_spawn),
        "enemy_spawn_spread": avg_team_spread(enemy_spawn),
    }


def analyze_damage_sequencing(match):
    """Detailed tick-by-tick damage analysis: who attacks whom, in what order."""
    data = match["data"]
    our_ids = match["our_ids"]
    enemy_ids = match["enemy_ids"]

    # Track which enemy bots attack which of our bots
    enemy_target_choices = defaultdict(list)  # enemy_id -> [(tick, target_id, dmg)]
    our_target_choices = defaultdict(list)

    for frame in data["frames"]:
        tick = frame["tick"]
        for ev in frame.get("events", []):
            if ev["type"] == "damage" and ev["damage"] != ZONE_DAMAGE:
                atk = ev["attackerId"]
                tgt = ev["targetId"]
                dmg = ev["damage"]
                if atk in enemy_ids:
                    enemy_target_choices[atk].append((tick, tgt, dmg))
                elif atk in our_ids:
                    our_target_choices[atk].append((tick, tgt, dmg))

    # How quickly do enemies switch targets?
    enemy_target_switches = {}
    for enemy_id, attacks in enemy_target_choices.items():
        switches = 0
        prev_target = None
        for _, tgt, _ in attacks:
            if prev_target is not None and tgt != prev_target:
                switches += 1
            prev_target = tgt
        enemy_target_switches[enemy_id] = {"attacks": len(attacks), "switches": switches}

    # Same for us
    our_target_switches = {}
    for our_id, attacks in our_target_choices.items():
        switches = 0
        prev_target = None
        for _, tgt, _ in attacks:
            if prev_target is not None and tgt != prev_target:
                switches += 1
            prev_target = tgt
        our_target_switches[our_id] = {"attacks": len(attacks), "switches": switches}

    # On each tick with damage, how many different enemy bots are attacking our weakest bot?
    # (Coordination metric)
    tick_attacks_on_target = defaultdict(lambda: defaultdict(set))  # tick -> target -> set of attackers
    for frame in data["frames"]:
        tick = frame["tick"]
        for ev in frame.get("events", []):
            if ev["type"] == "damage" and ev["damage"] != ZONE_DAMAGE:
                if ev["attackerId"] in enemy_ids and ev["targetId"] in our_ids:
                    tick_attacks_on_target[tick][ev["targetId"]].add(ev["attackerId"])

    # Max coordination: most attackers on single target in one tick
    max_coord = 0
    max_coord_tick = 0
    for tick, targets in tick_attacks_on_target.items():
        for tgt, attackers in targets.items():
            if len(attackers) > max_coord:
                max_coord = len(attackers)
                max_coord_tick = tick

    return {
        "enemy_target_switches": enemy_target_switches,
        "our_target_switches": our_target_switches,
        "max_simultaneous_attackers_on_one_target": max_coord,
        "max_coord_tick": max_coord_tick,
        "enemy_target_choices": {k: [(t, tgt.split(":")[1], d) for t, tgt, d in v] for k, v in enemy_target_choices.items()},
    }


# ── Main Analysis & Output ───────────────────────────────────────────────────

def print_section(title, char="="):
    width = 80
    print()
    print(char * width)
    print(f" {title}")
    print(char * width)


def print_subsection(title):
    print(f"\n  --- {title} ---")


def format_bot_label(bot_id, our_ids, prefix=""):
    team = "Us" if bot_id in our_ids else "Them"
    num = bot_id.split(":")[1]
    return f"{prefix}{team}#{num}"


def run_analysis():
    print("=" * 80)
    print(" CLAWBER.AI BATTLE REPLAY ANALYSIS — 3 LOSSES")
    print(" SEMalytics vs Top Opponents")
    print("=" * 80)

    for file_idx, filepath in enumerate(REPLAY_FILES):
        match = load_match(filepath)

        print_section(f"MATCH {file_idx + 1}: SEMalytics vs {match['enemy_agent']}")
        print(f"  Match ID: {match['match_id']}")
        print(f"  Duration: {match['duration']} ticks ({match['duration']/10:.1f} seconds)")
        print(f"  Winner: {'THEM' if match['winner_id'] not in match['our_ids'] else 'US'} ({match['winner_id'][:8]}...)")

        # ── 1. Death Timeline ─────────────────────────────────────────────
        print_subsection("1. DEATH TIMELINE")
        deaths = analyze_death_timeline(match)

        print(f"  Score: Us {deaths['our_kills']} kills - Them {deaths['enemy_kills']} kills")
        print(f"  First death: {'US' if deaths['our_first_death_tick'] and (deaths['enemy_first_death_tick'] is None or deaths['our_first_death_tick'] <= deaths['enemy_first_death_tick']) else 'THEM'}")

        print("\n  Tick  | Time   | Event")
        print("  " + "-" * 55)
        for d in deaths["all_deaths"]:
            marker = "!! " if d["team"] == "OURS" else "   "
            print(f"  {marker}{d['tick']:4d}  | {d['time_sec']:5.1f}s | {d['victim_label']} killed by {d['killer_label']}")

        if deaths["our_first_death_tick"] and deaths["enemy_first_death_tick"]:
            gap = deaths["enemy_first_death_tick"] - deaths["our_first_death_tick"]
            print(f"\n  First death gap: {abs(gap)} ticks ({abs(gap)/10:.1f}s) — {'THEM first' if gap < 0 else 'US first' if gap > 0 else 'Same tick'}")

        # ── 2. Damage Pacing ──────────────────────────────────────────────
        print_subsection("2. DAMAGE PACING")
        dmg = analyze_damage_pacing(match)

        print(f"  Total damage to US:   {dmg['total_dmg_to_us']:4d} HP")
        print(f"  Total damage to THEM: {dmg['total_dmg_to_them']:4d} HP")
        print(f"  First combat tick: {dmg['first_combat_tick']} ({dmg['first_combat_tick']/10:.1f}s)" if dmg['first_combat_tick'] else "  No combat damage!")

        print(f"\n  Damage breakdown (to us):  {dmg['dmg_types_to_us']}")
        print(f"  Damage breakdown (to them): {dmg['dmg_types_to_them']}")

        if dmg["top_burst_against_us"]:
            print(f"\n  Top burst damage windows against us (1-sec windows):")
            for tick_start, burst_dmg in dmg["top_burst_against_us"][:5]:
                print(f"    Tick {tick_start:4d}-{tick_start+10:4d} ({tick_start/10:.1f}s): {burst_dmg} dmg")

        # ── 3. Clustering Analysis ────────────────────────────────────────
        print_subsection("3. CLUSTERING ANALYSIS")

        # Key moments: tick 0, first combat, first death, midgame
        key_ticks = [0]
        if dmg["first_combat_tick"]:
            key_ticks.append(dmg["first_combat_tick"])
        if deaths["our_first_death_tick"]:
            key_ticks.append(deaths["our_first_death_tick"])
        key_ticks.append(match["duration"] // 2)
        key_ticks = sorted(set(key_ticks))

        clustering = analyze_clustering(match, key_ticks)

        print(f"  {'Tick':>5} | {'Time':>6} | {'Our Spread':>10} | {'Their Spread':>12} | {'Us Alive':>8} | {'Them Alive':>10} | {'Inter-team':>10}")
        print("  " + "-" * 80)
        for tick in key_ticks:
            if tick in clustering:
                c = clustering[tick]
                inter = f"{c['inter_team_dist']:.0f}" if c['inter_team_dist'] else "N/A"
                label = ""
                if tick == 0:
                    label = " (spawn)"
                elif tick == dmg.get("first_combat_tick"):
                    label = " (1st combat)"
                elif tick == deaths.get("our_first_death_tick"):
                    label = " (1st death)"
                print(f"  {tick:5d} | {tick/10:5.1f}s | {c['our_spread']:10.0f} | {c['enemy_spread']:12.0f} | {c['our_alive']:8d} | {c['enemy_alive']:10d} | {inter:>10}{label}")

        # Average clustering over time
        clust_time = analyze_clustering_over_time(match)
        our_avg_spread = avg([c["our_spread"] for c in clust_time if c["our_alive"] >= 2])
        enemy_avg_spread = avg([c["enemy_spread"] for c in clust_time if c["enemy_alive"] >= 2])
        print(f"\n  Average spread (while 2+ alive): Us={our_avg_spread:.0f}, Them={enemy_avg_spread:.0f}")
        tighter = "THEM" if enemy_avg_spread < our_avg_spread else "US"
        print(f"  {tighter} are more tightly grouped on average")

        # ── 4. Kiting Detection ───────────────────────────────────────────
        print_subsection("4. KITING DETECTION")
        kiting = analyze_kiting(match)

        print(f"  Enemy melee attack distances: avg={kiting['enemy_melee_dists']['avg']:.1f}, median={kiting['enemy_melee_dists']['med']:.1f} (n={kiting['enemy_melee_dists']['count']})")
        print(f"  Our melee attack distances:   avg={kiting['our_melee_dists']['avg']:.1f}, median={kiting['our_melee_dists']['med']:.1f} (n={kiting['our_melee_dists']['count']})")
        print(f"  Enemy ability distances:       avg={kiting['enemy_ability_dists']['avg']:.1f}, median={kiting['enemy_ability_dists']['med']:.1f} (n={kiting['enemy_ability_dists']['count']})")
        print(f"  Our ability distances:         avg={kiting['our_ability_dists']['avg']:.1f}, median={kiting['our_ability_dists']['med']:.1f} (n={kiting['our_ability_dists']['count']})")

        if kiting['combat_proximity_distribution']:
            print(f"\n  Nearest enemy distance distribution during combat:")
            for range_name, count in kiting['combat_proximity_distribution'].items():
                bar = "#" * min(count // 2, 50)
                print(f"    {range_name:30s}: {count:4d} {bar}")

        kite_signal = kiting['enemy_melee_dists']['avg'] > 170 if kiting['enemy_melee_dists']['count'] > 0 else False
        if kite_signal:
            print(f"\n  ** KITING DETECTED: Enemy melee attacks averaging {kiting['enemy_melee_dists']['avg']:.0f} units (near max range 200)")
        else:
            print(f"\n  No strong kiting signal (enemy melee at {kiting['enemy_melee_dists']['avg']:.0f} units, well within 200 range)")

        # ── 5. Focus Fire ─────────────────────────────────────────────────
        print_subsection("5. FOCUS FIRE ANALYSIS")
        focus = analyze_focus_fire(match)

        print(f"  Enemy focus ratio (on us): {focus['avg_enemy_focus_ratio']:.2f} (1.0 = perfect focus, 0.2 = spread)")
        print(f"  Our focus ratio (on them): {focus['avg_our_focus_ratio']:.2f}")

        print(f"\n  Damage taken per bot (combat only):")
        for bot_id, dmg_taken in sorted(focus["damage_taken_per_bot"].items()):
            label = format_bot_label(bot_id, match["our_ids"])
            print(f"    {label}: {dmg_taken} dmg")

        print(f"\n  Focus fire detail (enemy → us, per 1-sec window):")
        for f_entry in focus["enemy_focus_on_us"][:15]:
            focus_bar = "|" * int(f_entry["focus_ratio"] * 20)
            print(f"    Tick {f_entry['window_start_tick']:4d}: {f_entry['total_dmg']:3d} dmg on {f_entry['num_targets']} target(s), focus={f_entry['focus_ratio']:.2f} {focus_bar}")

        # ── 6. Ability Usage ──────────────────────────────────────────────
        print_subsection("6. ABILITY (AoE) USAGE")
        abilities = analyze_ability_usage(match)

        print(f"  Us:   {abilities['our_abilities_cast']} casts, {abilities['our_total_ability_hits']} hits, avg {abilities['our_avg_hits_per_ability']:.2f} hits/cast, {abilities['our_multi_hit_abilities']} multi-hit")
        print(f"  Them: {abilities['enemy_abilities_cast']} casts, {abilities['enemy_total_ability_hits']} hits, avg {abilities['enemy_avg_hits_per_ability']:.2f} hits/cast, {abilities['enemy_multi_hit_abilities']} multi-hit")

        if abilities['enemy_multi_hit_abilities'] > 0:
            print(f"\n  Enemy multi-hit abilities (AoE hitting 2+ bots):")
            for a in abilities["enemy_ability_details"]:
                if a["targets_hit"] >= 2:
                    print(f"    Tick {a['tick']}: hit {a['targets_hit']} of our bots")

        if abilities['our_multi_hit_abilities'] > 0:
            print(f"\n  Our multi-hit abilities:")
            for a in abilities["our_ability_details"]:
                if a["targets_hit"] >= 2:
                    print(f"    Tick {a['tick']}: hit {a['targets_hit']} enemy bots")

        # ── 7. Zone Awareness ─────────────────────────────────────────────
        print_subsection("7. ZONE AWARENESS")
        zone = analyze_zone_awareness(match)

        print(f"  Our total ticks outside zone:   {zone['our_total_ticks_outside']} (across all bots)")
        print(f"  Their total ticks outside zone:  {zone['enemy_total_ticks_outside']}")
        print(f"  Zone damage taken by us:   {zone['our_zone_damage_taken']} HP")
        print(f"  Zone damage taken by them: {zone['enemy_zone_damage_taken']} HP")

        if zone['our_outside_per_bot']:
            print(f"\n  Our bots outside zone (ticks per bot):")
            for bot_id, ticks in sorted(zone['our_outside_per_bot'].items()):
                print(f"    #{bot_id.split(':')[1]}: {ticks} ticks")

        if zone['enemy_outside_per_bot']:
            print(f"\n  Enemy bots outside zone (ticks per bot):")
            for bot_id, ticks in sorted(zone['enemy_outside_per_bot'].items()):
                print(f"    #{bot_id.split(':')[1]}: {ticks} ticks")

        # ── 8. Movement Patterns ──────────────────────────────────────────
        print_subsection("8. MOVEMENT PATTERNS")
        movement = analyze_movement_patterns(match)

        # Zone convergence
        print(f"  Distance from zone center over time:")
        print(f"  {'Tick':>5} | {'Time':>6} | {'Us→Center':>10} | {'Them→Center':>12} | {'Us Alive':>8} | {'Them Alive':>10}")
        print("  " + "-" * 65)
        for c in movement["convergence"][:30]:
            our_d = f"{c['our_dist_from_zone_center']:.0f}" if c['our_dist_from_zone_center'] else "dead"
            their_d = f"{c['enemy_dist_from_zone_center']:.0f}" if c['enemy_dist_from_zone_center'] else "dead"
            print(f"  {c['tick']:5d} | {c['tick']/10:5.1f}s | {our_d:>10} | {their_d:>12} | {c['our_alive']:8d} | {c['enemy_alive']:10d}")

        # Surround scores
        if movement["surround_scores"]:
            print(f"\n  Surround score (0=enemies clustered, 1=enemies surrounding us):")
            for tick, score, n_enemies in movement["surround_scores"][:20]:
                bar = "|" * int(score * 30)
                print(f"    Tick {tick:4d}: {score:.2f} ({n_enemies} enemies alive) {bar}")

        # ── 9. Engagement Position ────────────────────────────────────────
        print_subsection("9. ENGAGEMENT POSITION")
        engage = analyze_engagement_position(match)

        print(f"  Spawn positions:")
        print(f"    Our centroid:   ({engage['our_spawn_centroid']['x']:.0f}, {engage['our_spawn_centroid']['y']:.0f}), spread={engage['our_spawn_spread']:.0f}")
        print(f"    Their centroid: ({engage['enemy_spawn_centroid']['x']:.0f}, {engage['enemy_spawn_centroid']['y']:.0f}), spread={engage['enemy_spawn_spread']:.0f}")

        if engage["first_combat_details"]:
            fc = engage["first_combat_details"]
            print(f"\n  First engagement (tick {engage['first_combat_tick']}, {engage['first_combat_sec']:.1f}s):")
            print(f"    Our centroid:   ({fc['our_centroid']['x']:.0f}, {fc['our_centroid']['y']:.0f}), spread={fc['our_spread']:.0f}")
            print(f"    Their centroid: ({fc['enemy_centroid']['x']:.0f}, {fc['enemy_centroid']['y']:.0f}), spread={fc['enemy_spread']:.0f}")

        # ── BONUS: Damage Sequencing ──────────────────────────────────────
        print_subsection("BONUS: DAMAGE SEQUENCING & COORDINATION")
        seq = analyze_damage_sequencing(match)

        print(f"  Max simultaneous attackers on one of our bots: {seq['max_simultaneous_attackers_on_one_target']} (tick {seq['max_coord_tick']})")

        print(f"\n  Enemy target switching behavior:")
        for eid, stats in sorted(seq["enemy_target_switches"].items()):
            label = f"Them#{eid.split(':')[1]}"
            print(f"    {label}: {stats['attacks']} attacks, {stats['switches']} target switches")

        print(f"\n  Our target switching behavior:")
        for oid, stats in sorted(seq["our_target_switches"].items()):
            label = f"Us#{oid.split(':')[1]}"
            print(f"    {label}: {stats['attacks']} attacks, {stats['switches']} target switches")

        # Show enemy attack sequence (which of our bots they hit, in order)
        print(f"\n  Enemy attack sequence (who they hit):")
        all_enemy_attacks = []
        for eid, attacks in seq["enemy_target_choices"].items():
            for tick, tgt_num, dmg in attacks:
                all_enemy_attacks.append((tick, eid.split(":")[1], tgt_num, dmg))
        all_enemy_attacks.sort()
        for tick, attacker_num, target_num, dmg in all_enemy_attacks[:30]:
            dtype = "AoE" if dmg == 15 else "melee"
            print(f"    Tick {tick:4d}: Them#{attacker_num} → Us#{target_num} ({dtype}, {dmg} dmg)")

    # ── Cross-Match Summary ───────────────────────────────────────────────
    print_section("CROSS-MATCH SUMMARY & KEY FINDINGS", "=")

    all_matches = [load_match(f) for f in REPLAY_FILES]

    print("\n  Match Overview:")
    print(f"  {'#':>2} | {'Opponent':30s} | {'Duration':>10} | {'Score':>7} | {'1st Death':>10} | {'Total Dmg Dealt':>15} | {'Total Dmg Taken':>15}")
    print("  " + "-" * 105)

    for i, m in enumerate(all_matches):
        deaths = analyze_death_timeline(m)
        dmg = analyze_damage_pacing(m)
        first_who = "US" if deaths["our_first_death_tick"] and (deaths["enemy_first_death_tick"] is None or deaths["our_first_death_tick"] <= deaths["enemy_first_death_tick"]) else "THEM"
        first_tick = min(t for t in [deaths["our_first_death_tick"], deaths["enemy_first_death_tick"]] if t is not None)
        print(f"  {i+1:2d} | {m['enemy_agent']:30s} | {m['duration']/10:7.1f}s | {deaths['our_kills']}-{deaths['enemy_kills']:d} | {first_who:4s} @{first_tick/10:.1f}s | {dmg['total_dmg_to_them']:15d} | {dmg['total_dmg_to_us']:15d}")

    print(f"\n  KEY PATTERNS ACROSS ALL 3 LOSSES:")

    # Aggregate stats
    total_focus_enemy = []
    total_focus_us = []
    total_our_spread = []
    total_enemy_spread = []
    total_our_zone = 0
    total_enemy_zone = 0
    total_our_abilities_cast = 0
    total_enemy_abilities_cast = 0
    total_our_ability_hits = 0
    total_enemy_ability_hits = 0
    first_death_us_count = 0

    for m in all_matches:
        focus = analyze_focus_fire(m)
        total_focus_enemy.append(focus["avg_enemy_focus_ratio"])
        total_focus_us.append(focus["avg_our_focus_ratio"])

        clust = analyze_clustering_over_time(m)
        total_our_spread.extend([c["our_spread"] for c in clust if c["our_alive"] >= 2])
        total_enemy_spread.extend([c["enemy_spread"] for c in clust if c["enemy_alive"] >= 2])

        zone = analyze_zone_awareness(m)
        total_our_zone += zone["our_zone_damage_taken"]
        total_enemy_zone += zone["enemy_zone_damage_taken"]

        ab = analyze_ability_usage(m)
        total_our_abilities_cast += ab["our_abilities_cast"]
        total_enemy_abilities_cast += ab["enemy_abilities_cast"]
        total_our_ability_hits += ab["our_total_ability_hits"]
        total_enemy_ability_hits += ab["enemy_total_ability_hits"]

        deaths = analyze_death_timeline(m)
        if deaths["our_first_death_tick"] and (deaths["enemy_first_death_tick"] is None or deaths["our_first_death_tick"] <= deaths["enemy_first_death_tick"]):
            first_death_us_count += 1

    print(f"\n  1. FOCUS FIRE:")
    print(f"     Enemy focus on us (avg across matches): {avg(total_focus_enemy):.2f}")
    print(f"     Our focus on them (avg across matches):  {avg(total_focus_us):.2f}")
    better_focus = "THEM" if avg(total_focus_enemy) > avg(total_focus_us) else "US"
    print(f"     -> {better_focus} have better focus fire")

    print(f"\n  2. CLUSTERING:")
    print(f"     Our avg spread:   {avg(total_our_spread):.0f} units")
    print(f"     Their avg spread: {avg(total_enemy_spread):.0f} units")

    print(f"\n  3. ZONE AWARENESS:")
    print(f"     Zone damage to us:   {total_our_zone} HP total")
    print(f"     Zone damage to them: {total_enemy_zone} HP total")

    print(f"\n  4. ABILITY USAGE:")
    print(f"     Our abilities: {total_our_abilities_cast} casts, {total_our_ability_hits} hits ({total_our_ability_hits * 15} total dmg)")
    print(f"     Their abilities: {total_enemy_abilities_cast} casts, {total_enemy_ability_hits} hits ({total_enemy_ability_hits * 15} total dmg)")

    print(f"\n  5. FIRST BLOOD:")
    print(f"     We died first in {first_death_us_count}/3 matches")

    print(f"\n  6. GAME DURATION:")
    durations = [m["duration"] for m in all_matches]
    print(f"     Match durations: {', '.join(f'{d/10:.1f}s' for d in durations)}")
    print(f"     Average: {avg(durations)/10:.1f}s")


if __name__ == "__main__":
    run_analysis()
