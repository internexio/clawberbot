#!/usr/bin/env python3
"""Analyze CFJBot targeting: do they focus-fire isolated bots with long-range AoE?"""
import json
import math
from collections import defaultdict

REPLAYS = [
    ("f773db8d", "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-f773db8d.json"),
    ("2344dd63", "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-2344dd63.json"),
    ("54690ec8", "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-54690ec8.json"),
]

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

def dist(p1, p2):
    return math.sqrt((p1['x']-p2['x'])**2 + (p1['y']-p2['y'])**2)

for name, filepath in REPLAYS:
    with open(filepath) as f:
        data = json.load(f)

    our_prefix = None
    enemy_prefix = None
    for bot in data['bots']:
        if bot['agentId'] == OUR_AGENT:
            our_prefix = bot['id'].split(':')[0]
        else:
            enemy_prefix = bot['id'].split(':')[0]

    frames = data['frames']

    print(f"\n{'='*60}")
    print(f"TARGETING ANALYSIS: {name}")
    print(f"{'='*60}")

    # For each enemy ability, find which of our bots was closest to blast center
    # and whether that bot was isolated (far from teammates)
    print("\n--- ENEMY ABILITY TARGETING (who do they aim at?) ---")
    target_focus = defaultdict(int)  # our bot -> times targeted

    for frame in frames:
        tick = frame['tick']
        for event in frame.get('events', []):
            if event.get('type') != 'ability':
                continue
            bot_id = event.get('botId', '')
            if not bot_id.startswith(enemy_prefix):
                continue

            pos = event.get('position', {})
            if not pos:
                continue

            # Find nearest of our alive bots to blast center
            our_alive = [b for b in frame['bots'] if b['id'].startswith(our_prefix) and b['alive']]
            if not our_alive:
                continue

            nearest = min(our_alive, key=lambda b: dist(b['position'], pos))
            nearest_dist = dist(nearest['position'], pos)
            target_focus[nearest['id'][-3:]] += 1

            if tick <= 200:
                # Check isolation: how far is nearest from closest teammate?
                teammates = [b for b in our_alive if b['id'] != nearest['id']]
                if teammates:
                    closest_teammate_dist = min(dist(nearest['position'], t['position']) for t in teammates)
                else:
                    closest_teammate_dist = 9999

                # Cast distance
                caster = next((b for b in frame['bots'] if b['id'] == bot_id), None)
                cast_dist = dist(caster['position'], pos) if caster else 0

                isolated = "ISOLATED" if closest_teammate_dist > 300 else ""
                print(f"  tick {tick:3d}: {bot_id[-3:]} targets {nearest['id'][-3:]} (nearest_to_blast={nearest_dist:.0f}u, "
                      f"nearest_teammate={closest_teammate_dist:.0f}u, cast_dist={cast_dist:.0f}u) {isolated}")

    print(f"\n  Target distribution: {dict(target_focus)}")

    # Key question: how many abilities do they fire from >400u (long range sniping)?
    print(f"\n--- CAST DISTANCE DISTRIBUTION (enemy abilities) ---")
    cast_dists = []
    for frame in frames:
        for event in frame.get('events', []):
            if event.get('type') == 'ability' and event.get('botId', '').startswith(enemy_prefix):
                pos = event.get('position', {})
                caster = next((b for b in frame['bots'] if b['id'] == event['botId']), None)
                if caster and pos:
                    cast_dists.append(dist(caster['position'], pos))

    if cast_dists:
        short = sum(1 for d in cast_dists if d < 200)
        mid = sum(1 for d in cast_dists if 200 <= d < 400)
        long = sum(1 for d in cast_dists if d >= 400)
        print(f"  Short (<200u): {short}, Mid (200-400u): {mid}, Long (>400u): {long}")
        print(f"  Avg cast dist: {sum(cast_dists)/len(cast_dists):.0f}u")

    # What's our cast distance distribution?
    our_cast_dists = []
    for frame in frames:
        for event in frame.get('events', []):
            if event.get('type') == 'ability' and event.get('botId', '').startswith(our_prefix):
                pos = event.get('position', {})
                caster = next((b for b in frame['bots'] if b['id'] == event['botId']), None)
                if caster and pos:
                    our_cast_dists.append(dist(caster['position'], pos))

    if our_cast_dists:
        short = sum(1 for d in our_cast_dists if d < 200)
        mid = sum(1 for d in our_cast_dists if 200 <= d < 400)
        long = sum(1 for d in our_cast_dists if d >= 400)
        print(f"\n  OUR cast distances: Short (<200u): {short}, Mid (200-400u): {mid}, Long (>400u): {long}")
        print(f"  Avg cast dist: {sum(our_cast_dists)/len(our_cast_dists):.0f}u")

    # How many bots does each team have at various ticks?
    print(f"\n--- NUMERICAL ADVANTAGE OVER TIME ---")
    for tick_check in [0, 50, 75, 100, 125, 150, 200, 300, 500, 700]:
        frame = None
        for f in frames:
            if f['tick'] >= tick_check:
                frame = f
                break
        if not frame:
            continue
        our_count = sum(1 for b in frame['bots'] if b['id'].startswith(our_prefix) and b['alive'])
        them_count = sum(1 for b in frame['bots'] if b['id'].startswith(enemy_prefix) and b['alive'])
        print(f"  tick {tick_check:3d}: US {our_count} vs THEM {them_count} ({our_count - them_count:+d})")
