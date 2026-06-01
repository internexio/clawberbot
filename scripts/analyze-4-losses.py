#!/usr/bin/env python3
"""Analyze 4 loss replays to find patterns across losses."""

import json
import math
from collections import defaultdict

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

REPLAYS = [
    ("ClawMaster-09830033 (blowout)", "match-history/replay-loss-ClawMaster-09830033.json"),
    ("ClawMaster-3a7539b9 (close)", "match-history/replay-loss-ClawMaster-3a7539b9.json"),
    ("AdaptiveAI-39b148dc", "match-history/replay-loss-AdaptiveAI-39b148dc.json"),
    ("FlexCore-5a005598 (more dmg)", "match-history/replay-loss-FlexCore-5a005598.json"),
]

KEY_TICKS = [0, 100, 300, 500, 800, 1000, 1200]
SPREAD_TICKS = [200, 400, 600, 800]


def dist(a, b):
    return math.sqrt((a["x"] - b["x"])**2 + (a["y"] - b["y"])**2)


def dist_to_zone(pos, zone):
    cx, cy, r = zone["centerX"], zone["centerY"], zone["radius"]
    d = math.sqrt((pos["x"] - cx)**2 + (pos["y"] - cy)**2)
    return d - r  # positive = outside zone


def avg_pairwise_spread(positions):
    if len(positions) < 2:
        return 0
    total = 0
    count = 0
    for i in range(len(positions)):
        for j in range(i+1, len(positions)):
            total += dist(positions[i], positions[j])
            count += 1
    return total / count


