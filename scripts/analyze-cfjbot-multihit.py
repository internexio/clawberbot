#!/usr/bin/env python3
"""Analyze multi-hit AoE efficiency and targeting patterns."""
import json
import math
from collections import defaultdict

REPLAYS = [
    ("f773db8d", "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-f773db8d.json"),
    ("2344dd63", "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-2344dd63.json"),
    ("54690ec8", "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-54690ec8.json"),
]

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

def analyze(name, filepath):
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

    # Track HP per bot per frame to detect actual hits
    prev_hp = {}
    for bot in frames[0]['bots']:
        prev_hp[bot['id']] = bot['health']

    # For each ability event, track how many enemy bots actually lost HP that tick
    # Group by tick to see multi-hit
    ability_ticks_us = defaultdict(list)
    ability_ticks_them = defaultdict(list)

    for frame in frames:
        tick = frame['tick']
        for event in frame.get('events', []):
            if event.get('type') == 'ability':
                bot_id = event.get('botId', '')
                if bot_id.startswith(our_prefix):
                    ability_ticks_us[tick].append(event)
                else:
                    ability_ticks_them[tick].append(event)
        for bot in frame['bots']:
            prev_hp[bot['id']] = bot['health']

    # Now count actual enemy HP lost per ability tick
    # Re-read and track frame-by-frame
    prev_hp = {}
    for bot in frames[0]['bots']:
        prev_hp[bot['id']] = bot['health']

    us_ability_damage = 0  # damage to enemy bots
    them_ability_damage = 0  # damage to our bots
    us_self_damage = 0  # friendly fire from our abilities
    them_self_damage = 0  # friendly fire from their abilities

    # Count per-ability the enemy bots damaged
    us_hits_per_ability = []
    them_hits_per_ability = []

    for i, frame in enumerate(frames):
        tick = frame['tick']

        # Compute HP changes
        hp_changes = {}
        for bot in frame['bots']:
            if bot['id'] in prev_hp:
                diff = prev_hp[bot['id']] - bot['health']
                if diff != 0:
                    hp_changes[bot['id']] = diff

        # Attribute to abilities this tick
        if tick in ability_ticks_us:
            n_abilities = len(ability_ticks_us[tick])
            enemy_bots_hit = sum(1 for bid, d in hp_changes.items() if bid.startswith(enemy_prefix) and d > 0)
            enemy_dmg = sum(d for bid, d in hp_changes.items() if bid.startswith(enemy_prefix) and d > 0)
            self_dmg = sum(d for bid, d in hp_changes.items() if bid.startswith(our_prefix) and d > 0)
            us_ability_damage += enemy_dmg
            us_self_damage += self_dmg
            us_hits_per_ability.append((tick, n_abilities, enemy_bots_hit, enemy_dmg, self_dmg))

        if tick in ability_ticks_them:
            n_abilities = len(ability_ticks_them[tick])
            our_bots_hit = sum(1 for bid, d in hp_changes.items() if bid.startswith(our_prefix) and d > 0)
            our_dmg = sum(d for bid, d in hp_changes.items() if bid.startswith(our_prefix) and d > 0)
            self_dmg = sum(d for bid, d in hp_changes.items() if bid.startswith(enemy_prefix) and d > 0)
            them_ability_damage += our_dmg
            them_self_damage += self_dmg
            them_hits_per_ability.append((tick, n_abilities, our_bots_hit, our_dmg, self_dmg))

        for bot in frame['bots']:
            prev_hp[bot['id']] = bot['health']

    print(f"\n{'='*60}")
    print(f"MULTI-HIT ANALYSIS: {name}")
    print(f"{'='*60}")

    print(f"\nOUR abilities ({len(us_hits_per_ability)} volleys):")
    print(f"  Total enemy damage: {us_ability_damage}")
    print(f"  Total self-damage (friendly fire): {us_self_damage}")
    total_enemy_hits = sum(h for _, _, h, _, _ in us_hits_per_ability)
    total_volleys = len(us_hits_per_ability)
    if total_volleys:
        print(f"  Avg enemy bots hit per volley: {total_enemy_hits/total_volleys:.1f}")
        print(f"  Avg enemy damage per volley: {us_ability_damage/total_volleys:.0f}")
    multi = sum(1 for _, _, h, _, _ in us_hits_per_ability if h >= 2)
    print(f"  Multi-hit volleys (2+ enemies): {multi}/{total_volleys}")

    print(f"\nTHEIR abilities ({len(them_hits_per_ability)} volleys):")
    print(f"  Total damage to us: {them_ability_damage}")
    print(f"  Total self-damage (friendly fire): {them_self_damage}")
    total_our_hits = sum(h for _, _, h, _, _ in them_hits_per_ability)
    total_volleys = len(them_hits_per_ability)
    if total_volleys:
        print(f"  Avg our bots hit per volley: {total_our_hits/total_volleys:.1f}")
        print(f"  Avg damage to us per volley: {them_ability_damage/total_volleys:.0f}")
    multi = sum(1 for _, _, h, _, _ in them_hits_per_ability if h >= 2)
    print(f"  Multi-hit volleys (2+ of ours): {multi}/{total_volleys}")

    # Show the first 5 most damaging enemy volleys
    them_sorted = sorted(them_hits_per_ability, key=lambda x: -x[3])
    print(f"\n  Top 5 most damaging ENEMY volleys:")
    for tick, n_ab, n_hit, dmg, self_dmg in them_sorted[:5]:
        print(f"    tick {tick}: {n_ab} abilities, hit {n_hit} of ours for {dmg} dmg (self-dmg {self_dmg})")

    # The key question: how do they target our isolated bots early?
    print(f"\n  THEIR ability volleys by tick (first 200 ticks):")
    for tick, n_ab, n_hit, dmg, self_dmg in them_hits_per_ability:
        if tick <= 200:
            print(f"    tick {tick:3d}: {n_ab} abilities, hit {n_hit} of ours for {dmg} dmg (self {self_dmg})")

for name, path in REPLAYS:
    analyze(name, path)

# Cross-match summary
print(f"\n{'='*60}")
print(f"CROSS-MATCH PATTERN SUMMARY")
print(f"{'='*60}")
print("""
Key question: What does CFJBot do differently to win these?

PATTERNS TO CHECK:
1. Do they target our isolated bots with concentrated fire?
2. Do they dump ammo faster/smarter than us?
3. Do they converge to center faster for zone advantage?
4. How many of their abilities land multi-hits vs ours?
""")
