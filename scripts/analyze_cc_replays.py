#!/usr/bin/env python3
"""Analyze CC-0308 replays: tick-by-tick war room analysis."""

import json, sys, os, math
from collections import defaultdict

OUR_AGENT = "8f1e1fcf"

def dist_xy(x1, y1, x2, y2):
    return math.sqrt((x1-x2)**2 + (y1-y2)**2)

def analyze_replay(filepath):
    with open(filepath) as f:
        data = json.load(f)

    match_id = data['matchId'][:8]
    winner = data['winner']
    frames = data['frames']
    bots_meta = data['bots']

    # Identify teams by agent ID
    our_ids = set()
    their_ids = set()
    for b in bots_meta:
        if OUR_AGENT in b['agentId']:
            our_ids.add(b['id'])
        else:
            their_ids.add(b['id'])

    winner_base = winner.split(':')[0]
    # Check if winner is one of our bots
    we_won = any(winner == bid or winner.split(':')[0] == bid.split(':')[0] for bid in our_ids)
    outcome = "WIN" if we_won else "LOSS"

    print(f"\n{'='*80}")
    print(f"MATCH {match_id} | {outcome} | {len(frames)} ticks | {os.path.basename(filepath)}")
    print(f"{'='*80}")
    print(f"Our bots ({len(our_ids)}): {sorted(our_ids)}")
    print(f"Their bots ({len(their_ids)}): {sorted(their_ids)}")

    def is_ours(bot_id):
        return bot_id in our_ids
    def is_theirs(bot_id):
        return bot_id in their_ids

    # Track all events
    abilities_fired = []  # (tick, botId, targetPos, is_ours)
    damages = []  # (tick, attackerId, targetId, damage, is_attacker_ours)
    kills = []  # (tick, botId_died, killerId, is_our_death)
    pickups_collected = []
    melee_attacks = []

    for frame in frames:
        tick = frame['tick']
        for event in frame.get('events', []):
            etype = event.get('type', '')

            if etype == 'ability':
                bot = event['botId']
                tp = event.get('targetPosition', {})
                abilities_fired.append((tick, bot, tp, is_ours(bot)))

            elif etype == 'damage':
                attacker = event['attackerId']
                target = event['targetId']
                dmg = event['damage']
                damages.append((tick, attacker, target, dmg, is_ours(attacker)))

            elif etype in ('kill', 'death', 'eliminated'):
                killed = event.get('botId', event.get('killedId', ''))
                killer = event.get('killerId', event.get('attackerId', ''))
                kills.append((tick, killed, killer, is_ours(killed)))

            elif etype in ('pickup', 'powerup', 'collectPowerup'):
                bot = event.get('botId', '')
                ptype = event.get('powerupType', event.get('type', ''))
                pickups_collected.append((tick, bot, is_ours(bot), ptype))

            elif etype == 'attack':
                attacker = event.get('attackerId', event.get('botId', ''))
                target = event.get('targetId', '')
                dmg = event.get('damage', 5)
                melee_attacks.append((tick, attacker, target, dmg, is_ours(attacker)))

    # First ability timing
    our_first_abl = next((t for t, b, tp, ours in abilities_fired if ours), None)
    their_first_abl = next((t for t, b, tp, ours in abilities_fired if not ours), None)

    print(f"\n--- FIRST SHOTS ---")
    print(f"Our first ability:   tick {our_first_abl}")
    print(f"Their first ability: tick {their_first_abl}")

    # Damage by tick ranges
    print(f"\n--- DAMAGE DEALT (by phase) ---")
    for pname, t0, t1 in [("T0-T30", 0, 30), ("T30-T60", 30, 60), ("T60-T90", 60, 90), ("T90-T120", 90, 120), ("T120+", 120, 9999)]:
        our_dmg = sum(d for t, a, tgt, d, ours in damages if ours and t0 <= t < t1)
        their_dmg = sum(d for t, a, tgt, d, ours in damages if not ours and t0 <= t < t1)
        our_abl = sum(1 for t, b, tp, ours in abilities_fired if ours and t0 <= t < t1)
        their_abl = sum(1 for t, b, tp, ours in abilities_fired if not ours and t0 <= t < t1)
        if our_dmg or their_dmg or our_abl or their_abl:
            print(f"  {pname}: Us={our_dmg:>3}dmg ({our_abl} abilities), Them={their_dmg:>3}dmg ({their_abl} abilities)")

    # Total damage
    our_total_dmg = sum(d for t, a, tgt, d, ours in damages if ours)
    their_total_dmg = sum(d for t, a, tgt, d, ours in damages if not ours)
    our_total_abl = sum(1 for t, b, tp, ours in abilities_fired if ours)
    their_total_abl = sum(1 for t, b, tp, ours in abilities_fired if not ours)
    print(f"  TOTAL: Us={our_total_dmg}dmg ({our_total_abl} abilities), Them={their_total_dmg}dmg ({their_total_abl} abilities)")

    # Ability hit rate (damage events following ability events at same tick by same bot)
    our_abl_with_hit = 0
    their_abl_with_hit = 0
    our_abl_multihit = 0
    their_abl_multihit = 0
    for tick, bot, tp, ours in abilities_fired:
        hits = sum(1 for t, a, tgt, d, _ in damages if t == tick and a == bot and d == 10)
        if hits > 0:
            if ours: our_abl_with_hit += 1
            else: their_abl_with_hit += 1
        if hits >= 2:
            if ours: our_abl_multihit += 1
            else: their_abl_multihit += 1

    print(f"\n--- ABILITY ACCURACY ---")
    if our_total_abl:
        print(f"Us:   {our_abl_with_hit}/{our_total_abl} hit ({100*our_abl_with_hit/our_total_abl:.0f}%), {our_abl_multihit} multi-hits")
    if their_total_abl:
        print(f"Them: {their_abl_with_hit}/{their_total_abl} hit ({100*their_abl_with_hit/their_total_abl:.0f}%), {their_abl_multihit} multi-hits")

    # Melee damage
    our_melee_dmg = sum(d for t, a, tgt, d, ours in damages if ours and d == 5)
    their_melee_dmg = sum(d for t, a, tgt, d, ours in damages if not ours and d == 5)
    our_abl_dmg = sum(d for t, a, tgt, d, ours in damages if ours and d == 10)
    their_abl_dmg = sum(d for t, a, tgt, d, ours in damages if not ours and d == 10)
    print(f"\n--- DAMAGE BREAKDOWN ---")
    print(f"Us:   Ability={our_abl_dmg}  Melee={our_melee_dmg}")
    print(f"Them: Ability={their_abl_dmg}  Melee={their_melee_dmg}")

    # Per-bot ability count
    print(f"\n--- PER-BOT ABILITIES ---")
    for bid in sorted(our_ids):
        n = sum(1 for t, b, tp, ours in abilities_fired if b == bid)
        print(f"  Us   {bid[-3:]}: {n} abilities")
    for bid in sorted(their_ids):
        n = sum(1 for t, b, tp, ours in abilities_fired if b == bid)
        print(f"  Them {bid[-3:]}: {n} abilities")

    # Kill sequence
    print(f"\n--- KILL SEQUENCE ---")
    our_deaths = sum(1 for t, k, kr, od in kills if od)
    their_deaths = sum(1 for t, k, kr, od in kills if not od)
    print(f"Score: We killed {their_deaths}, They killed {our_deaths}")
    for t, killed, killer, our_death in kills:
        side = "** OUR BOT DIED **" if our_death else "   Enemy died    "
        kname = killer[-5:] if killer else "zone"
        print(f"  T{t:>4}: {side} | victim={killed[-5:]} killer={kname}")

    # Pickups
    print(f"\n--- PICKUPS ---")
    our_pu = [(t, b, p) for t, b, ours, p in pickups_collected if ours]
    their_pu = [(t, b, p) for t, b, ours, p in pickups_collected if not ours]
    print(f"Us: {len(our_pu)}, Them: {len(their_pu)}")
    for t, b, p in our_pu:
        print(f"  T{t:>3}: {p} (bot {b[-5:]})")
    for t, b, p in their_pu:
        print(f"  T{t:>3}: {p} (bot {b[-5:]})")

    # State at key ticks
    print(f"\n--- STATE AT KEY TICKS ---")
    key_ticks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
    # Add final tick
    final_tick = len(frames) - 1
    if final_tick > 120:
        key_ticks.append(final_tick)

    for target_tick in key_ticks:
        if target_tick >= len(frames):
            continue
        frame = frames[target_tick]
        tick = frame['tick']
        zone = frame.get('zone', {})
        zone_r = zone.get('radius', 0)
        zone_cx = zone.get('centerX', 1024)
        zone_cy = zone.get('centerY', 1024)

        our_hp = 0; our_ammo = 0; our_alive = 0
        their_hp = 0; their_ammo = 0; their_alive = 0
        our_pos = []; their_pos = []

        for bot in frame['bots']:
            bid = bot['id']
            if is_ours(bid):
                if bot['alive']:
                    our_alive += 1
                    our_hp += bot['health']
                    our_ammo += bot['ammo']
                    our_pos.append((bot['position']['x'], bot['position']['y']))
            elif is_theirs(bid):
                if bot['alive']:
                    their_alive += 1
                    their_hp += bot['health']
                    their_ammo += bot['ammo']
                    their_pos.append((bot['position']['x'], bot['position']['y']))

        def avg_spread(positions):
            if len(positions) < 2: return 0
            ds = []
            for i in range(len(positions)):
                for j in range(i+1, len(positions)):
                    ds.append(dist_xy(positions[i][0], positions[i][1], positions[j][0], positions[j][1]))
            return sum(ds)/len(ds)

        def centroid_zone_dist(positions, cx, cy):
            if not positions: return 0
            mx = sum(p[0] for p in positions)/len(positions)
            my = sum(p[1] for p in positions)/len(positions)
            return dist_xy(mx, my, cx, cy)

        our_spr = avg_spread(our_pos)
        their_spr = avg_spread(their_pos)
        our_zd = centroid_zone_dist(our_pos, zone_cx, zone_cy)
        their_zd = centroid_zone_dist(their_pos, zone_cx, zone_cy)
        hp_delta = our_hp - their_hp

        print(f"  T{tick:>3} | Zone r={zone_r:.0f}")
        print(f"       | Us:   {our_alive}alive HP={our_hp:>3.0f} Ammo={our_ammo:>2} spread={our_spr:>4.0f}u zoneDist={our_zd:>4.0f}u")
        print(f"       | Them: {their_alive}alive HP={their_hp:>3.0f} Ammo={their_ammo:>2} spread={their_spr:>4.0f}u zoneDist={their_zd:>4.0f}u")
        print(f"       | Delta: HP={hp_delta:+.0f} Ammo={our_ammo-their_ammo:+d}")

    # Convergence race
    print(f"\n--- CONVERGENCE RACE ---")
    for t in [5, 10, 15, 20, 25, 30, 40, 50]:
        if t >= len(frames): continue
        frame = frames[t]
        zone = frame.get('zone', {})
        zx = zone.get('centerX', 1024)
        zy = zone.get('centerY', 1024)
        our_d = []; their_d = []
        for bot in frame['bots']:
            if bot['alive']:
                d = dist_xy(bot['position']['x'], bot['position']['y'], zx, zy)
                if is_ours(bot['id']): our_d.append(d)
                elif is_theirs(bot['id']): their_d.append(d)
        our_avg = sum(our_d)/len(our_d) if our_d else 0
        their_avg = sum(their_d)/len(their_d) if their_d else 0
        leader = "CC closer" if their_avg < our_avg else "We closer"
        print(f"  T{t:>2}: Us avg={our_avg:>5.0f}u, Them avg={their_avg:>5.0f}u [{leader}]")

    # Ability range analysis - what distances are abilities fired from?
    print(f"\n--- ABILITY RANGE ANALYSIS ---")
    our_ranges = []
    their_ranges = []
    for tick_idx, frame in enumerate(frames):
        tick = frame['tick']
        bot_positions = {b['id']: (b['position']['x'], b['position']['y']) for b in frame['bots']}
        for event in frame.get('events', []):
            if event.get('type') == 'ability':
                bot = event['botId']
                tp = event.get('targetPosition', {})
                if bot in bot_positions and tp:
                    bx, by = bot_positions[bot]
                    tx, ty = tp.get('x', 0), tp.get('y', 0)
                    r = dist_xy(bx, by, tx, ty)
                    if is_ours(bot):
                        our_ranges.append(r)
                    else:
                        their_ranges.append(r)

    if our_ranges:
        print(f"Our ability cast ranges:   min={min(our_ranges):.0f} avg={sum(our_ranges)/len(our_ranges):.0f} max={max(our_ranges):.0f} (n={len(our_ranges)})")
    if their_ranges:
        print(f"Their ability cast ranges: min={min(their_ranges):.0f} avg={sum(their_ranges)/len(their_ranges):.0f} max={max(their_ranges):.0f} (n={len(their_ranges)})")

    return outcome


