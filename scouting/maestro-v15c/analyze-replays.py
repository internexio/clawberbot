#!/usr/bin/env python3
"""
Comprehensive replay analysis for Maestro-Thunder losses (v15c).
Focuses on AoE vulnerability from tighter packing.
"""

import json
import math
import sys
from collections import defaultdict

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
ABILITY_BLAST_RADIUS = 150
ABILITY_CAST_RANGE = 500
MELEE_RANGE = 200
MELEE_DMG = 10
ABILITY_DMG = 15

REPLAY_FILES = [
    "L-028cb762-4K510-vs-5K530.json",
    "L-6b5dd1bd-3K395-vs-4K400.json",
    "L-8aa3d24f-1K320-vs-5K520.json",
]

def dist(p1, p2):
    return math.sqrt((p1["x"] - p2["x"])**2 + (p1["y"] - p2["y"])**2)

def team_spread(positions):
    """Average pairwise distance between alive bots."""
    if len(positions) < 2:
        return 0
    total = 0
    count = 0
    for i in range(len(positions)):
        for j in range(i+1, len(positions)):
            total += dist(positions[i], positions[j])
            count += 1
    return total / count if count > 0 else 0

def max_spread(positions):
    """Max pairwise distance."""
    if len(positions) < 2:
        return 0
    mx = 0
    for i in range(len(positions)):
        for j in range(i+1, len(positions)):
            d = dist(positions[i], positions[j])
            if d > mx:
                mx = d
    return mx

def min_spread(positions):
    """Min pairwise distance (closest two bots)."""
    if len(positions) < 2:
        return 0
    mn = float('inf')
    for i in range(len(positions)):
        for j in range(i+1, len(positions)):
            d = dist(positions[i], positions[j])
            if d < mn:
                mn = d
    return mn

def centroid(positions):
    if not positions:
        return {"x": 0, "y": 0}
    return {
        "x": sum(p["x"] for p in positions) / len(positions),
        "y": sum(p["y"] for p in positions) / len(positions)
    }

