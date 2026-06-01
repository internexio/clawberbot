#!/usr/bin/env python3
"""
Deep dive on replay 2 stalemate and cross-match packing dynamics.
"""

import json
import math

OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'

def dist(p1, p2):
    return math.sqrt((p1['x'] - p2['x'])**2 + (p1['y'] - p2['y'])**2)

# =====================================
# REPLAY 2: STALEMATE ANALYSIS
# =====================================
print("=" * 80)
print("REPLAY 2 STALEMATE DEEP DIVE")
print("=" * 80)

with open('scouting/maestro-v15c/L-6b5dd1bd-3K395-vs-4K400.json') as f:
    data = json.load(f)

our_ids = set()
enemy_ids = set()
for b in data['bots']:
    if b['agentId'] == OUR_AGENT:
        our_ids.add(b['id'])
    else:
        enemy_ids.add(b['id'])

our_sorted = sorted(our_ids)
enemy_sorted = sorted(enemy_ids)

# After tick 133 (our #0 dies), we have 3 bots (HP 5, 100, 10) vs 2 enemies (HP 70, 70)
# This stalemate lasts until zone kills at tick 644+

print("\nState after tick 133 (stalemate begins):")
print("  Our bots alive: #2 (5HP), #3 (100HP), #4 (10HP)")
print("  Their bots alive: #0 (70HP), #3 (70HP)")
print("  Total: 115 HP vs 140 HP")

# Track positions and inter-team distance during stalemate
print("\nPositions during stalemate (every 50 ticks):")
print(f"{'Tick':>5} | {'Our #2':>15} | {'Our #3':>15} | {'Our #4':>15} | {'Them #0':>15} | {'Them #3':>15} | {'Min inter':>9} | {'Zone':>5}")

for frame in data['frames']:
    tick = frame['tick']
    if tick < 130 or (tick % 50 != 0 and tick not in [133, 644, 717]):
        continue

    state = {b['id']: b for b in frame['bots']}
    zone = frame.get('zone', {})

    our_alive = [(bid, state[bid]) for bid in our_sorted if state[bid]['alive']]
    enemy_alive = [(bid, state[bid]) for bid in enemy_sorted if state[bid]['alive']]

    # Find min inter-team distance
    min_inter = float('inf')
    for _, ob in our_alive:
        for _, eb in enemy_alive:
            d = dist(ob['position'], eb['position'])
            if d < min_inter:
                min_inter = d

    # Print positions
    our_strs = []
    for bid, bs in [(bid, state[bid]) for bid in our_sorted]:
        if bs['alive']:
            our_strs.append(f"({bs['position']['x']:.0f},{bs['position']['y']:.0f})")
        else:
            our_strs.append("DEAD")

    enemy_strs = []
    for bid in enemy_sorted:
        bs = state[bid]
        if bs['alive']:
            enemy_strs.append(f"({bs['position']['x']:.0f},{bs['position']['y']:.0f})")
        else:
            enemy_strs.append("DEAD")

    zone_r = zone.get('radius', 0)
    zone_cx = zone.get('centerX', zone.get('center', {}).get('x', 0))
    zone_cy = zone.get('centerY', zone.get('center', {}).get('y', 0))

    inter_str = f"{min_inter:.0f}" if min_inter < float('inf') else "N/A"
    # Just print alive/HP summary
    our_alive_str = ", ".join(f"#{bid.split(':')[-1]}={state[bid]['health']}HP" for bid in our_sorted if state[bid]['alive'])
    enemy_alive_str = ", ".join(f"#{bid.split(':')[-1]}={state[bid]['health']}HP" for bid in enemy_sorted if state[bid]['alive'])

    print(f"  {tick:5d} | {our_alive_str:>30} | {enemy_alive_str:>30} | inter={inter_str:>5} | zone={zone_r:.0f}")

# Why are our 3 bots not engaging their 2?
# Check if it's a distance/kiting issue
print("\nDistance to zone center for each bot (stalemate period):")
for frame in data['frames']:
    tick = frame['tick']
    if tick < 130 or tick % 100 != 0:
        continue

    state = {b['id']: b for b in frame['bots']}
    zone = frame.get('zone', {})
    zone_cx = zone.get('centerX', zone.get('center', {}).get('x', 0))
    zone_cy = zone.get('centerY', zone.get('center', {}).get('y', 0))
    zone_r = zone.get('radius', 0)
    zone_center = {'x': zone_cx, 'y': zone_cy}

    for bid in our_sorted:
        bs = state[bid]
        if bs['alive']:
            d = dist(bs['position'], zone_center)
            inside = "IN" if d <= zone_r else f"OUT by {d - zone_r:.0f}"
            print(f"  tick {tick}: our #{bid.split(':')[-1]} dist to zone center: {d:.0f}u ({inside}), zone_r={zone_r:.0f}")

    for bid in enemy_sorted:
        bs = state[bid]
        if bs['alive']:
            d = dist(bs['position'], zone_center)
            inside = "IN" if d <= zone_r else f"OUT by {d - zone_r:.0f}"
            print(f"  tick {tick}: them #{bid.split(':')[-1]} dist to zone center: {d:.0f}u ({inside}), zone_r={zone_r:.0f}")

# =====================================
# ALL 3 REPLAYS: ABILITY TIMING ANALYSIS
# =====================================
print("\n" + "=" * 80)
print("ABILITY TIMING AND EFFICIENCY")
print("=" * 80)