# --- MAIN ---
base = "/Users/davidpedersen/Mini/clawberbot/scouting/crabcrusher-0308/"

losses = [
    "L-vs-CrabCrusher-0308-0214-9YBX-c76c516e.json",  # Mar 30
    "L-vs-CrabCrusher-0308-0214-9YBX-2f90acb9.json",   # Mar 30
    "L-vs-CrabCrusher-0308-0214-9YBX-3da1af13.json",    # Mar 27
    "L-vs-CrabCrusher-0308-0214-9YBX-63287a50.json",    # Mar 21
]

wins = [
    "W-vs-CrabCrusher-0308-0214-9YBX-f8ac5718.json",    # Mar 24
    "W-vs-CrabCrusher-0308-0214-9YBX-e14536f0.json",    # Mar 13
]

print("=" * 80)
print("CC-0308 WAR ROOM ANALYSIS -- 4 LOSSES + 2 WINS")
print("=" * 80)

print("\n\n========== LOSSES ==========")
for fname in losses:
    fpath = base + fname
    if os.path.exists(fpath):
        analyze_replay(fpath)
    else:
        print(f"MISSING: {fpath}")

print("\n\n========== WINS ==========")
for fname in wins:
    fpath = base + fname
    if os.path.exists(fpath):
        analyze_replay(fpath)
    else:
        print(f"MISSING: {fpath}")