def analyze_replay(filepath):
    with open(filepath) as f:
        data = json.load(f)

    match_id = data["matchId"]
    map_id = data["mapId"]
    total_ticks = len(data["frames"])
    winner = data["winner"]

    # Identify our bots vs enemy bots
    our_bot_ids = set()
    enemy_bot_ids = set()
    our_prefix = None
    enemy_prefix = None

    for bot in data["bots"]:
        if bot["agentId"] == OUR_AGENT:
            our_bot_ids.add(bot["id"])
            our_prefix = bot["id"].split(":")[0]
        else:
            enemy_bot_ids.add(bot["id"])
            enemy_prefix = bot["id"].split(":")[0]

    we_won = our_prefix in winner if winner else False

    # =====================
    # PASS 1: Extract all events and frame data
    # =====================

    # Per-bot ability counts
    our_ability_count = defaultdict(int)
    enemy_ability_count = defaultdict(int)

    # Ability events with positions
    our_abilities = []  # (tick, botId, targetPos)
    enemy_abilities = []

    # Damage events
    damage_events = []  # (tick, attackerId, targetId, damage)

    # Kill events
    kill_events = []  # (tick, killerId, victimId)

    for frame in data["frames"]:
        tick = frame["tick"]
        for e in frame.get("events", []):
            if e["type"] == "ability":
                bot_id = e["botId"]
                target_pos = e.get("targetPosition")
                if bot_id in our_bot_ids:
                    our_ability_count[bot_id] += 1
                    our_abilities.append((tick, bot_id, target_pos))
                elif bot_id in enemy_bot_ids:
                    enemy_ability_count[bot_id] += 1
                    enemy_abilities.append((tick, bot_id, target_pos))
            elif e["type"] == "damage":
                damage_events.append((tick, e["attackerId"], e["targetId"], e["damage"]))
            elif e["type"] == "kill":
                kill_events.append((tick, e.get("killerId"), e["victimId"]))

    # =====================
    # PASS 2: Build bot state per tick
    # =====================

    # Build position/health lookup: tick -> botId -> {pos, health, alive}
    bot_states = {}
    for frame in data["frames"]:
        tick = frame["tick"]
        state = {}
        for b in frame["bots"]:
            state[b["id"]] = {
                "pos": b["position"],
                "health": b["health"],
                "alive": b["alive"]
            }
        bot_states[tick] = state

    # =====================
    # ANALYSIS: Multi-hit abilities
    # =====================

    # For each enemy ability, check how many of our bots were within blast radius
    multi_hit_abilities = []  # (tick, botId, targetPos, hit_count, our_bots_hit, our_spread_at_tick)
    total_enemy_aoe_hits_on_us = 0  # sum of bots hit across all enemy abilities

    for tick, bot_id, target_pos in enemy_abilities:
        if target_pos is None:
            continue
        if tick not in bot_states:
            continue

        state = bot_states[tick]
        our_alive_positions = []
        bots_in_blast = []

        for our_id in our_bot_ids:
            if our_id in state and state[our_id]["alive"]:
                our_pos = state[our_id]["pos"]
                our_alive_positions.append(our_pos)
                d = dist(our_pos, target_pos)
                if d <= ABILITY_BLAST_RADIUS:
                    bots_in_blast.append((our_id, d))

        hit_count = len(bots_in_blast)
        total_enemy_aoe_hits_on_us += hit_count
        spread = team_spread(our_alive_positions) if len(our_alive_positions) >= 2 else 0

        multi_hit_abilities.append((tick, bot_id, target_pos, hit_count, bots_in_blast, spread))

    # Count multi-hits
    multi_hit_2plus = [(t, b, tp, hc, bh, sp) for t, b, tp, hc, bh, sp in multi_hit_abilities if hc >= 2]
    multi_hit_3plus = [(t, b, tp, hc, bh, sp) for t, b, tp, hc, bh, sp in multi_hit_abilities if hc >= 3]

    # Also check our abilities hitting them
    our_multi_hit_abilities = []
    for tick, bot_id, target_pos in our_abilities:
        if target_pos is None:
            continue
        if tick not in bot_states:
            continue
        state = bot_states[tick]
        bots_in_blast = []
        for enemy_id in enemy_bot_ids:
            if enemy_id in state and state[enemy_id]["alive"]:
                d = dist(state[enemy_id]["pos"], target_pos)
                if d <= ABILITY_BLAST_RADIUS:
                    bots_in_blast.append((enemy_id, d))
        our_multi_hit_abilities.append((tick, bot_id, target_pos, len(bots_in_blast), bots_in_blast))

    our_2plus = [x for x in our_multi_hit_abilities if x[3] >= 2]

    # =====================
    # ANALYSIS: Team spread timeline (every 20 ticks)
    # =====================

    timeline = []
    all_ticks = sorted(bot_states.keys())

    for tick in all_ticks:
        if tick % 20 != 0 and tick != all_ticks[-1]:
            continue

        state = bot_states[tick]

        our_alive = []
        our_hp = 0
        our_positions = []
        enemy_alive = []
        enemy_hp = 0
        enemy_positions = []

        for bid, bs in state.items():
            if bid in our_bot_ids:
                if bs["alive"]:
                    our_alive.append(bid)
                    our_hp += bs["health"]
                    our_positions.append(bs["pos"])
            else:
                if bs["alive"]:
                    enemy_alive.append(bid)
                    enemy_hp += bs["health"]
                    enemy_positions.append(bs["pos"])

        our_spread = team_spread(our_positions)
        enemy_spread = team_spread(enemy_positions)
        our_min = min_spread(our_positions)
        enemy_min = min_spread(enemy_positions)

        zone = state  # zone info is in frame
        # Get zone from frame
        zone_info = None
        for frame in data["frames"]:
            if frame["tick"] == tick:
                zone_info = frame.get("zone")
                break

        timeline.append({
            "tick": tick,
            "our_alive": len(our_alive),
            "our_hp": our_hp,
            "our_spread": round(our_spread, 1),
            "our_min_spread": round(our_min, 1),
            "enemy_alive": len(enemy_alive),
            "enemy_hp": enemy_hp,
            "enemy_spread": round(enemy_spread, 1),
            "enemy_min_spread": round(enemy_min, 1),
            "zone_radius": round(zone_info["radius"], 1) if zone_info else 0,
        })

    # =====================
    # ANALYSIS: Kill cascade
    # =====================

    our_deaths = [(t, k, v) for t, k, v in kill_events if v in our_bot_ids]
    enemy_deaths = [(t, k, v) for t, k, v in kill_events if v in enemy_bot_ids]

    # Check for cascades (deaths within 5 ticks of each other)
    our_cascades = []
    for i in range(len(our_deaths)):
        cascade = [our_deaths[i]]
        for j in range(i+1, len(our_deaths)):
            if our_deaths[j][0] - our_deaths[i][0] <= 15:  # within 15 ticks
                cascade.append(our_deaths[j])
        if len(cascade) >= 2:
            our_cascades.append(cascade)

    # =====================
    # ANALYSIS: Damage breakdown
    # =====================

    our_dmg_taken_melee = 0
    our_dmg_taken_ability = 0
    our_dmg_dealt_melee = 0
    our_dmg_dealt_ability = 0

    for tick, attacker, target, dmg in damage_events:
        if target in our_bot_ids and attacker in enemy_bot_ids:
            if dmg == ABILITY_DMG:
                our_dmg_taken_ability += dmg
            else:
                our_dmg_taken_melee += dmg
        elif target in enemy_bot_ids and attacker in our_bot_ids:
            if dmg == ABILITY_DMG:
                our_dmg_dealt_ability += dmg
            else:
                our_dmg_dealt_melee += dmg

    # Zone damage
    our_zone_dmg = 0
    enemy_zone_dmg = 0
    for tick, attacker, target, dmg in damage_events:
        if attacker == "zone":
            if target in our_bot_ids:
                our_zone_dmg += dmg
            elif target in enemy_bot_ids:
                enemy_zone_dmg += dmg

    # =====================
    # ANALYSIS: Spacing when hit by enemy AoE
    # =====================

    # For each enemy ability that hit us, record our nearest neighbor distances
    spacing_when_aoe_hit = []
    for tick, bot_id, target_pos, hit_count, bots_hit, spread in multi_hit_abilities:
        if hit_count >= 1:
            state = bot_states[tick]
            our_alive_pos = []
            for our_id in our_bot_ids:
                if our_id in state and state[our_id]["alive"]:
                    our_alive_pos.append(state[our_id]["pos"])

            # Nearest neighbor for each bot hit
            for hit_id, hit_dist in bots_hit:
                hit_pos = state[hit_id]["pos"]
                nn_dist = float('inf')
                for our_id in our_bot_ids:
                    if our_id != hit_id and our_id in state and state[our_id]["alive"]:
                        d = dist(hit_pos, state[our_id]["pos"])
                        if d < nn_dist:
                            nn_dist = d
                spacing_when_aoe_hit.append({
                    "tick": tick,
                    "bot": hit_id.split(":")[-1],
                    "nn_dist": round(nn_dist, 1),
                    "team_spread": round(spread, 1),
                    "multi_hit": hit_count >= 2
                })

    # =====================
    # OUTPUT
    # =====================

    print("=" * 80)
    print(f"REPLAY: {filepath.split('/')[-1]}")
    print("=" * 80)

    print(f"\n--- MATCH METADATA ---")
    print(f"Match ID:    {match_id}")
    print(f"Map:         {map_id}")
    print(f"Total ticks: {total_ticks}")
    print(f"Winner:      {'US' if we_won else 'THEM (Maestro-Thunder)'}")
    print(f"Our prefix:  {our_prefix}")
    print(f"Enemy prefix:{enemy_prefix}")

    # Final score
    last_state = bot_states[all_ticks[-1]]
    our_final_alive = sum(1 for bid in our_bot_ids if last_state[bid]["alive"])
    our_final_hp = sum(last_state[bid]["health"] for bid in our_bot_ids if last_state[bid]["alive"])
    enemy_final_alive = sum(1 for bid in enemy_bot_ids if last_state[bid]["alive"])
    enemy_final_hp = sum(last_state[bid]["health"] for bid in enemy_bot_ids if last_state[bid]["alive"])
    print(f"Final:       {our_final_alive} alive ({our_final_hp}HP) vs {enemy_final_alive} alive ({enemy_final_hp}HP)")

    our_total_dmg = our_dmg_dealt_melee + our_dmg_dealt_ability
    enemy_total_dmg = our_dmg_taken_melee + our_dmg_taken_ability
    print(f"Damage:      We dealt {our_total_dmg} (melee:{our_dmg_dealt_melee}, ability:{our_dmg_dealt_ability})")
    print(f"             We took  {enemy_total_dmg} (melee:{our_dmg_taken_melee}, ability:{our_dmg_taken_ability})")
    print(f"Zone damage: Us:{our_zone_dmg}, Them:{enemy_zone_dmg}")

    print(f"\n--- ABILITY ANALYSIS ---")
    print(f"Total abilities:     Us: {sum(our_ability_count.values())}, Them: {sum(enemy_ability_count.values())}")
    print(f"Per-bot (us):        {dict((k.split(':')[-1], v) for k,v in sorted(our_ability_count.items()))}")
    print(f"Per-bot (them):      {dict((k.split(':')[-1], v) for k,v in sorted(enemy_ability_count.items()))}")
    print(f"Enemy AoE hitting 1+ of ours: {sum(1 for x in multi_hit_abilities if x[3] >= 1)}/{len(enemy_abilities)}")
    print(f"Enemy AoE hitting 2+ of ours: {len(multi_hit_2plus)}/{len(enemy_abilities)}")
    print(f"Enemy AoE hitting 3+ of ours: {len(multi_hit_3plus)}/{len(enemy_abilities)}")
    print(f"Total bot-hits from enemy AoE: {total_enemy_aoe_hits_on_us}")
    print(f"Our AoE hitting 2+ of theirs:  {len(our_2plus)}/{len(our_abilities)}")

    if multi_hit_2plus:
        print(f"\n  Multi-hit details (2+ of our bots hit):")
        for tick, bot_id, target_pos, hit_count, bots_hit, spread in multi_hit_2plus:
            bots_str = ", ".join(f"#{bid.split(':')[-1]}({d:.0f}u)" for bid, d in bots_hit)
            print(f"    Tick {tick:4d}: {hit_count} bots hit [{bots_str}] | Our spread: {spread:.0f}u")

    print(f"\n--- TIMELINE (every 20 ticks) ---")
    print(f"{'Tick':>5} | {'Us':>12} | {'OurSprd':>7} {'OurMin':>6} | {'Them':>12} | {'TheirSprd':>9} {'TheirMin':>8} | {'Zone':>5}")
    print("-" * 85)
    for t in timeline:
        us_str = f"{t['our_alive']}a/{t['our_hp']}HP"
        them_str = f"{t['enemy_alive']}a/{t['enemy_hp']}HP"
        print(f"{t['tick']:5d} | {us_str:>12} | {t['our_spread']:7.0f} {t['our_min_spread']:6.0f} | {them_str:>12} | {t['enemy_spread']:9.0f} {t['enemy_min_spread']:8.0f} | {t['zone_radius']:5.0f}")

    print(f"\n--- KILL EVENTS ---")
    for tick, killer, victim in kill_events:
        side = "OUR" if victim in our_bot_ids else "ENEMY"
        victim_num = victim.split(":")[-1]
        if killer is None:
            killer_str = "zone/unknown"
        elif ":" in killer:
            killer_num = killer.split(":")[-1]
            killer_team = "us" if killer in our_bot_ids else "them"
            killer_str = f"{killer_team} #{killer_num}"
        else:
            killer_str = str(killer)
        print(f"  Tick {tick:4d}: {side} #{victim_num} killed by {killer_str}")

    print(f"\n--- KILL CASCADE ANALYSIS ---")
    if our_cascades:
        for cascade in our_cascades:
            ticks = [c[0] for c in cascade]
            span = max(ticks) - min(ticks)
            print(f"  CASCADE: {len(cascade)} of our bots died within {span} ticks (ticks {min(ticks)}-{max(ticks)})")
            for t, k, v in cascade:
                print(f"    Tick {t}: #{v.split(':')[-1]} killed")
    else:
        print("  No cascades detected (no 2+ deaths within 15 ticks)")

    print(f"\n--- AOE VULNERABILITY: OUR SPACING WHEN HIT ---")
    if spacing_when_aoe_hit:
        nn_dists = [s["nn_dist"] for s in spacing_when_aoe_hit if s["nn_dist"] < float('inf')]
        multi_hit_nn = [s["nn_dist"] for s in spacing_when_aoe_hit if s["multi_hit"] and s["nn_dist"] < float('inf')]
        print(f"  Times hit by enemy AoE: {len(spacing_when_aoe_hit)}")
        if nn_dists:
            print(f"  Avg nearest-neighbor when hit: {sum(nn_dists)/len(nn_dists):.0f}u")
            print(f"  Min nearest-neighbor when hit: {min(nn_dists):.0f}u")
            under_150 = sum(1 for d in nn_dists if d < 150)
            under_200 = sum(1 for d in nn_dists if d < 200)
            under_300 = sum(1 for d in nn_dists if d < 300)
            print(f"  Hits where NN < 150u (blast radius): {under_150}/{len(nn_dists)} ({100*under_150/len(nn_dists):.0f}%)")
            print(f"  Hits where NN < 200u (melee range):  {under_200}/{len(nn_dists)} ({100*under_200/len(nn_dists):.0f}%)")
            print(f"  Hits where NN < 300u (2x blast):     {under_300}/{len(nn_dists)} ({100*under_300/len(nn_dists):.0f}%)")
        if multi_hit_nn:
            print(f"  Avg NN on multi-hit AoE: {sum(multi_hit_nn)/len(multi_hit_nn):.0f}u")
    else:
        print("  No AoE hits on us")

    print(f"\n--- OUR TEAM SPREAD AT KEY MOMENTS ---")
    # Find spread at first contact, first kill, mid-game, endgame
    first_damage_tick = None
    for tick, attacker, target, dmg in damage_events:
        if (attacker in our_bot_ids and target in enemy_bot_ids) or (attacker in enemy_bot_ids and target in our_bot_ids):
            first_damage_tick = tick
            break

    key_ticks = []
    if first_damage_tick:
        key_ticks.append(("First contact", first_damage_tick))
    if our_deaths:
        key_ticks.append(("Our first death", our_deaths[0][0]))
    if enemy_deaths:
        key_ticks.append(("Their first death", enemy_deaths[0][0]))
    key_ticks.append(("Mid-game", total_ticks // 2))

    for label, tick in key_ticks:
        if tick in bot_states:
            state = bot_states[tick]
            our_pos = [state[bid]["pos"] for bid in our_bot_ids if state[bid]["alive"]]
            enemy_pos = [state[bid]["pos"] for bid in enemy_bot_ids if state[bid]["alive"]]
            print(f"  {label} (tick {tick}):")
            print(f"    Our spread:   avg={team_spread(our_pos):.0f}u, min={min_spread(our_pos):.0f}u, max={max_spread(our_pos):.0f}u ({len(our_pos)} alive)")
            print(f"    Their spread: avg={team_spread(enemy_pos):.0f}u, min={min_spread(enemy_pos):.0f}u, max={max_spread(enemy_pos):.0f}u ({len(enemy_pos)} alive)")

    print()

    return {
        "file": filepath.split("/")[-1],
        "map": map_id,
        "ticks": total_ticks,
        "our_abilities": sum(our_ability_count.values()),
        "their_abilities": sum(enemy_ability_count.values()),
        "multi_hit_2plus": len(multi_hit_2plus),
        "multi_hit_3plus": len(multi_hit_3plus),
        "total_aoe_bot_hits": total_enemy_aoe_hits_on_us,
        "our_dmg_dealt": our_total_dmg,
        "our_dmg_taken": enemy_total_dmg,
        "our_ability_dmg_taken": our_dmg_taken_ability,
        "our_melee_dmg_taken": our_dmg_taken_melee,
        "our_deaths": len(our_deaths),
        "enemy_deaths": len(enemy_deaths),
        "our_death_ticks": [t for t, k, v in our_deaths],
        "enemy_death_ticks": [t for t, k, v in enemy_deaths],
        "cascades": len(our_cascades),
        "timeline": timeline,
        "spacing_when_hit": spacing_when_aoe_hit,
    }


def cross_match_summary(results):
    print("\n" + "=" * 80)
    print("CROSS-MATCH SUMMARY")
    print("=" * 80)

    print(f"\n--- MATCH OVERVIEW ---")
    print(f"{'File':<45} {'Map':<15} {'Ticks':>5} {'Score':>10} {'Dmg':>12}")
    for r in results:
        score = f"{r['our_deaths']}D-{r['enemy_deaths']}K"
        dmg = f"{r['our_dmg_dealt']}vs{r['our_dmg_taken']}"
        print(f"  {r['file']:<43} {r['map']:<15} {r['ticks']:>5} {score:>10} {dmg:>12}")

    print(f"\n--- ABILITY COMPARISON ---")
    our_total = sum(r["our_abilities"] for r in results)
    their_total = sum(r["their_abilities"] for r in results)
    print(f"  Total abilities: Us {our_total}, Them {their_total} (they fire {their_total-our_total:+d})")

    total_multi2 = sum(r["multi_hit_2plus"] for r in results)
    total_multi3 = sum(r["multi_hit_3plus"] for r in results)
    total_aoe_hits = sum(r["total_aoe_bot_hits"] for r in results)
    print(f"  Their AoE hitting 2+ of ours: {total_multi2} times across all matches")
    print(f"  Their AoE hitting 3+ of ours: {total_multi3} times across all matches")
    print(f"  Total bot-hits from their AoE: {total_aoe_hits} (avg {total_aoe_hits/their_total:.1f} bots/ability)")

    # AoE damage fraction
    total_ability_dmg = sum(r["our_ability_dmg_taken"] for r in results)
    total_melee_dmg = sum(r["our_melee_dmg_taken"] for r in results)
    total_taken = total_ability_dmg + total_melee_dmg
    print(f"\n--- DAMAGE BREAKDOWN (taken) ---")
    print(f"  Total damage taken: {total_taken}")
    print(f"  From abilities:     {total_ability_dmg} ({100*total_ability_dmg/total_taken:.0f}%)")
    print(f"  From melee:         {total_melee_dmg} ({100*total_melee_dmg/total_taken:.0f}%)")

    print(f"\n--- KILL CASCADE PATTERNS ---")
    for r in results:
        death_ticks = r["our_death_ticks"]
        if len(death_ticks) >= 2:
            gaps = [death_ticks[i+1] - death_ticks[i] for i in range(len(death_ticks)-1)]
            print(f"  {r['file'][:40]}: Deaths at ticks {death_ticks}, gaps: {gaps}")

    # Spacing analysis
    all_spacing = []
    for r in results:
        all_spacing.extend(r["spacing_when_hit"])

    nn_dists = [s["nn_dist"] for s in all_spacing if s["nn_dist"] < float('inf')]

    print(f"\n--- SPACING WHEN HIT BY AOE (all matches) ---")
    if nn_dists:
        print(f"  Total AoE hits on us: {len(nn_dists)}")
        print(f"  Avg nearest-neighbor: {sum(nn_dists)/len(nn_dists):.0f}u")
        print(f"  Median NN: {sorted(nn_dists)[len(nn_dists)//2]:.0f}u")
        under_100 = sum(1 for d in nn_dists if d < 100)
        under_150 = sum(1 for d in nn_dists if d < 150)
        under_200 = sum(1 for d in nn_dists if d < 200)
        under_300 = sum(1 for d in nn_dists if d < 300)
        print(f"  NN < 100u (SOFT_SPREAD): {under_100}/{len(nn_dists)} ({100*under_100/len(nn_dists):.0f}%)")
        print(f"  NN < 150u (blast radius): {under_150}/{len(nn_dists)} ({100*under_150/len(nn_dists):.0f}%)")
        print(f"  NN < 200u (melee range): {under_200}/{len(nn_dists)} ({100*under_200/len(nn_dists):.0f}%)")
        print(f"  NN < 300u: {under_300}/{len(nn_dists)} ({100*under_300/len(nn_dists):.0f}%)")

    # Spread comparison
    print(f"\n--- TEAM SPREAD COMPARISON AT ENGAGEMENT ---")
    for r in results:
        # Find first tick where both teams have alive bots close enough
        for t in r["timeline"]:
            if t["tick"] >= 20 and t["tick"] <= 60:
                print(f"  {r['file'][:30]} tick {t['tick']:3d}: Our spread {t['our_spread']:4.0f}u (min {t['our_min_spread']:4.0f}u) vs Their {t['enemy_spread']:4.0f}u (min {t['enemy_min_spread']:4.0f}u)")

    # Verdict
    print(f"\n--- VERDICT: IS TIGHTER PACKING THE ROOT CAUSE? ---")
    if total_multi2 > 0:
        effective_aoe_dmg = total_multi2 * ABILITY_DMG  # extra damage from multi-hits
        print(f"  Multi-hit AoE extra damage: ~{effective_aoe_dmg} HP (from {total_multi2} double+ hits)")

    avg_our_spread_at_engagement = []
    avg_their_spread_at_engagement = []
    for r in results:
        for t in r["timeline"]:
            if 20 <= t["tick"] <= 80 and t["our_alive"] >= 3:
                avg_our_spread_at_engagement.append(t["our_spread"])
                avg_their_spread_at_engagement.append(t["enemy_spread"])

    if avg_our_spread_at_engagement:
        our_avg = sum(avg_our_spread_at_engagement) / len(avg_our_spread_at_engagement)
        their_avg = sum(avg_their_spread_at_engagement) / len(avg_their_spread_at_engagement)
        print(f"  Our avg spread (ticks 20-80): {our_avg:.0f}u")
        print(f"  Their avg spread (ticks 20-80): {their_avg:.0f}u")
        print(f"  Spread gap: {their_avg - our_avg:.0f}u (they are {'wider' if their_avg > our_avg else 'tighter'})")

    under_blast = sum(1 for d in nn_dists if d < 150) if nn_dists else 0
    total_hits = len(nn_dists) if nn_dists else 1
    print(f"\n  CONCLUSION:")
    print(f"  - {under_blast}/{total_hits} ({100*under_blast/total_hits:.0f}%) of our bots hit by AoE had a neighbor within blast radius (150u)")
    print(f"  - {total_multi2} enemy abilities hit 2+ of our bots simultaneously")
    if total_multi2 >= 5:
        print(f"  - HIGH AoE VULNERABILITY: Tighter packing IS contributing to losses")
        print(f"  - Recommendation: Increase HARD_SPREAD/SOFT_SPREAD or add AoE-aware spacing")
    elif total_multi2 >= 2:
        print(f"  - MODERATE AoE VULNERABILITY: Packing is a factor but not sole cause")
    else:
        print(f"  - LOW AoE VULNERABILITY: Packing is NOT the primary issue, look elsewhere")


if __name__ == "__main__":
    import os
    base_dir = os.path.dirname(os.path.abspath(__file__))

    results = []
    for f in REPLAY_FILES:
        filepath = os.path.join(base_dir, f)
        r = analyze_replay(filepath)
        results.append(r)

    cross_match_summary(results)