files = [
    ('R1', 'scouting/maestro-v15c/L-028cb762-4K510-vs-5K530.json'),
    ('R2', 'scouting/maestro-v15c/L-6b5dd1bd-3K395-vs-4K400.json'),
    ('R3', 'scouting/maestro-v15c/L-8aa3d24f-1K320-vs-5K520.json'),
]

for label, filepath in files:
    with open(filepath) as f:
        data = json.load(f)

    our_ids_l = set()
    enemy_ids_l = set()
    for b in data['bots']:
        if b['agentId'] == OUR_AGENT:
            our_ids_l.add(b['id'])
        else:
            enemy_ids_l.add(b['id'])

    # Track ability fire ticks for each enemy bot
    enemy_ability_ticks = {}
    for frame in data['frames']:
        for e in frame.get('events', []):
            if e['type'] == 'ability' and e['botId'] in enemy_ids_l:
                bid = e['botId'].split(':')[-1]
                if bid not in enemy_ability_ticks:
                    enemy_ability_ticks[bid] = []
                enemy_ability_ticks[bid].append(frame['tick'])

    print(f"\n{label}: Enemy ability timing:")
    for bid in sorted(enemy_ability_ticks.keys()):
        ticks = enemy_ability_ticks[bid]
        gaps = [ticks[i+1] - ticks[i] for i in range(len(ticks)-1)]
        min_gap = min(gaps) if gaps else 'N/A'
        avg_gap = round(sum(gaps)/len(gaps)) if gaps else 'N/A'
        print(f"  #{bid}: fired at ticks {ticks} | gaps: {gaps} | min gap: {min_gap}, avg gap: {avg_gap}")

    # Track our ability timing
    our_ability_ticks = {}
    for frame in data['frames']:
        for e in frame.get('events', []):
            if e['type'] == 'ability' and e['botId'] in our_ids_l:
                bid = e['botId'].split(':')[-1]
                if bid not in our_ability_ticks:
                    our_ability_ticks[bid] = []
                our_ability_ticks[bid].append(frame['tick'])

    print(f"{label}: Our ability timing:")
    for bid in sorted(our_ability_ticks.keys()):
        ticks = our_ability_ticks[bid]
        gaps = [ticks[i+1] - ticks[i] for i in range(len(ticks)-1)]
        print(f"  #{bid}: fired at ticks {ticks} | gaps: {gaps}")

# =====================================
# REPLAY 3 BLOWOUT: WHAT WENT WRONG?
# =====================================
print("\n" + "=" * 80)
print("REPLAY 3 BLOWOUT DEEP DIVE")
print("=" * 80)

with open('scouting/maestro-v15c/L-8aa3d24f-1K320-vs-5K520.json') as f:
    data = json.load(f)

our_ids_3 = set()
enemy_ids_3 = set()
for b in data['bots']:
    if b['agentId'] == OUR_AGENT:
        our_ids_3.add(b['id'])
    else:
        enemy_ids_3.add(b['id'])

our_sorted_3 = sorted(our_ids_3)
enemy_sorted_3 = sorted(enemy_ids_3)

# Tick-by-tick for first 65 ticks (where we lose 2 bots)
print("\nEarly game detail (ticks 0-65):")
for frame in data['frames']:
    tick = frame['tick']
    if tick > 65:
        break
    if tick % 5 != 0:
        continue

    state = {b['id']: b for b in frame['bots']}

    our_alive = [(bid, state[bid]) for bid in our_sorted_3 if state[bid]['alive']]
    enemy_alive = [(bid, state[bid]) for bid in enemy_sorted_3 if state[bid]['alive']]

    our_hps = [state[bid]['health'] for bid in our_sorted_3 if state[bid]['alive']]
    enemy_hps = [state[bid]['health'] for bid in enemy_sorted_3 if state[bid]['alive']]

    # Compute pairwise distances for our alive bots
    our_positions = [state[bid]['position'] for bid in our_sorted_3 if state[bid]['alive']]

    pairwise = []
    for i in range(len(our_positions)):
        for j in range(i+1, len(our_positions)):
            pairwise.append(dist(our_positions[i], our_positions[j]))
    pairwise.sort()

    print(f"  tick {tick:3d}: us {len(our_alive)}a/{sum(our_hps)}HP (pairwise: {[round(d) for d in pairwise[:3]]}) | them {len(enemy_alive)}a/{sum(enemy_hps)}HP")

# The key question: our #2 died at tick 31, which is very early
# Was #2 isolated from the pack?
print("\nBot #2 isolation analysis:")
for frame in data['frames']:
    tick = frame['tick']
    if tick > 35:
        break
    if tick % 5 != 0:
        continue

    state = {b['id']: b for b in frame['bots']}
    bot2 = state[our_sorted_3[2]]
    if not bot2['alive'] and tick > 31:
        break

    # Distance from #2 to each ally
    dists_to_allies = []
    for bid in our_sorted_3:
        if bid != our_sorted_3[2] and state[bid]['alive']:
            d = dist(bot2['position'], state[bid]['position'])
            dists_to_allies.append((bid.split(':')[-1], round(d)))

    # Distance from #2 to nearest enemy
    nearest_enemy = float('inf')
    for bid in enemy_sorted_3:
        if state[bid]['alive']:
            d = dist(bot2['position'], state[bid]['position'])
            if d < nearest_enemy:
                nearest_enemy = d

    print(f"  tick {tick}: #2 HP={bot2['health']}, allies: {dists_to_allies}, nearest enemy: {round(nearest_enemy)}u")
