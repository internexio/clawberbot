#!/usr/bin/env python3
"""Analyze CFJBot-Opus46F losses in detail."""
import json
import sys
import math

REPLAYS = [
    "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-f773db8d.json",
    "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-2344dd63.json",
    "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-54690ec8.json",
]

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

def dist(p1, p2):
    return math.sqrt((p1['x']-p2['x'])**2 + (p1['y']-p2['y'])**2)

def dist_from_zone(bot, zone):
    cx, cy = zone['centerX'], zone['centerY']
    d = math.sqrt((bot['position']['x']-cx)**2 + (bot['position']['y']-cy)**2)
    return d - zone['radius']  # negative = inside

def center_of(bots):
    if not bots:
        return {'x': 0, 'y': 0}
    return {
        'x': sum(b['position']['x'] for b in bots) / len(bots),
        'y': sum(b['position']['y'] for b in bots) / len(bots),
    }

def analyze_replay(filepath):
    with open(filepath) as f:
        data = json.load(f)

    print(f"\n{'='*80}")
    print(f"REPLAY: {filepath}")
    print(f"{'='*80}")

    # Identify teams
    our_prefix = None
    enemy_prefix = None
    for bot in data['bots']:
        if bot['agentId'] == OUR_AGENT:
            our_prefix = bot['id'].split(':')[0]
        else:
            enemy_prefix = bot['id'].split(':')[0]

    print(f"Our prefix: {our_prefix}")
    print(f"Enemy prefix: {enemy_prefix}")
    print(f"Winner: {data['winner']}")
    winner_is_us = our_prefix in data['winner'] if data['winner'] else False
    print(f"We {'WON' if winner_is_us else 'LOST'}")
    print(f"Total frames: {len(data['frames'])}")
    print(f"Game config: attack={data['gameConfig']['attackDamage']}dmg/{data['gameConfig']['attackRange']}range, ability={data['gameConfig']['abilityDamage']}dmg/{data['gameConfig']['abilityRange']}blast/{data['gameConfig']['abilityMaxDistance']}cast")
    print(f"Starting ammo: {data['frames'][0]['bots'][0]['ammo']}")

    frames = data['frames']

    def get_team_bots(frame, prefix, alive_only=False):
        bots = [b for b in frame['bots'] if b['id'].startswith(prefix)]
        if alive_only:
            bots = [b for b in bots if b['alive']]
        return bots

    # Track events
    our_attacks = 0
    our_abilities = 0
    enemy_attacks = 0
    enemy_abilities = 0
    our_kills = 0
    enemy_kills = 0
    our_damage_dealt = 0
    enemy_damage_dealt = 0
    our_pickups = 0
    enemy_pickups = 0

    kill_log = []
    ability_log = []
    attack_log = []
    pickup_log = []

    prev_hp = {}
    for bot in frames[0]['bots']:
        prev_hp[bot['id']] = bot['health']
    prev_alive = {}
    for bot in frames[0]['bots']:
        prev_alive[bot['id']] = bot['alive']

    for frame in frames:
        tick = frame['tick']

        # Track HP changes
        for bot in frame['bots']:
            if bot['id'] in prev_hp:
                hp_diff = prev_hp[bot['id']] - bot['health']
                if hp_diff > 0:
                    # Bot took damage
                    if bot['id'].startswith(our_prefix):
                        enemy_damage_dealt += hp_diff
                    else:
                        our_damage_dealt += hp_diff
            prev_hp[bot['id']] = bot['health']

        # Track deaths
        for bot in frame['bots']:
            if bot['id'] in prev_alive and prev_alive[bot['id']] and not bot['alive']:
                if bot['id'].startswith(our_prefix):
                    enemy_kills += 1
                    kill_log.append((tick, 'ENEMY_KILL', bot['id'], bot['position']))
                else:
                    our_kills += 1
                    kill_log.append((tick, 'OUR_KILL', bot['id'], bot['position']))
            prev_alive[bot['id']] = bot['alive']

        for event in frame.get('events', []):
            etype = event.get('type', '')
            bot_id = event.get('botId', '')

            if etype == 'attack':
                if bot_id.startswith(our_prefix):
                    our_attacks += 1
                    attack_log.append((tick, 'US', bot_id, event.get('targetId', '')))
                elif bot_id.startswith(enemy_prefix):
                    enemy_attacks += 1
                    attack_log.append((tick, 'THEM', bot_id, event.get('targetId', '')))

            elif etype == 'ability':
                if bot_id.startswith(our_prefix):
                    our_abilities += 1
                    ability_log.append((tick, 'US', bot_id, event.get('position', {})))
                elif bot_id.startswith(enemy_prefix):
                    enemy_abilities += 1
                    ability_log.append((tick, 'THEM', bot_id, event.get('position', {})))

            elif etype == 'pickup':
                if bot_id.startswith(our_prefix):
                    our_pickups += 1
                    pickup_log.append((tick, 'US', bot_id, event.get('pickupType', '')))
                elif bot_id.startswith(enemy_prefix):
                    enemy_pickups += 1
                    pickup_log.append((tick, 'THEM', bot_id, event.get('pickupType', '')))

    # Final state
    last = frames[-1]
    last_tick = last['tick']
    our_final = get_team_bots(last, our_prefix)
    enemy_final = get_team_bots(last, enemy_prefix)
    our_alive_final = [b for b in our_final if b['alive']]
    enemy_alive_final = [b for b in enemy_final if b['alive']]
    our_hp_total = sum(b['health'] for b in our_alive_final)
    enemy_hp_total = sum(b['health'] for b in enemy_alive_final)

    print(f"\n--- FINAL STATE (tick {last_tick}) ---")
    print(f"Our bots alive: {len(our_alive_final)}/5, total HP: {our_hp_total}")
    print(f"Enemy bots alive: {len(enemy_alive_final)}/5, total HP: {enemy_hp_total}")
    for b in our_final:
        z = dist_from_zone(b, last['zone'])
        print(f"  {b['id'][-3:]} hp={b['health']:3d} ammo={b['ammo']} alive={b['alive']} pos=({b['position']['x']:.0f},{b['position']['y']:.0f}) zone_dist={z:.0f}")
    for b in enemy_final:
        z = dist_from_zone(b, last['zone'])
        print(f"  {b['id'][-3:]} hp={b['health']:3d} ammo={b['ammo']} alive={b['alive']} pos=({b['position']['x']:.0f},{b['position']['y']:.0f}) zone_dist={z:.0f}")

    print(f"\n--- COMBAT STATS ---")
    print(f"Our attacks: {our_attacks}, abilities: {our_abilities}, damage dealt: {our_damage_dealt}")
    print(f"Enemy attacks: {enemy_attacks}, abilities: {enemy_abilities}, damage dealt: {enemy_damage_dealt}")
    print(f"Our kills: {our_kills}, Enemy kills: {enemy_kills}")
    print(f"Our pickups: {our_pickups}, Enemy pickups: {enemy_pickups}")

    print(f"\n--- KILL LOG ---")
    for tick, ktype, bot_id, pos in kill_log:
        print(f"  tick {tick:4d}: {ktype} {bot_id[-3:]} at ({pos['x']:.0f},{pos['y']:.0f})")

    print(f"\n--- PICKUP LOG ---")
    for tick, who, bot_id, ptype in pickup_log:
        print(f"  tick {tick:4d}: {who} {bot_id[-3:]} got {ptype}")

    # Ability timing analysis
    our_ability_ticks = [t for t, w, _, _ in ability_log if w == 'US']
    enemy_ability_ticks = [t for t, w, _, _ in ability_log if w == 'THEM']
    print(f"\n--- ABILITY TIMING ---")
    print(f"Our ability ticks: {our_ability_ticks}")
    print(f"Enemy ability ticks: {enemy_ability_ticks}")

    # Attack timing analysis
    our_attack_ticks = [t for t, w, _, _ in attack_log if w == 'US']
    enemy_attack_ticks = [t for t, w, _, _ in attack_log if w == 'THEM']
    if our_attack_ticks:
        print(f"Our first attack: tick {min(our_attack_ticks)}, last: tick {max(our_attack_ticks)}")
    if enemy_attack_ticks:
        print(f"Enemy first attack: tick {min(enemy_attack_ticks)}, last: tick {max(enemy_attack_ticks)}")

    # Position analysis at key ticks
    for check_tick in [0, 50, 100, 200, 400, 600, 800]:
        # Find closest frame
        frame = None
        for f in frames:
            if f['tick'] >= check_tick:
                frame = f
                break
        if not frame:
            continue

        tick = frame['tick']
        zone = frame['zone']
        our_bots = get_team_bots(frame, our_prefix, alive_only=True)
        enemy_bots = get_team_bots(frame, enemy_prefix, alive_only=True)

        if not our_bots or not enemy_bots:
            continue

        our_center = center_of(our_bots)
        enemy_center = center_of(enemy_bots)

        # Spread (avg dist from team center)
        our_spread = sum(dist(b['position'], our_center) for b in our_bots) / len(our_bots) if our_bots else 0
        enemy_spread = sum(dist(b['position'], enemy_center) for b in enemy_bots) / len(enemy_bots) if enemy_bots else 0

        # Distance from zone center
        our_zone_dist = math.sqrt((our_center['x']-zone['centerX'])**2 + (our_center['y']-zone['centerY'])**2)
        enemy_zone_dist = math.sqrt((enemy_center['x']-zone['centerX'])**2 + (enemy_center['y']-zone['centerY'])**2)

        team_dist = dist(our_center, enemy_center)

        our_hp = sum(b['health'] for b in our_bots)
        enemy_hp = sum(b['health'] for b in enemy_bots)
        our_ammo = sum(b['ammo'] for b in our_bots)
        enemy_ammo = sum(b['ammo'] for b in enemy_bots)

        print(f"\n--- TICK {tick} --- zone_r={zone['radius']:.0f} zone_center=({zone['centerX']:.0f},{zone['centerY']:.0f})")
        print(f"  US:   {len(our_bots)} alive, HP={our_hp}, ammo={our_ammo}, center=({our_center['x']:.0f},{our_center['y']:.0f}), spread={our_spread:.0f}u, zone_dist={our_zone_dist:.0f}")
        print(f"  THEM: {len(enemy_bots)} alive, HP={enemy_hp}, ammo={enemy_ammo}, center=({enemy_center['x']:.0f},{enemy_center['y']:.0f}), spread={enemy_spread:.0f}u, zone_dist={enemy_zone_dist:.0f}")
        print(f"  Team distance: {team_dist:.0f}u")

        # Individual bot positions
        for b in our_bots:
            zd = dist_from_zone(b, zone)
            print(f"    US  {b['id'][-3:]} ({b['position']['x']:.0f},{b['position']['y']:.0f}) hp={b['health']} ammo={b['ammo']} zone={zd:.0f}")
        for b in enemy_bots:
            zd = dist_from_zone(b, zone)
            print(f"    THEM {b['id'][-3:]} ({b['position']['x']:.0f},{b['position']['y']:.0f}) hp={b['health']} ammo={b['ammo']} zone={zd:.0f}")

    # Attack target analysis - who do they focus?
    print(f"\n--- ENEMY ATTACK TARGETS ---")
    target_counts = {}
    for tick, who, bot_id, target_id in attack_log:
        if who == 'THEM':
            target_counts[target_id] = target_counts.get(target_id, 0) + 1
    for target, count in sorted(target_counts.items(), key=lambda x: -x[1]):
        print(f"  {target[-3:]}: {count} attacks received")

    print(f"\n--- OUR ATTACK TARGETS ---")
    target_counts = {}
    for tick, who, bot_id, target_id in attack_log:
        if who == 'US':
            target_counts[target_id] = target_counts.get(target_id, 0) + 1
    for target, count in sorted(target_counts.items(), key=lambda x: -x[1]):
        print(f"  {target[-3:]}: {count} attacks received from us")

    # Zone damage analysis - track HP loss while outside zone
    print(f"\n--- ZONE DAMAGE TRACKING ---")
    our_zone_dmg = 0
    enemy_zone_dmg = 0
    for frame in frames:
        zone = frame['zone']
        for bot in frame['bots']:
            if bot['alive']:
                d = dist_from_zone(bot, zone)
                if d > 0:  # outside zone
                    if bot['id'].startswith(our_prefix):
                        our_zone_dmg += 3  # zoneDamagePerTick
                    else:
                        enemy_zone_dmg += 3
    print(f"  Our bots zone damage taken (estimated): {our_zone_dmg}")
    print(f"  Enemy bots zone damage taken (estimated): {enemy_zone_dmg}")

    return data

for replay_file in REPLAYS:
    try:
        analyze_replay(replay_file)
    except Exception as e:
        print(f"Error analyzing {replay_file}: {e}")
        import traceback
        traceback.print_exc()