def analyze_replay(name, path):
    with open(path) as f:
        data = json.load(f)

    result = {"name": name}

    # Map bots to teams
    our_ids = set()
    enemy_ids = set()
    enemy_agent = None
    for b in data["bots"]:
        if b["agentId"] == OUR_AGENT:
            our_ids.add(b["id"])
        else:
            enemy_ids.add(b["id"])
            enemy_agent = b.get("name", "").split(" #")[0]

    result["enemy"] = enemy_agent
    result["our_ids"] = our_ids
    result["enemy_ids"] = enemy_ids

    frames = data["frames"]
    num_ticks = len(frames)
    result["num_ticks"] = num_ticks

    # Winner
    winner_id = data.get("winner", "")
    winner_agent = None
    for b in data["bots"]:
        if b["id"] == winner_id:
            winner_agent = "US" if b["agentId"] == OUR_AGENT else enemy_agent
    result["winner"] = winner_agent or "unknown"

    # ---- Snapshot data at key ticks ----
    snapshots = {}
    for tick in KEY_TICKS:
        if tick >= num_ticks:
            continue
        frame = frames[tick]
        our_bots = []
        enemy_bots = []
        for b in frame["bots"]:
            entry = {
                "id": b["id"],
                "pos": b["position"],
                "hp": b["health"],
                "ammo": b["ammo"],
                "alive": b["alive"],
            }
            if b["id"] in our_ids:
                our_bots.append(entry)
            else:
                enemy_bots.append(entry)
        snapshots[tick] = {
            "our": our_bots,
            "enemy": enemy_bots,
            "zone": frame["zone"],
        }
    result["snapshots"] = snapshots

    # ---- Spread at key ticks ----
    spreads = {}
    for tick in SPREAD_TICKS:
        if tick >= num_ticks:
            continue
        frame = frames[tick]
        our_positions = []
        enemy_positions = []
        for b in frame["bots"]:
            if not b["alive"]:
                continue
            if b["id"] in our_ids:
                our_positions.append(b["position"])
            else:
                enemy_positions.append(b["position"])
        spreads[tick] = {
            "our": avg_pairwise_spread(our_positions),
            "enemy": avg_pairwise_spread(enemy_positions),
        }
    result["spreads"] = spreads

    # ---- Event analysis ----
    our_damage_dealt = 0  # by our bots (combat)
    our_damage_taken = 0  # to our bots (combat)
    our_zone_damage = 0
    enemy_zone_damage = 0
    our_kills = 0
    enemy_kills = 0
    our_pickups = {"health": 0, "ammo": 0}
    enemy_pickups = {"health": 0, "ammo": 0}
    our_abilities_used = 0
    enemy_abilities_used = 0

    # Damage by tick ranges
    tick_ranges = [(0, 200), (200, 400), (400, 600), (600, 800), (800, 1000), (1000, 1200)]
    our_dmg_taken_by_range = {r: 0 for r in tick_ranges}
    enemy_dmg_taken_by_range = {r: 0 for r in tick_ranges}

    # AoE multi-hit tracking
    aoe_multi_hits_on_us = 0  # AoE that hit 2+ of our bots
    aoe_events_by_tick = defaultdict(list)

    # Zone damage tracking by tick
    our_zone_dmg_by_range = {r: 0 for r in tick_ranges}

    # Track when our bots go outside zone
    our_outside_zone_ticks = 0
    our_total_alive_ticks = 0

    pickup_events = []

    for frame in frames:
        tick = frame["tick"]
        zone = frame["zone"]

        # Track zone positioning
        for b in frame["bots"]:
            if not b["alive"]:
                continue
            if b["id"] in our_ids:
                our_total_alive_ticks += 1
                d = dist_to_zone(b["position"], zone)
                if d > 0:
                    our_outside_zone_ticks += 1

        for ev in frame.get("events", []):
            t = ev["type"]

            if t == "damage":
                attacker = ev["attackerId"]
                target = ev["targetId"]
                dmg = ev["damage"]

                tr = None
                for r in tick_ranges:
                    if r[0] <= tick < r[1]:
                        tr = r
                        break

                if attacker == "zone":
                    if target in our_ids:
                        our_zone_damage += dmg
                        if tr:
                            our_zone_dmg_by_range[tr] += dmg
                    else:
                        enemy_zone_damage += dmg
                elif attacker in our_ids and target in enemy_ids:
                    our_damage_dealt += dmg
                    if tr:
                        enemy_dmg_taken_by_range[tr] += dmg
                elif attacker in enemy_ids and target in our_ids:
                    our_damage_taken += dmg
                    if tr:
                        our_dmg_taken_by_range[tr] += dmg

                # Track AoE multi-hits (15 dmg = ability)
                if dmg == 15 and attacker in enemy_ids and target in our_ids:
                    aoe_events_by_tick[tick].append(ev)

            elif t == "kill":
                if ev["killerId"] in our_ids or ev["killerId"] == "zone":
                    if ev["victimId"] in enemy_ids:
                        our_kills += 1
                if ev["killerId"] in enemy_ids or ev["killerId"] == "zone":
                    if ev["victimId"] in our_ids:
                        enemy_kills += 1
                # Zone kills
                if ev["killerId"] == "zone":
                    if ev["victimId"] in our_ids:
                        pass  # counted above
                    elif ev["victimId"] in enemy_ids:
                        pass

            elif t == "powerup_collect":
                ptype = ev.get("powerupType", "unknown")
                if ev["botId"] in our_ids:
                    our_pickups[ptype] = our_pickups.get(ptype, 0) + 1
                else:
                    enemy_pickups[ptype] = enemy_pickups.get(ptype, 0) + 1
                pickup_events.append({
                    "tick": tick,
                    "team": "us" if ev["botId"] in our_ids else "enemy",
                    "type": ptype,
                })

            elif t == "ability":
                if ev["botId"] in our_ids:
                    our_abilities_used += 1
                else:
                    enemy_abilities_used += 1

    # Count AoE multi-hits (same tick, same attacker, 2+ of our bots hit)
    for tick, evts in aoe_events_by_tick.items():
        attackers = defaultdict(int)
        for ev in evts:
            attackers[ev["attackerId"]] += 1
        for a, count in attackers.items():
            if count >= 2:
                aoe_multi_hits_on_us += 1

    result["our_damage_dealt"] = our_damage_dealt
    result["our_damage_taken"] = our_damage_taken
    result["our_zone_damage"] = our_zone_damage
    result["enemy_zone_damage"] = enemy_zone_damage
    result["our_kills"] = our_kills
    result["enemy_kills"] = enemy_kills
    result["our_pickups"] = our_pickups
    result["enemy_pickups"] = enemy_pickups
    result["our_abilities_used"] = our_abilities_used
    result["enemy_abilities_used"] = enemy_abilities_used
    result["aoe_multi_hits_on_us"] = aoe_multi_hits_on_us
    result["our_dmg_taken_by_range"] = our_dmg_taken_by_range
    result["enemy_dmg_taken_by_range"] = enemy_dmg_taken_by_range
    result["our_zone_dmg_by_range"] = our_zone_dmg_by_range
    result["our_outside_zone_pct"] = (our_outside_zone_ticks / our_total_alive_ticks * 100) if our_total_alive_ticks > 0 else 0
    result["pickup_events"] = pickup_events

    # Final state
    last_frame = frames[-1]
    our_alive = sum(1 for b in last_frame["bots"] if b["id"] in our_ids and b["alive"])
    enemy_alive = sum(1 for b in last_frame["bots"] if b["id"] in enemy_ids and b["alive"])
    our_total_hp = sum(b["health"] for b in last_frame["bots"] if b["id"] in our_ids and b["alive"])
    enemy_total_hp = sum(b["health"] for b in last_frame["bots"] if b["id"] in enemy_ids and b["alive"])
    our_total_ammo = sum(b["ammo"] for b in last_frame["bots"] if b["id"] in our_ids and b["alive"])
    enemy_total_ammo = sum(b["ammo"] for b in last_frame["bots"] if b["id"] in enemy_ids and b["alive"])

    result["final"] = {
        "our_alive": our_alive,
        "enemy_alive": enemy_alive,
        "our_hp": our_total_hp,
        "enemy_hp": enemy_total_hp,
        "our_ammo": our_total_ammo,
        "enemy_ammo": enemy_total_ammo,
    }

    # HP timeline at key ticks
    hp_timeline = {}
    for tick in KEY_TICKS:
        if tick >= num_ticks:
            continue
        frame = frames[tick]
        our_hp = sum(b["health"] for b in frame["bots"] if b["id"] in our_ids and b["alive"])
        enemy_hp = sum(b["health"] for b in frame["bots"] if b["id"] in enemy_ids and b["alive"])
        our_alive_n = sum(1 for b in frame["bots"] if b["id"] in our_ids and b["alive"])
        enemy_alive_n = sum(1 for b in frame["bots"] if b["id"] in enemy_ids and b["alive"])
        hp_timeline[tick] = {
            "our_hp": our_hp, "enemy_hp": enemy_hp,
            "our_alive": our_alive_n, "enemy_alive": enemy_alive_n,
        }
    result["hp_timeline"] = hp_timeline

    # Ammo timeline
    ammo_timeline = {}
    for tick in KEY_TICKS:
        if tick >= num_ticks:
            continue
        frame = frames[tick]
        our_ammo = sum(b["ammo"] for b in frame["bots"] if b["id"] in our_ids and b["alive"])
        enemy_ammo = sum(b["ammo"] for b in frame["bots"] if b["id"] in enemy_ids and b["alive"])
        ammo_timeline[tick] = {"our": our_ammo, "enemy": enemy_ammo}
    result["ammo_timeline"] = ammo_timeline

    return result


