#!/usr/bin/env python3
"""Deep per-bot analysis: HP trajectories, damage breakdown, kill details."""

import json
import math

OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'

files = [
    'scouting/maestro-v15c/L-028cb762-4K510-vs-5K530.json',
    'scouting/maestro-v15c/L-6b5dd1bd-3K395-vs-4K400.json',
    'scouting/maestro-v15c/L-8aa3d24f-1K320-vs-5K520.json',
]

for filepath in files:
    with open(filepath) as f:
        data = json.load(f)

    our_ids = set()
    enemy_ids = set()
    for b in data['bots']:
        if b['agentId'] == OUR_AGENT:
            our_ids.add(b['id'])
        else:
            enemy_ids.add(b['id'])

    our_bots_sorted = sorted(our_ids)
    enemy_bots_sorted = sorted(enemy_ids)

    print(f'\n{"="*80}')
    print(f'=== {filepath.split("/")[-1]} ===')
    print(f'{"="*80}')

    # Per-bot HP trajectory
    print(f'\nPer-bot HP trajectory (our bots):')
    header = 'Tick  | ' + ' | '.join(f'#{bid.split(":")[-1]:>3}' for bid in our_bots_sorted) + ' | Total'
    print(header)
    print('-' * len(header))

    for frame in data['frames']:
        tick = frame['tick']
        if tick % 10 != 0 and tick != len(data['frames']) - 1:
            continue
        state = {b['id']: b for b in frame['bots']}
        hps = []
        for bid in our_bots_sorted:
            hp = state[bid]['health'] if state[bid]['alive'] else 0
            hps.append(hp)
        print(f'{tick:5d} | ' + ' | '.join(f'{hp:>3}' for hp in hps) + f' | {sum(hps):>5}')

    # Per-bot damage taken breakdown
    print(f'\nDamage taken per bot (from enemy):')
    bot_dmg = {bid: {'melee': 0, 'ability': 0, 'zone': 0} for bid in our_bots_sorted}
    for frame in data['frames']:
        for e in frame.get('events', []):
            if e['type'] == 'damage' and e['targetId'] in our_ids:
                target = e['targetId']
                attacker = e.get('attackerId')
                if attacker is None or attacker == 'zone':
                    bot_dmg[target]['zone'] += e['damage']
                elif e['damage'] == 15:
                    bot_dmg[target]['ability'] += e['damage']
                else:
                    bot_dmg[target]['melee'] += e['damage']

    for bid in our_bots_sorted:
        d = bot_dmg[bid]
        total = d['melee'] + d['ability'] + d['zone']
        pct_aoe = round(100 * d['ability'] / total) if total > 0 else 0
        print(f'  #{bid.split(":")[-1]}: melee={d["melee"]:3d}, ability={d["ability"]:3d}, zone={d["zone"]:3d} | total={total:3d} ({pct_aoe}% AoE)')

    # Kill details
    print(f'\nKill details (last 3 damage events before each death):')
    kill_ticks = {}
    for frame in data['frames']:
        for e in frame.get('events', []):
            if e['type'] == 'kill' and e['victimId'] in our_ids:
                kill_ticks[e['victimId']] = (frame['tick'], e.get('killerId'))

    for victim_id, (kill_tick, killer_id) in sorted(kill_ticks.items(), key=lambda x: x[1][0]):
        damages_before = []
        for frame in data['frames']:
            if frame['tick'] > kill_tick:
                break
            for e in frame.get('events', []):
                if e['type'] == 'damage' and e['targetId'] == victim_id:
                    damages_before.append((frame['tick'], e.get('attackerId'), e['damage']))

        last3 = damages_before[-3:]
        num = victim_id.split(':')[-1]
        killer_str = "zone" if killer_id is None else f"them #{killer_id.split(':')[-1]}" if killer_id in enemy_ids else f"us #{killer_id.split(':')[-1]}"
        print(f'  #{num} died tick {kill_tick} (killed by {killer_str}):')
        for t, att, dmg in last3:
            if att is None or att == 'zone':
                att_str = 'zone'
            elif att in our_ids:
                att_str = f'us #{att.split(":")[-1]}'
            else:
                att_str = f'them #{att.split(":")[-1]}'
            dtype = 'ability' if dmg == 15 else ('zone' if att is None or att == 'zone' else 'melee')
            print(f'    tick {t}: {dmg:2d} dmg ({dtype:7s}) from {att_str}')

    # Enemy per-bot damage dealt breakdown
    print(f'\nEnemy damage dealt per bot:')
    enemy_dmg = {bid: {'melee': 0, 'ability': 0} for bid in enemy_bots_sorted}
    for frame in data['frames']:
        for e in frame.get('events', []):
            if e['type'] == 'damage' and e.get('attackerId') in enemy_ids and e['targetId'] in our_ids:
                attacker = e['attackerId']
                if e['damage'] == 15:
                    enemy_dmg[attacker]['ability'] += e['damage']
                else:
                    enemy_dmg[attacker]['melee'] += e['damage']

    for bid in enemy_bots_sorted:
        d = enemy_dmg[bid]
        total = d['melee'] + d['ability']
        print(f'  #{bid.split(":")[-1]}: melee={d["melee"]:3d}, ability={d["ability"]:3d} | total={total:3d}')

    # Engagement distances - when we first engage, how far apart are teams?
    print(f'\nFirst engagement analysis:')
    first_combat_tick = None
    for frame in data['frames']:
        for e in frame.get('events', []):
            if e['type'] == 'damage':
                att = e.get('attackerId')
                tgt = e['targetId']
                if (att in our_ids and tgt in enemy_ids) or (att in enemy_ids and tgt in our_ids):
                    first_combat_tick = frame['tick']
                    break
        if first_combat_tick is not None:
            break

    if first_combat_tick is not None:
        state = {b['id']: b for b in data['frames'][first_combat_tick]['bots']}
        our_pos = [state[bid]['position'] for bid in our_bots_sorted if state[bid]['alive']]
        enemy_pos = [state[bid]['position'] for bid in enemy_bots_sorted if state[bid]['alive']]
        # Pairwise distances between closest our/enemy pairs
        closest_pairs = []
        for op in our_pos:
            for ep in enemy_pos:
                d = math.sqrt((op['x'] - ep['x'])**2 + (op['y'] - ep['y'])**2)
                closest_pairs.append(d)
        closest_pairs.sort()
        print(f'  First combat at tick {first_combat_tick}')
        print(f'  Closest inter-team distances: {[round(d) for d in closest_pairs[:5]]}')

    # Stalemate detection in replay 2
    print(f'\nStalemate/disengagement analysis:')
    last_combat_tick = 0
    combat_ticks = []
    for frame in data['frames']:
        for e in frame.get('events', []):
            if e['type'] == 'damage':
                att = e.get('attackerId')
                tgt = e['targetId']
                if att is not None and att != 'zone':
                    if (att in our_ids and tgt in enemy_ids) or (att in enemy_ids and tgt in our_ids):
                        combat_ticks.append(frame['tick'])
                        break

    if combat_ticks:
        print(f'  Combat ticks: first={combat_ticks[0]}, last={combat_ticks[-1]}')
        print(f'  Total combat ticks: {len(combat_ticks)} out of {len(data["frames"])}')
        # Find gaps in combat
        gaps = []
        for i in range(1, len(combat_ticks)):
            gap = combat_ticks[i] - combat_ticks[i-1]
            if gap > 20:
                gaps.append((combat_ticks[i-1], combat_ticks[i], gap))
        if gaps:
            print(f'  Combat gaps (>20 ticks):')
            for start, end, gap in gaps:
                print(f'    Tick {start} -> {end}: {gap} tick gap')
