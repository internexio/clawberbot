#!/usr/bin/env python3
"""
Tick-by-tick replay analyzer for Clawber.ai battle replays.
Extracts kill timeline, damage distribution, positioning, ability usage, and critical moments.
"""

import json
import sys
import math
from collections import defaultdict

OUR_AGENT = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

def analyze_replay(filepath):
    with open(filepath) as f:
        data = json.load(f)

    match_id = data['matchId']
    winner = data['winner']
    frames = data['frames']
    total_ticks = len(frames)

    # Identify teams
    our_bots = {}
    enemy_bots = {}
    enemy_agent_name = ""
    for b in data['bots']:
        short_id = b['id']
        if b['agentId'] == OUR_AGENT:
            our_bots[short_id] = b['name']
        else:
            enemy_bots[short_id] = b['name']
            enemy_agent_name = b['name'].split(' #')[0]

    our_ids = set(our_bots.keys())
    enemy_ids = set(enemy_bots.keys())

    def team_label(bot_id):
        if bot_id in our_ids:
            return "US"
        elif bot_id in enemy_ids:
            return "ENEMY"
        elif bot_id == "zone":
            return "ZONE"
        return "UNKNOWN"

    def bot_label(bot_id):
        if bot_id in our_bots:
            return our_bots[bot_id]
        if bot_id in enemy_bots:
            return enemy_bots[bot_id]
        if bot_id == "zone":
            return "Zone"
        return bot_id

    print("=" * 80)
    print(f"MATCH ANALYSIS: {match_id}")
    print(f"Opponent: {enemy_agent_name}")
    print(f"Winner: {bot_label(winner)} ({team_label(winner.split(':')[0] + ':0') if ':' in winner else 'UNKNOWN'})")
    print(f"Duration: {total_ticks} ticks ({total_ticks/10:.1f} seconds)")
    print(f"Our bots: {list(our_bots.values())}")
    print(f"Enemy bots: {list(enemy_bots.values())}")
    print("=" * 80)

    # ================================================================
    # Track HP over time, kills, damage events
    # ================================================================
    hp_tracker = {}  # bot_id -> current HP
    kills = []  # list of {tick, killer, victim, victim_hp_before}
    damage_log = []  # all damage events
    ability_log = []  # all ability events

    # Damage dealt tracking
    dmg_dealt_by = defaultdict(int)  # attacker_id -> total dmg
    dmg_received_by = defaultdict(int)  # target_id -> total dmg
    dmg_team_to_team = defaultdict(int)  # (attacker_team, target_id) -> dmg
    dmg_attacker_to_target = defaultdict(int)  # (attacker_id, target_id) -> dmg

    # Ability tracking
    abilities_by_team = {"US": 0, "ENEMY": 0}
    abilities_multi_hit = {"US": 0, "ENEMY": 0}  # abilities hitting 2+ targets

    # Initialize HP
    for b in data['bots']:
        hp_tracker[b['id']] = 100

    # HP snapshots at key ticks
    hp_snapshots = {}
    snapshot_ticks = set(range(0, total_ticks + 1, 50))  # every 50 ticks

    # Process all frames
    alive_tracker = {b['id']: True for b in data['bots']}

    for frame in frames:
        tick = frame['tick']

        # Update positions from frame
        bot_positions = {}
        for bot_data in frame['bots']:
            bot_positions[bot_data['id']] = bot_data['position']
            if bot_data['alive']:
                hp_tracker[bot_data['id']] = bot_data['health']
            # Track alive status
            if alive_tracker.get(bot_data['id'], True) and not bot_data['alive']:
                alive_tracker[bot_data['id']] = False

        zone = frame.get('zone', {})

        # Process events
        ability_hits_this_tick = defaultdict(int)  # attacker_id -> hit count this tick from ability

        for ev in frame.get('events', []):
            if ev['type'] == 'damage':
                attacker = ev['attackerId']
                target = ev['targetId']
                dmg = ev['damage']

                dmg_dealt_by[attacker] += dmg
                dmg_received_by[target] += dmg
                dmg_attacker_to_target[(attacker, target)] += dmg

                at = team_label(attacker)
                damage_log.append({
                    'tick': tick,
                    'attacker': attacker,
                    'target': target,
                    'damage': dmg,
                    'attacker_team': at
                })

                if attacker != 'zone':
                    ability_hits_this_tick[attacker] += 1

            elif ev['type'] == 'ability':
                bot_id = ev['botId']
                t = team_label(bot_id)
                abilities_by_team[t] += 1
                ability_log.append({
                    'tick': tick,
                    'bot': bot_id,
                    'team': t,
                    'target_pos': ev.get('targetPosition', {})
                })

            elif ev['type'] == 'kill':
                killer = ev.get('killerId', ev.get('attackerId', 'unknown'))
                victim = ev.get('victimId', ev.get('targetId', 'unknown'))
                kills.append({
                    'tick': tick,
                    'killer': killer,
                    'victim': victim,
                    'victim_hp_before': hp_tracker.get(victim, 0),
                    'killer_team': team_label(killer),
                    'victim_team': team_label(victim),
                })
                # snapshot at kill tick
                snapshot_ticks.add(tick)

        # Record HP snapshot
        if tick in snapshot_ticks:
            hp_snapshots[tick] = {}
            for bot_data in frame['bots']:
                hp_snapshots[tick][bot_data['id']] = {
                    'hp': bot_data['health'],
                    'alive': bot_data['alive'],
                    'pos': bot_data['position']
                }

    # ================================================================
    # DETECT KILLS FROM HP DROPS (if no kill events)
    # ================================================================
    if not kills:
        print("\n[NOTE: No kill events found, detecting from HP/alive transitions]")
        for frame in frames:
            tick = frame['tick']
            for bot_data in frame['bots']:
                bid = bot_data['id']
                if alive_tracker.get(bid + '_prev', True) and not bot_data['alive']:
                    # Find who dealt damage to this bot recently
                    recent_attackers = [d for d in damage_log if d['target'] == bid and d['tick'] >= tick - 5]
                    killer = recent_attackers[-1]['attacker'] if recent_attackers else 'unknown'
                    kills.append({
                        'tick': tick,
                        'killer': killer,
                        'victim': bid,
                        'victim_hp_before': 0,
                        'killer_team': team_label(killer),
                        'victim_team': team_label(bid),
                    })
                alive_tracker[bid + '_prev'] = bot_data['alive']

    # ================================================================
    # 1. KILL TIMELINE
    # ================================================================
    print("\n" + "=" * 80)
    print("1. KILL TIMELINE")
    print("=" * 80)

    our_kills = 0
    their_kills = 0

    for k in sorted(kills, key=lambda x: x['tick']):
        vt = k['victim_team']
        if vt == "ENEMY":
            our_kills += 1
            marker = ">>> WE KILLED"
        elif vt == "US":
            their_kills += 1
            marker = "<<< THEY KILLED"
        else:
            marker = "--- ZONE KILLED"

        print(f"  Tick {k['tick']:4d} ({k['tick']/10:.1f}s): {marker} {bot_label(k['victim'])} "
              f"(killed by {bot_label(k['killer'])})")
        print(f"           Score after: US {our_kills}K - {their_kills}K THEM")

    print(f"\n  FINAL: US {our_kills} kills, THEM {their_kills} kills")

    # ================================================================
    # 2. FIRST BLOOD ANALYSIS
    # ================================================================
    print("\n" + "=" * 80)
    print("2. FIRST BLOOD ANALYSIS")
    print("=" * 80)

    if kills:
        fb = kills[0]
        print(f"  First blood at tick {fb['tick']} ({fb['tick']/10:.1f}s)")
        print(f"  {bot_label(fb['killer'])} killed {bot_label(fb['victim'])}")
        print(f"  Killer team: {fb['killer_team']}")

        # Positioning at first blood
        fb_tick = fb['tick']
        fb_frame = None
        for frame in frames:
            if frame['tick'] == fb_tick:
                fb_frame = frame
                break

        if fb_frame:
            print(f"\n  Positioning at first blood (tick {fb_tick}):")
            our_alive_pos = []
            enemy_alive_pos = []
            for bd in fb_frame['bots']:
                if bd['alive']:
                    pos = bd['position']
                    label = bot_label(bd['id'])
                    team = team_label(bd['id'])
                    print(f"    {label}: HP={bd['health']}, pos=({pos['x']:.0f}, {pos['y']:.0f}) [{team}]")
                    if team == "US":
                        our_alive_pos.append(pos)
                    else:
                        enemy_alive_pos.append(pos)

            # Pack spread analysis
            if len(our_alive_pos) >= 2:
                dists = []
                for i in range(len(our_alive_pos)):
                    for j in range(i+1, len(our_alive_pos)):
                        d = math.hypot(our_alive_pos[i]['x'] - our_alive_pos[j]['x'],
                                       our_alive_pos[i]['y'] - our_alive_pos[j]['y'])
                        dists.append(d)
                print(f"\n  Our pack spread: min={min(dists):.0f}u, max={max(dists):.0f}u, avg={sum(dists)/len(dists):.0f}u")

            if len(enemy_alive_pos) >= 2:
                dists = []
                for i in range(len(enemy_alive_pos)):
                    for j in range(i+1, len(enemy_alive_pos)):
                        d = math.hypot(enemy_alive_pos[i]['x'] - enemy_alive_pos[j]['x'],
                                       enemy_alive_pos[i]['y'] - enemy_alive_pos[j]['y'])
                        dists.append(d)
                print(f"  Enemy pack spread: min={min(dists):.0f}u, max={max(dists):.0f}u, avg={sum(dists)/len(dists):.0f}u")

    # ================================================================
    # 3. DAMAGE DISTRIBUTION
    # ================================================================
    print("\n" + "=" * 80)
    print("3. DAMAGE DISTRIBUTION")
    print("=" * 80)

    # Our damage dealt to each enemy
    print("\n  OUR DAMAGE DEALT (to each enemy):")
    our_total_dealt = 0
    for eid in sorted(enemy_ids):
        dmg_to = sum(dmg_attacker_to_target[(a, eid)] for a in our_ids)
        zone_dmg = dmg_attacker_to_target[('zone', eid)]
        our_total_dealt += dmg_to
        print(f"    → {bot_label(eid)}: {dmg_to} combat dmg + {zone_dmg} zone dmg")
    print(f"    TOTAL: {our_total_dealt} combat damage dealt")

    # Enemy damage dealt to each of ours
    print("\n  ENEMY DAMAGE DEALT (to each of ours):")
    enemy_total_dealt = 0
    for oid in sorted(our_ids):
        dmg_to = sum(dmg_attacker_to_target[(a, oid)] for a in enemy_ids)
        zone_dmg = dmg_attacker_to_target[('zone', oid)]
        enemy_total_dealt += dmg_to
        print(f"    → {bot_label(oid)}: {dmg_to} combat dmg + {zone_dmg} zone dmg")
    print(f"    TOTAL: {enemy_total_dealt} combat damage dealt")

    # Focus fire analysis: how many targets each team hit
    print("\n  FOCUS FIRE ANALYSIS:")
    our_targets = defaultdict(int)  # target_id -> dmg from us
    enemy_targets = defaultdict(int)  # target_id -> dmg from them

    for (atk, tgt), dmg in dmg_attacker_to_target.items():
        if atk in our_ids:
            our_targets[tgt] += dmg
        elif atk in enemy_ids:
            enemy_targets[tgt] += dmg

    our_target_list = sorted(our_targets.items(), key=lambda x: -x[1])
    enemy_target_list = sorted(enemy_targets.items(), key=lambda x: -x[1])

    print(f"  Our damage spread across {len(our_target_list)} targets:")
    for tgt, dmg in our_target_list:
        pct = dmg / our_total_dealt * 100 if our_total_dealt > 0 else 0
        print(f"    {bot_label(tgt)}: {dmg} ({pct:.0f}%)")

    print(f"\n  Enemy damage spread across {len(enemy_target_list)} targets:")
    for tgt, dmg in enemy_target_list:
        pct = dmg / enemy_total_dealt * 100 if enemy_total_dealt > 0 else 0
        print(f"    {bot_label(tgt)}: {dmg} ({pct:.0f}%)")

    # Per-attacker breakdown
    print("\n  PER-BOT DAMAGE DEALT:")
    print("  Our bots:")
    for bid in sorted(our_ids):
        total = sum(dmg_attacker_to_target[(bid, t)] for t in enemy_ids)
        targets = [(t, dmg_attacker_to_target[(bid, t)]) for t in enemy_ids if dmg_attacker_to_target[(bid, t)] > 0]
        targets.sort(key=lambda x: -x[1])
        target_str = ", ".join(f"{bot_label(t)}:{d}" for t, d in targets)
        print(f"    {bot_label(bid)}: {total} total → [{target_str}]")

    print("  Enemy bots:")
    for bid in sorted(enemy_ids):
        total = sum(dmg_attacker_to_target[(bid, t)] for t in our_ids)
        targets = [(t, dmg_attacker_to_target[(bid, t)]) for t in our_ids if dmg_attacker_to_target[(bid, t)] > 0]
        targets.sort(key=lambda x: -x[1])
        target_str = ", ".join(f"{bot_label(t)}:{d}" for t, d in targets)
        print(f"    {bot_label(bid)}: {total} total → [{target_str}]")

    # ================================================================
    # 3b. HP SNAPSHOTS OVER TIME
    # ================================================================
    print("\n  HP SNAPSHOTS:")
    key_ticks = sorted(snapshot_ticks & set(hp_snapshots.keys()))
    # Show subset
    show_ticks = [t for t in key_ticks if t % 50 == 0 or t in [k['tick'] for k in kills]]
    show_ticks = sorted(set(show_ticks))

    for tick in show_ticks:
        snap = hp_snapshots.get(tick, {})
        if not snap:
            continue
        our_hp = []
        enemy_hp = []
        for bid, info in snap.items():
            hp_str = f"{info['hp']}" if info['alive'] else "DEAD"
            if bid in our_ids:
                our_hp.append((bot_label(bid), hp_str))
            else:
                enemy_hp.append((bot_label(bid), hp_str))

        our_str = " | ".join(f"{n}:{h}" for n, h in sorted(our_hp))
        enemy_str = " | ".join(f"{n}:{h}" for n, h in sorted(enemy_hp))
        our_total_hp = sum(info['hp'] for bid, info in snap.items() if bid in our_ids and info['alive'])
        enemy_total_hp = sum(info['hp'] for bid, info in snap.items() if bid in enemy_ids and info['alive'])
        print(f"  Tick {tick:4d}: US({our_total_hp}hp) [{our_str}]")
        print(f"           THEM({enemy_total_hp}hp) [{enemy_str}]")

    # ================================================================
    # 4. POSITIONING ANALYSIS
    # ================================================================
    print("\n" + "=" * 80)
    print("4. POSITIONING ANALYSIS")
    print("=" * 80)

    # Analyze at key moments: tick 0, first contact, first kill, midgame, endgame
    analysis_ticks = [0]
    if kills:
        analysis_ticks.append(kills[0]['tick'])
    analysis_ticks.extend([50, 100, 150, 200, 250])
    analysis_ticks = sorted(set(t for t in analysis_ticks if t < total_ticks))

    for tick in analysis_ticks:
        frame = frames[tick] if tick < len(frames) else None
        if not frame:
            continue

        zone = frame.get('zone', {})
        zr = zone.get('radius', 1024)
        zx = zone.get('centerX', zone.get('center', {}).get('x', 1024))
        zy = zone.get('centerY', zone.get('center', {}).get('y', 1024))

        our_pos = []
        enemy_pos = []
        for bd in frame['bots']:
            if not bd['alive']:
                continue
            pos = bd['position']
            dist_to_center = math.hypot(pos['x'] - zx, pos['y'] - zy)
            outside_zone = dist_to_center > zr
            if bd['id'] in our_ids:
                our_pos.append({'id': bd['id'], 'pos': pos, 'hp': bd['health'], 'dist_zone': dist_to_center, 'outside': outside_zone})
            else:
                enemy_pos.append({'id': bd['id'], 'pos': pos, 'hp': bd['health'], 'dist_zone': dist_to_center, 'outside': outside_zone})

        print(f"\n  Tick {tick} (zone radius={zr:.0f}):")

        # Our team centroid
        if our_pos:
            cx = sum(p['pos']['x'] for p in our_pos) / len(our_pos)
            cy = sum(p['pos']['y'] for p in our_pos) / len(our_pos)

            max_spread = 0
            for i in range(len(our_pos)):
                for j in range(i+1, len(our_pos)):
                    d = math.hypot(our_pos[i]['pos']['x'] - our_pos[j]['pos']['x'],
                                   our_pos[i]['pos']['y'] - our_pos[j]['pos']['y'])
                    max_spread = max(max_spread, d)

            outside_count = sum(1 for p in our_pos if p['outside'])
            print(f"    OUR TEAM ({len(our_pos)} alive): centroid=({cx:.0f},{cy:.0f}), max_spread={max_spread:.0f}u, "
                  f"outside_zone={outside_count}")

        if enemy_pos:
            cx = sum(p['pos']['x'] for p in enemy_pos) / len(enemy_pos)
            cy = sum(p['pos']['y'] for p in enemy_pos) / len(enemy_pos)

            max_spread = 0
            for i in range(len(enemy_pos)):
                for j in range(i+1, len(enemy_pos)):
                    d = math.hypot(enemy_pos[i]['pos']['x'] - enemy_pos[j]['pos']['x'],
                                   enemy_pos[i]['pos']['y'] - enemy_pos[j]['pos']['y'])
                    max_spread = max(max_spread, d)

            outside_count = sum(1 for p in enemy_pos if p['outside'])
            print(f"    ENEMY ({len(enemy_pos)} alive): centroid=({cx:.0f},{cy:.0f}), max_spread={max_spread:.0f}u, "
                  f"outside_zone={outside_count}")

    # ================================================================
    # 5. ABILITY USAGE
    # ================================================================
    print("\n" + "=" * 80)
    print("5. ABILITY USAGE")
    print("=" * 80)

    print(f"  Total abilities fired: US={abilities_by_team['US']}, ENEMY={abilities_by_team['ENEMY']}")

    # Track multi-hit abilities
    # Group damage events by tick and attacker to detect multi-hit abilities
    ability_ticks_us = defaultdict(list)
    ability_ticks_enemy = defaultdict(list)

    for d in damage_log:
        if d['damage'] == 15:  # ability damage
            if d['attacker_team'] == 'US':
                ability_ticks_us[d['tick']].append(d)
            elif d['attacker_team'] == 'ENEMY':
                ability_ticks_enemy[d['tick']].append(d)

    # Count multi-hit abilities
    us_multi = 0
    us_single = 0
    for tick, events in ability_ticks_us.items():
        # Group by attacker
        by_attacker = defaultdict(list)
        for e in events:
            by_attacker[e['attacker']].append(e)
        for atk, hits in by_attacker.items():
            if len(hits) >= 2:
                us_multi += 1
            else:
                us_single += 1

    enemy_multi = 0
    enemy_single = 0
    for tick, events in ability_ticks_enemy.items():
        by_attacker = defaultdict(list)
        for e in events:
            by_attacker[e['attacker']].append(e)
        for atk, hits in by_attacker.items():
            if len(hits) >= 2:
                enemy_multi += 1
            else:
                enemy_single += 1

    print(f"  Multi-hit abilities (2+ targets): US={us_multi}, ENEMY={enemy_multi}")
    print(f"  Single-hit abilities: US={us_single}, ENEMY={enemy_single}")

    # Ability timeline
    print("\n  Ability timeline (first 20):")
    for ab in ability_log[:20]:
        print(f"    Tick {ab['tick']:4d}: {bot_label(ab['bot'])} [{ab['team']}] → ({ab['target_pos'].get('x', 0):.0f}, {ab['target_pos'].get('y', 0):.0f})")

    # Total damage from abilities vs melee
    us_ability_dmg = sum(d['damage'] for d in damage_log if d['attacker_team'] == 'US' and d['damage'] == 15)
    us_melee_dmg = sum(d['damage'] for d in damage_log if d['attacker_team'] == 'US' and d['damage'] == 10 and d['attacker'] != 'zone')
    enemy_ability_dmg = sum(d['damage'] for d in damage_log if d['attacker_team'] == 'ENEMY' and d['damage'] == 15)
    enemy_melee_dmg = sum(d['damage'] for d in damage_log if d['attacker_team'] == 'ENEMY' and d['damage'] == 10 and d['attacker'] != 'zone')

    print(f"\n  Damage by type:")
    print(f"    US:    Ability={us_ability_dmg}, Melee={us_melee_dmg}, Total={us_ability_dmg + us_melee_dmg}")
    print(f"    ENEMY: Ability={enemy_ability_dmg}, Melee={enemy_melee_dmg}, Total={enemy_ability_dmg + enemy_melee_dmg}")

    # ================================================================
    # 6. CRITICAL MOMENT ANALYSIS
    # ================================================================
    print("\n" + "=" * 80)
    print("6. CRITICAL MOMENT ANALYSIS")
    print("=" * 80)

    # Track HP advantage over time
    hp_advantage = []
    for frame in frames:
        tick = frame['tick']
        our_hp = sum(bd['health'] for bd in frame['bots'] if bd['id'] in our_ids and bd['alive'])
        enemy_hp = sum(bd['health'] for bd in frame['bots'] if bd['id'] in enemy_ids and bd['alive'])
        our_alive = sum(1 for bd in frame['bots'] if bd['id'] in our_ids and bd['alive'])
        enemy_alive = sum(1 for bd in frame['bots'] if bd['id'] in enemy_ids and bd['alive'])
        hp_advantage.append({
            'tick': tick,
            'our_hp': our_hp,
            'enemy_hp': enemy_hp,
            'our_alive': our_alive,
            'enemy_alive': enemy_alive,
            'hp_diff': our_hp - enemy_hp,
        })

    # Find the swing point: where HP advantage changed most dramatically
    max_swing = 0
    swing_tick = 0
    for i in range(10, len(hp_advantage)):
        window = 10
        if i >= window:
            swing = hp_advantage[i-window]['hp_diff'] - hp_advantage[i]['hp_diff']
            if swing > max_swing:
                max_swing = swing
                swing_tick = hp_advantage[i]['tick']

    print(f"\n  Largest HP swing against us: {max_swing:.0f} HP over 10 ticks, ending at tick {swing_tick}")

    # Show HP advantage at key moments
    print("\n  HP Advantage timeline (positive = we're ahead):")
    for ha in hp_advantage:
        if ha['tick'] % 25 == 0 or ha['tick'] in [k['tick'] for k in kills]:
            marker = ""
            for k in kills:
                if k['tick'] == ha['tick']:
                    marker = f" *** {bot_label(k['victim'])} killed"
            print(f"    Tick {ha['tick']:4d}: US {ha['our_hp']:3d}hp ({ha['our_alive']}alive) vs "
                  f"THEM {ha['enemy_hp']:3d}hp ({ha['enemy_alive']}alive) | diff={ha['hp_diff']:+d}{marker}")

    # Identify the critical window
    if kills:
        # Find the tick range where we went from even/ahead to behind
        behind_since = None
        for ha in hp_advantage:
            if ha['hp_diff'] < -50 and behind_since is None:
                behind_since = ha['tick']

        first_our_death = None
        first_enemy_death = None
        for k in kills:
            if k['victim_team'] == 'US' and first_our_death is None:
                first_our_death = k['tick']
            if k['victim_team'] == 'ENEMY' and first_enemy_death is None:
                first_enemy_death = k['tick']

        print(f"\n  CRITICAL MOMENTS:")
        if first_our_death:
            print(f"    First time we lost a bot: tick {first_our_death}")
        if first_enemy_death:
            print(f"    First time enemy lost a bot: tick {first_enemy_death}")
        if behind_since:
            print(f"    First time we fell behind by 50+ HP: tick {behind_since}")

        # Show detailed damage in the critical window around the swing
        if swing_tick > 0:
            critical_start = max(0, swing_tick - 15)
            critical_end = min(total_ticks, swing_tick + 5)
            print(f"\n  DETAILED EVENTS in critical window (tick {critical_start}-{critical_end}):")
            for d in damage_log:
                if critical_start <= d['tick'] <= critical_end:
                    print(f"    Tick {d['tick']:4d}: {bot_label(d['attacker'])} → {bot_label(d['target'])} "
                          f"for {d['damage']} dmg")

    # ================================================================
    # 7. ENGAGEMENT PATTERN (first contact)
    # ================================================================
    print("\n" + "=" * 80)
    print("7. ENGAGEMENT PATTERN")
    print("=" * 80)

    # Find first combat damage (non-zone)
    first_combat = None
    for d in damage_log:
        if d['attacker'] != 'zone':
            first_combat = d
            break

    if first_combat:
        print(f"  First combat at tick {first_combat['tick']} ({first_combat['tick']/10:.1f}s)")
        print(f"  {bot_label(first_combat['attacker'])} hit {bot_label(first_combat['target'])} for {first_combat['damage']}")

    # Damage per 50-tick window
    print("\n  Damage per 50-tick window:")
    window_size = 50
    for start in range(0, total_ticks, window_size):
        end = start + window_size
        us_dmg = sum(d['damage'] for d in damage_log if start <= d['tick'] < end and d['attacker'] in our_ids)
        them_dmg = sum(d['damage'] for d in damage_log if start <= d['tick'] < end and d['attacker'] in enemy_ids)
        zone_us = sum(d['damage'] for d in damage_log if start <= d['tick'] < end and d['attacker'] == 'zone' and d['target'] in our_ids)
        zone_them = sum(d['damage'] for d in damage_log if start <= d['tick'] < end and d['attacker'] == 'zone' and d['target'] in enemy_ids)
        if us_dmg > 0 or them_dmg > 0 or zone_us > 0 or zone_them > 0:
            print(f"    Tick {start:4d}-{end:4d}: US dealt {us_dmg:3d}, THEM dealt {them_dmg:3d} | "
                  f"Zone→US: {zone_us:3d}, Zone→THEM: {zone_them:3d}")

    # ================================================================
    # 8. DPS EFFICIENCY
    # ================================================================
    print("\n" + "=" * 80)
    print("8. DPS EFFICIENCY")
    print("=" * 80)

    # Count attack events (melee) per bot
    melee_attacks = defaultdict(int)
    for d in damage_log:
        if d['damage'] == 10 and d['attacker'] != 'zone':
            melee_attacks[d['attacker']] += 1

    ability_casts = defaultdict(int)
    for ab in ability_log:
        ability_casts[ab['bot']] += 1

    print("  Per-bot action counts:")
    print("  OUR BOTS:")
    for bid in sorted(our_ids):
        m = melee_attacks[bid]
        a = ability_casts[bid]
        total = m * 10 + sum(d['damage'] for d in damage_log if d['attacker'] == bid)
        # Calculate theoretical max: melee every 5 ticks + ability every 30 ticks
        # from first contact to end
        print(f"    {bot_label(bid)}: {m} melee attacks, {a} abilities, {dmg_dealt_by[bid]} total dmg")

    print("  ENEMY BOTS:")
    for bid in sorted(enemy_ids):
        m = melee_attacks[bid]
        a = ability_casts[bid]
        print(f"    {bot_label(bid)}: {m} melee attacks, {a} abilities, {dmg_dealt_by[bid]} total dmg")

    print("\n" + "=" * 80)
    print("END OF ANALYSIS")
    print("=" * 80)

    return {
        'match_id': match_id,
        'enemy': enemy_agent_name,
        'our_kills': our_kills,
        'their_kills': their_kills,
        'our_total_dealt': our_total_dealt,
        'enemy_total_dealt': enemy_total_dealt,
        'abilities_us': abilities_by_team['US'],
        'abilities_enemy': abilities_by_team['ENEMY'],
        'total_ticks': total_ticks,
        'kills': kills,
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 analyze-replay.py <replay.json>")
        sys.exit(1)

    analyze_replay(sys.argv[1])
