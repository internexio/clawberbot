#!/usr/bin/env python3
"""Deep analysis of CFJBot ability hits and damage patterns."""
import json
import math

REPLAYS = [
    "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-f773db8d.json",
    "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-2344dd63.json",
    "match-history/L-vs-CFJBot--Opus46F-Velocity-Comet-54690ec8.json",
]

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

def dist(p1, p2):
    return math.sqrt((p1['x']-p2['x'])**2 + (p1['y']-p2['y'])**2)

def analyze_deep(filepath):
    with open(filepath) as f:
        data = json.load(f)

    print(f"\n{'='*80}")
    print(f"DEEP ANALYSIS: {filepath.split('/')[-1]}")
    print(f"{'='*80}")

    our_prefix = None
    enemy_prefix = None
    for bot in data['bots']:
        if bot['agentId'] == OUR_AGENT:
            our_prefix = bot['id'].split(':')[0]
        else:
            enemy_prefix = bot['id'].split(':')[0]

    frames = data['frames']

    # Analyze each ability: who fired, where did it land, who got hit, how many bots hit
    print("\n--- ABILITY-BY-ABILITY ANALYSIS (first 250 ticks) ---")

    prev_hp = {}
    for bot in frames[0]['bots']:
        prev_hp[bot['id']] = bot['health']

    for i, frame in enumerate(frames):
        tick = frame['tick']
        if tick > 250:
            break

        for event in frame.get('events', []):
            if event.get('type') != 'ability':
                continue

            bot_id = event.get('botId', '')
            who = 'US' if bot_id.startswith(our_prefix) else 'THEM'
            pos = event.get('position', event.get('targetPosition', {}))

            # Find the casting bot's position
            caster = None
            for b in frame['bots']:
                if b['id'] == bot_id:
                    caster = b
                    break

            # Find who's near the ability blast (150u radius)
            blast_pos = pos if pos else {}
            if not blast_pos:
                continue

            nearby = []
            for b in frame['bots']:
                if not b['alive']:
                    continue
                d = dist(b['position'], blast_pos)
                if d <= 150:
                    team = 'US' if b['id'].startswith(our_prefix) else 'THEM'
                    nearby.append((b['id'][-3:], team, d, b['health']))

            # Look at next frame for actual HP changes
            hits_detail = ""
            if i + 1 < len(frames):
                next_frame = frames[i + 1]
                for b in next_frame['bots']:
                    if b['id'] in prev_hp and prev_hp[b['id']] != b['health']:
                        diff = prev_hp[b['id']] - b['health']
                        if diff > 0:
                            team = 'US' if b['id'].startswith(our_prefix) else 'THEM'
                            hits_detail += f" {b['id'][-3:]}({team}):-{diff}hp"

            n_our = sum(1 for _, t, _, _ in nearby if t == 'US')
            n_them = sum(1 for _, t, _, _ in nearby if t == 'THEM')

            cast_dist = dist(caster['position'], blast_pos) if caster else 0

            print(f"  tick {tick:3d} {who} {bot_id[-3:]} ability at ({blast_pos.get('x',0):.0f},{blast_pos.get('y',0):.0f}) "
                  f"cast_dist={cast_dist:.0f} nearby: {n_our}us+{n_them}them [{', '.join(f'{n}({t},{d:.0f}u)' for n,t,d,_ in nearby)}]{hits_detail}")

        # Update prev_hp
        for bot in frame['bots']:
            prev_hp[bot['id']] = bot['health']

    # Analyze convergence speed: how fast does each team pack up?
    print("\n--- CONVERGENCE SPEED (tick 0 to first engagement) ---")
    for tick_check in range(0, 120, 10):
        frame = None
        for f in frames:
            if f['tick'] >= tick_check:
                frame = f
                break
        if not frame:
            continue

        our_alive = [b for b in frame['bots'] if b['id'].startswith(our_prefix) and b['alive']]
        enemy_alive = [b for b in frame['bots'] if b['id'].startswith(enemy_prefix) and b['alive']]

        if not our_alive or not enemy_alive:
            continue

        our_c = {'x': sum(b['position']['x'] for b in our_alive)/len(our_alive),
                 'y': sum(b['position']['y'] for b in our_alive)/len(our_alive)}
        enemy_c = {'x': sum(b['position']['x'] for b in enemy_alive)/len(enemy_alive),
                   'y': sum(b['position']['y'] for b in enemy_alive)/len(enemy_alive)}

        our_spread = sum(dist(b['position'], our_c) for b in our_alive) / len(our_alive)
        enemy_spread = sum(dist(b['position'], enemy_c) for b in enemy_alive) / len(enemy_alive)

        # Max pairwise distance (widest 2 bots)
        our_max = 0
        for a in our_alive:
            for b in our_alive:
                d = dist(a['position'], b['position'])
                if d > our_max:
                    our_max = d
        enemy_max = 0
        for a in enemy_alive:
            for b in enemy_alive:
                d = dist(a['position'], b['position'])
                if d > enemy_max:
                    enemy_max = d

        print(f"  tick {tick_check:3d}: US spread={our_spread:.0f}(max={our_max:.0f}), THEM spread={enemy_spread:.0f}(max={enemy_max:.0f})")

    # Ammo spending comparison
    print("\n--- AMMO SPENDING BY TICK ---")
    for tick_check in [0, 30, 60, 100, 150, 200]:
        frame = None
        for f in frames:
            if f['tick'] >= tick_check:
                frame = f
                break
        if not frame:
            continue

        our_ammo = sum(b['ammo'] for b in frame['bots'] if b['id'].startswith(our_prefix))
        enemy_ammo = sum(b['ammo'] for b in frame['bots'] if b['id'].startswith(enemy_prefix))
        print(f"  tick {tick_check:3d}: US ammo={our_ammo}/25, THEM ammo={enemy_ammo}/25")

    # HP differential over time
    print("\n--- HP DIFFERENTIAL OVER TIME ---")
    for tick_check in [0, 20, 40, 60, 80, 100, 120, 150, 200, 300]:
        frame = None
        for f in frames:
            if f['tick'] >= tick_check:
                frame = f
                break
        if not frame:
            continue

        our_hp = sum(b['health'] for b in frame['bots'] if b['id'].startswith(our_prefix) and b['alive'])
        enemy_hp = sum(b['health'] for b in frame['bots'] if b['id'].startswith(enemy_prefix) and b['alive'])
        our_alive = sum(1 for b in frame['bots'] if b['id'].startswith(our_prefix) and b['alive'])
        enemy_alive = sum(1 for b in frame['bots'] if b['id'].startswith(enemy_prefix) and b['alive'])
        diff = our_hp - enemy_hp
        print(f"  tick {tick_check:3d}: US {our_hp}hp({our_alive}a) vs THEM {enemy_hp}hp({enemy_alive}a)  diff={diff:+d}")

    # Where do our bots die? Analyze isolation
    print("\n--- BOT DEATH ANALYSIS ---")
    prev_alive_set = set()
    for bot in frames[0]['bots']:
        if bot['alive']:
            prev_alive_set.add(bot['id'])

    for frame in frames:
        tick = frame['tick']
        for bot in frame['bots']:
            if bot['id'] in prev_alive_set and not bot['alive']:
                # Bot just died
                team = 'US' if bot['id'].startswith(our_prefix) else 'THEM'
                prefix = our_prefix if bot['id'].startswith(our_prefix) else enemy_prefix

                # How many teammates were nearby (within 300u)?
                teammates_near = 0
                for other in frame['bots']:
                    if other['id'] != bot['id'] and other['id'].startswith(prefix) and other['alive']:
                        d = dist(other['position'], bot['position'])
                        if d < 300:
                            teammates_near += 1

                # How many enemies nearby?
                enemy_p = enemy_prefix if bot['id'].startswith(our_prefix) else our_prefix
                enemies_near = 0
                for other in frame['bots']:
                    if other['id'].startswith(enemy_p) and other['alive']:
                        d = dist(other['position'], bot['position'])
                        if d < 300:
                            enemies_near += 1

                print(f"  tick {tick:3d}: {team} {bot['id'][-3:]} died at ({bot['position']['x']:.0f},{bot['position']['y']:.0f}) "
                      f"hp={bot['health']} teammates_near(<300u)={teammates_near} enemies_near(<300u)={enemies_near}")

                prev_alive_set.discard(bot['id'])

        for bot in frame['bots']:
            if bot['alive']:
                prev_alive_set.add(bot['id'])
            else:
                prev_alive_set.discard(bot['id'])

for r in REPLAYS:
    analyze_deep(r)