def print_separator():
    print("=" * 100)


def main():
    results = []
    for name, path in REPLAYS:
        print(f"Analyzing {name}...")
        results.append(analyze_replay(name, path))

    print_separator()
    print("LOSS REPLAY ANALYSIS — 4 MATCHES")
    print_separator()

    # ---- Overview Table ----
    print("\n1. OVERVIEW")
    print(f"{'Match':<35} {'Enemy':<15} {'Our Kills':<10} {'Their Kills':<12} {'Final HP':<20} {'Final Alive':<15}")
    print("-" * 107)
    for r in results:
        f = r["final"]
        hp_str = f"{f['our_hp']:>3} vs {f['enemy_hp']:>3}"
        alive_str = f"{f['our_alive']} vs {f['enemy_alive']}"
        print(f"{r['name']:<35} {r['enemy']:<15} {r['our_kills']:<10} {r['enemy_kills']:<12} {hp_str:<20} {alive_str:<15}")

    # ---- HP Timeline ----
    print("\n2. HP TIMELINE (our_hp / enemy_hp [alive_us vs alive_enemy])")
    header = f"{'Match':<35}"
    for t in KEY_TICKS:
        header += f" {'t=' + str(t):>12}"
    print(header)
    print("-" * (35 + 13 * len(KEY_TICKS)))
    for r in results:
        line = f"{r['name']:<35}"
        for t in KEY_TICKS:
            if t in r["hp_timeline"]:
                h = r["hp_timeline"][t]
                line += f" {h['our_hp']:>3}/{h['enemy_hp']:<3} {h['our_alive']}v{h['enemy_alive']}"
            else:
                line += f" {'N/A':>12}"
        print(line)

    # ---- Ammo Timeline ----
    print("\n3. AMMO TIMELINE (our_total / enemy_total)")
    header = f"{'Match':<35}"
    for t in KEY_TICKS:
        header += f" {'t=' + str(t):>8}"
    print(header)
    print("-" * (35 + 9 * len(KEY_TICKS)))
    for r in results:
        line = f"{r['name']:<35}"
        for t in KEY_TICKS:
            if t in r["ammo_timeline"]:
                a = r["ammo_timeline"][t]
                line += f" {a['our']:>3}/{a['enemy']:<3}"
            else:
                line += f" {'N/A':>8}"
        print(line)

    # ---- Damage Breakdown ----
    print("\n4. DAMAGE BREAKDOWN")
    print(f"{'Match':<35} {'CombatDealt':<12} {'CombatTaken':<12} {'OurZoneDmg':<12} {'EnemyZoneDmg':<13} {'Net Combat':<12} {'Net Zone':<10}")
    print("-" * 106)
    for r in results:
        net_combat = r["our_damage_dealt"] - r["our_damage_taken"]
        net_zone = r["enemy_zone_damage"] - r["our_zone_damage"]
        print(f"{r['name']:<35} {r['our_damage_dealt']:<12} {r['our_damage_taken']:<12} {r['our_zone_damage']:<12} {r['enemy_zone_damage']:<13} {net_combat:<12} {net_zone:<10}")

    # ---- Damage by Tick Range ----
    print("\n5. COMBAT DAMAGE TAKEN BY TICK RANGE (damage to our bots)")
    tick_ranges = [(0, 200), (200, 400), (400, 600), (600, 800), (800, 1000), (1000, 1200)]
    header = f"{'Match':<35}"
    for r_range in tick_ranges:
        header += f" {str(r_range[0])+'-'+str(r_range[1]):>10}"
    print(header)
    print("-" * (35 + 11 * len(tick_ranges)))
    for r in results:
        line = f"{r['name']:<35}"
        for rng in tick_ranges:
            line += f" {r['our_dmg_taken_by_range'][rng]:>10}"
        print(line)

    print("\n   ZONE DAMAGE TO US BY TICK RANGE")
    header = f"{'Match':<35}"
    for r_range in tick_ranges:
        header += f" {str(r_range[0])+'-'+str(r_range[1]):>10}"
    print(header)
    print("-" * (35 + 11 * len(tick_ranges)))
    for r in results:
        line = f"{r['name']:<35}"
        for rng in tick_ranges:
            line += f" {r['our_zone_dmg_by_range'][rng]:>10}"
        print(line)

    # ---- AoE & Spread ----
    print("\n6. AoE MULTI-HITS & SPREAD")
    print(f"{'Match':<35} {'AoE Multi-Hit':<15} {'Abilities Us':<13} {'Abilities Them':<15} {'OutsideZone%':<13}")
    print("-" * 91)
    for r in results:
        print(f"{r['name']:<35} {r['aoe_multi_hits_on_us']:<15} {r['our_abilities_used']:<13} {r['enemy_abilities_used']:<15} {r['our_outside_zone_pct']:<13.1f}")

    print("\n   AVERAGE PAIRWISE SPREAD (units)")
    header = f"{'Match':<35}"
    for t in SPREAD_TICKS:
        header += f" {'t=' + str(t) + ' us':>10} {'them':>8}"
    print(header)
    print("-" * (35 + 18 * len(SPREAD_TICKS)))
    for r in results:
        line = f"{r['name']:<35}"
        for t in SPREAD_TICKS:
            if t in r["spreads"]:
                s = r["spreads"][t]
                line += f" {s['our']:>10.0f} {s['enemy']:>8.0f}"
            else:
                line += f" {'N/A':>10} {'N/A':>8}"
        print(line)

    # ---- Pickups ----
    print("\n7. PICKUP COLLECTION")
    print(f"{'Match':<35} {'Our Health':<12} {'Our Ammo':<10} {'Their Health':<13} {'Their Ammo':<12} {'Total Us':<10} {'Total Them':<12}")
    print("-" * 104)
    for r in results:
        oh = r["our_pickups"].get("health", 0)
        oa = r["our_pickups"].get("ammo", 0)
        eh = r["enemy_pickups"].get("health", 0)
        ea = r["enemy_pickups"].get("ammo", 0)
        print(f"{r['name']:<35} {oh:<12} {oa:<10} {eh:<13} {ea:<12} {oh+oa:<10} {eh+ea:<12}")

    # ---- FlexCore Deep Dive ----
    print("\n" + "=" * 100)
    print("8. FLEXCORE DEEP DIVE — We dealt MORE damage (175 vs 150) but LOST")
    print("=" * 100)
    flex = results[3]
    f = flex["final"]
    print(f"   Combat dealt: {flex['our_damage_dealt']}  |  Combat taken: {flex['our_damage_taken']}")
    print(f"   Zone dmg to us: {flex['our_zone_damage']}  |  Zone dmg to them: {flex['enemy_zone_damage']}")
    print(f"   Net zone advantage: {flex['enemy_zone_damage'] - flex['our_zone_damage']} (positive = we take less)")
    print(f"   Our pickups: health={flex['our_pickups'].get('health',0)}, ammo={flex['our_pickups'].get('ammo',0)}")
    print(f"   Their pickups: health={flex['enemy_pickups'].get('health',0)}, ammo={flex['enemy_pickups'].get('ammo',0)}")
    print(f"   Outside zone %: {flex['our_outside_zone_pct']:.1f}%")
    print(f"   Final: {f['our_alive']} alive ({f['our_hp']} HP) vs {f['enemy_alive']} alive ({f['enemy_hp']} HP)")
    print(f"   AoE multi-hits on us: {flex['aoe_multi_hits_on_us']}")

    total_dmg_to_us = flex['our_damage_taken'] + flex['our_zone_damage']
    total_dmg_to_them = flex['our_damage_dealt'] + flex['enemy_zone_damage']
    pickup_hp_us = flex['our_pickups'].get('health', 0) * 10
    pickup_hp_them = flex['enemy_pickups'].get('health', 0) * 10
    print(f"\n   TOTAL effective damage to us: {total_dmg_to_us} combat + zone (healed {pickup_hp_us} from pickups)")
    print(f"   TOTAL effective damage to them: {total_dmg_to_them} combat + zone (healed {pickup_hp_them} from pickups)")
    print(f"   Net HP equation: 500 - {total_dmg_to_us} + {pickup_hp_us} = {500 - total_dmg_to_us + pickup_hp_us} (us)")
    print(f"   Net HP equation: 500 - {total_dmg_to_them} + {pickup_hp_them} = {500 - total_dmg_to_them + pickup_hp_them} (them)")

    # ---- Cross-Match Patterns ----
    print("\n" + "=" * 100)
    print("9. CROSS-MATCH PATTERNS")
    print("=" * 100)

    avg_zone_dmg_us = sum(r["our_zone_damage"] for r in results) / len(results)
    avg_zone_dmg_them = sum(r["enemy_zone_damage"] for r in results) / len(results)
    avg_pickups_us = sum(r["our_pickups"].get("health", 0) + r["our_pickups"].get("ammo", 0) for r in results) / len(results)
    avg_pickups_them = sum(r["enemy_pickups"].get("health", 0) + r["enemy_pickups"].get("ammo", 0) for r in results) / len(results)
    avg_outside = sum(r["our_outside_zone_pct"] for r in results) / len(results)
    avg_aoe_multi = sum(r["aoe_multi_hits_on_us"] for r in results) / len(results)

    print(f"\n   Avg zone damage:  Us={avg_zone_dmg_us:.0f}  Them={avg_zone_dmg_them:.0f}  (diff={avg_zone_dmg_them - avg_zone_dmg_us:.0f})")
    print(f"   Avg pickups:      Us={avg_pickups_us:.1f}  Them={avg_pickups_them:.1f}")
    print(f"   Avg outside zone: {avg_outside:.1f}%")
    print(f"   Avg AoE multi-hits on us: {avg_aoe_multi:.1f}")

    # When do we fall behind?
    print("\n   TICK WHERE WE FALL BEHIND (enemy HP > our HP):")
    for r in results:
        fell_behind = None
        for t in sorted(r["hp_timeline"].keys()):
            h = r["hp_timeline"][t]
            if h["enemy_hp"] > h["our_hp"] and fell_behind is None:
                fell_behind = t
        if fell_behind is not None:
            print(f"   {r['name']:<35} fell behind at tick {fell_behind}")
        else:
            print(f"   {r['name']:<35} never ahead (or always behind)")

    # Summary
    print("\n   KEY FINDINGS:")
    zone_issue = avg_zone_dmg_us > avg_zone_dmg_them * 1.2
    pickup_issue = avg_pickups_them > avg_pickups_us * 1.3
    aoe_issue = avg_aoe_multi > 1.5

    if zone_issue:
        print(f"   [ZONE] We take {avg_zone_dmg_us:.0f} zone dmg vs their {avg_zone_dmg_them:.0f} — we're spending more time outside zone!")
    else:
        print(f"   [ZONE] Zone damage roughly equal (us={avg_zone_dmg_us:.0f} them={avg_zone_dmg_them:.0f})")

    if pickup_issue:
        print(f"   [PICKUPS] Enemy out-farms us {avg_pickups_them:.1f} to {avg_pickups_us:.1f} — they're collecting more powerups!")
    else:
        print(f"   [PICKUPS] Pickup collection roughly equal (us={avg_pickups_us:.1f} them={avg_pickups_them:.1f})")

    if aoe_issue:
        print(f"   [AOE] We get multi-hit by AoE {avg_aoe_multi:.1f}x per match — too bunched up!")
    else:
        print(f"   [AOE] AoE multi-hits manageable ({avg_aoe_multi:.1f} per match)")

    # Detailed pickup timing
    print("\n10. PICKUP TIMING (when are pickups collected)")
    for r in results:
        our_times = [e["tick"] for e in r["pickup_events"] if e["team"] == "us"]
        enemy_times = [e["tick"] for e in r["pickup_events"] if e["team"] == "enemy"]
        print(f"\n   {r['name']}:")
        if our_times:
            print(f"     Our pickups at ticks: {', '.join(str(t) for t in our_times)}")
        else:
            print(f"     Our pickups: NONE")
        if enemy_times:
            print(f"     Enemy pickups at ticks: {', '.join(str(t) for t in enemy_times)}")
        else:
            print(f"     Enemy pickups: NONE")


if __name__ == "__main__":
    main()
