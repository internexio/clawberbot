#!/usr/bin/env python3
"""
Analyze loss replay files for clawberbot.
Reads all match-history/replay-loss-*.json files and produces per-match
and cross-match analysis of positioning, abilities, deaths, and terrain traps.
"""

import json
import glob
import math
import os
from collections import defaultdict

OUR_AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
REPLAY_PATTERN = "match-history/replay-loss-*.json"

# --- Helpers ---

def dist(a, b):
    return math.sqrt((a['x'] - b['x'])**2 + (a['y'] - b['y'])**2)

def nearest_ally_dist(bot_id, bot_positions, team_ids):
    """Nearest alive ally distance for a given bot."""
    pos = bot_positions.get(bot_id)
    if pos is None:
        return None
    dists = []
    for aid in team_ids:
        if aid == bot_id:
            continue
        apos = bot_positions.get(aid)
        if apos is None:
            continue
        dists.append(dist(pos, apos))
    return min(dists) if dists else None

def nearest_enemy_dist(bot_id, bot_positions, enemy_ids):
    """Nearest alive enemy distance for a given bot."""
    pos = bot_positions.get(bot_id)
    if pos is None:
        return None
    dists = []
    for eid in enemy_ids:
        epos = bot_positions.get(eid)
        if epos is None:
            continue
        dists.append(dist(pos, epos))
    return min(dists) if dists else None

def team_spread(bot_positions, team_ids):
    """Max pairwise distance among alive team bots."""
    alive_positions = [bot_positions[bid] for bid in team_ids if bid in bot_positions]
    if len(alive_positions) < 2:
        return 0
    max_d = 0
    for i in range(len(alive_positions)):
        for j in range(i+1, len(alive_positions)):
            max_d = max(max_d, dist(alive_positions[i], alive_positions[j]))
    return max_d


def analyze_replay(filepath):
    """Analyze a single replay file and return a dict of metrics."""
    with open(filepath) as f:
        data = json.load(f)

    match_id = data['matchId']
    map_id = data.get('mapId', 'unknown')
    duration = data.get('duration', 0)
    winner_id = data.get('winner', '')

    # Identify teams
    our_bot_ids = set()
    enemy_bot_ids = set()
    enemy_agent_id = None
    enemy_name = "unknown"
    for bot in data['bots']:
        if bot['agentId'] == OUR_AGENT_ID:
            our_bot_ids.add(bot['id'])
        else:
            enemy_bot_ids.add(bot['id'])
            enemy_agent_id = bot['agentId']
            enemy_name = bot['name'].rsplit(' #', 1)[0]

    # Confirm we lost
    we_won = winner_id in our_bot_ids  # winner is a bot ID

    # --- Tracking state ---
    # Ability events
    our_abilities = []   # list of tick numbers
    enemy_abilities = []
    our_melee = []
    enemy_melee = []
    our_ability_damage = 0
    enemy_ability_damage = 0
    our_melee_damage = 0
    enemy_melee_damage = 0
    our_zone_damage = 0
    enemy_zone_damage = 0

    # Deaths
    our_deaths = []      # list of (tick, bot_id)
    enemy_deaths = []

    # Per-tick position tracking for oscillation detection
    # bot_id -> list of (tick, x, y)
    position_history = defaultdict(list)

    # Distance accumulators
    ally_dists_early = []      # ticks 0-40
    ally_dists_mid = []        # ticks 40-80
    ally_dists_all = []
    enemy_dists_early = []     # ticks 0-40
    team_spread_early = []
    team_spread_all = []

    # HP tracking
    our_hp_at_50 = {}
    enemy_hp_at_50 = {}

    # Alive tracking
    our_alive = set(our_bot_ids)
    enemy_alive = set(enemy_bot_ids)

    # Per-bot damage taken tracking
    damage_taken = defaultdict(int)  # bot_id -> total damage

    # Spawn positions
    our_spawn_positions = {}
    enemy_spawn_positions = {}

    for frame in data['frames']:
        tick = frame['tick']
        bot_states = {b['id']: b for b in frame['bots']}

        # Build alive position maps
        our_alive_positions = {}
        enemy_alive_positions = {}
        for b in frame['bots']:
            if b['alive']:
                if b['id'] in our_bot_ids:
                    our_alive_positions[b['id']] = b['position']
                elif b['id'] in enemy_bot_ids:
                    enemy_alive_positions[b['id']] = b['position']

        # Record spawn positions (tick 0)
        if tick == 0:
            for bid in our_bot_ids:
                if bid in bot_states:
                    our_spawn_positions[bid] = bot_states[bid]['position']
            for bid in enemy_bot_ids:
                if bid in bot_states:
                    enemy_spawn_positions[bid] = bot_states[bid]['position']

        # Record positions for oscillation detection
        for bid in our_bot_ids:
            if bid in our_alive_positions:
                p = our_alive_positions[bid]
                position_history[bid].append((tick, p['x'], p['y']))

        # Compute distances for alive bots
        for bid in our_alive_positions:
            ad = nearest_ally_dist(bid, our_alive_positions, our_bot_ids & set(our_alive_positions.keys()))
            ed = nearest_enemy_dist(bid, {**our_alive_positions, **enemy_alive_positions}, enemy_bot_ids & set(enemy_alive_positions.keys()))
            if ad is not None:
                ally_dists_all.append(ad)
                if tick <= 40:
                    ally_dists_early.append(ad)
                elif tick <= 80:
                    ally_dists_mid.append(ad)
            if ed is not None and tick <= 40:
                enemy_dists_early.append(ed)

        # Team spread
        ts = team_spread(our_alive_positions, our_bot_ids & set(our_alive_positions.keys()))
        team_spread_all.append(ts)
        if tick <= 40:
            team_spread_early.append(ts)

        # HP at tick 50
        if tick == 50:
            for bid in our_bot_ids:
                if bid in bot_states:
                    our_hp_at_50[bid] = bot_states[bid]['health']
            for bid in enemy_bot_ids:
                if bid in bot_states:
                    enemy_hp_at_50[bid] = bot_states[bid]['health']

        # Process events
        for ev in frame.get('events', []):
            if ev['type'] == 'ability':
                bot_id = ev['botId']
                if bot_id in our_bot_ids:
                    our_abilities.append(tick)
                elif bot_id in enemy_bot_ids:
                    enemy_abilities.append(tick)

            elif ev['type'] == 'damage':
                attacker = ev.get('attackerId', '')
                target = ev['targetId']
                dmg = ev['damage']
                damage_taken[target] += dmg

                if attacker == 'zone':
                    if target in our_bot_ids:
                        our_zone_damage += dmg
                    else:
                        enemy_zone_damage += dmg
                elif dmg == 15:
                    # Ability damage
                    if attacker in our_bot_ids:
                        our_ability_damage += dmg
                    elif attacker in enemy_bot_ids:
                        enemy_ability_damage += dmg
                elif dmg == 10:
                    # Melee damage
                    if attacker in our_bot_ids:
                        our_melee.append(tick)
                        our_melee_damage += dmg
                    elif attacker in enemy_bot_ids:
                        enemy_melee.append(tick)
                        enemy_melee_damage += dmg
                else:
                    # Other damage values (shouldn't normally happen)
                    if attacker in our_bot_ids:
                        our_melee_damage += dmg
                    elif attacker in enemy_bot_ids:
                        enemy_melee_damage += dmg

            elif ev['type'] == 'kill':
                victim = ev['victimId']
                if victim in our_bot_ids:
                    our_deaths.append((tick, victim))
                    our_alive.discard(victim)
                elif victim in enemy_bot_ids:
                    enemy_deaths.append((tick, victim))
                    enemy_alive.discard(victim)

    # --- Oscillation detection ---
    # A bot is oscillating if its displacement over N ticks is < threshold
    # while it's still alive and moving (not dead)
    oscillation_suspects = []
    for bid, positions in position_history.items():
        if len(positions) < 10:
            continue
        # Check 10-tick windows where displacement < 20u (essentially stuck)
        stuck_windows = []
        for i in range(len(positions) - 10):
            t_start, x_start, y_start = positions[i]
            t_end, x_end, y_end = positions[i + 10]
            displacement = math.sqrt((x_end - x_start)**2 + (y_end - y_start)**2)
            # Check that bot actually moved tick-to-tick (not just dead/idle)
            tick_movements = []
            for j in range(i, i + 10):
                t1, x1, y1 = positions[j]
                t2, x2, y2 = positions[j + 1]
                tick_movements.append(math.sqrt((x2 - x1)**2 + (y2 - y1)**2))
            avg_tick_move = sum(tick_movements) / len(tick_movements) if tick_movements else 0
            # Stuck = low displacement but some movement (oscillating, not idle)
            if displacement < 24 and avg_tick_move > 2:
                stuck_windows.append({
                    'start_tick': t_start,
                    'end_tick': t_end,
                    'displacement': round(displacement, 1),
                    'avg_tick_move': round(avg_tick_move, 1),
                    'position': (round(x_start, 0), round(y_start, 0))
                })

        # Merge overlapping windows
        if stuck_windows:
            merged = [stuck_windows[0]]
            for w in stuck_windows[1:]:
                if w['start_tick'] <= merged[-1]['end_tick'] + 5:
                    merged[-1]['end_tick'] = w['end_tick']
                    merged[-1]['displacement'] = min(merged[-1]['displacement'], w['displacement'])
                else:
                    merged.append(w)
            # Only report windows longer than 15 ticks
            for m in merged:
                duration_ticks = m['end_tick'] - m['start_tick']
                if duration_ticks >= 15:
                    oscillation_suspects.append({
                        'bot_id': bid,
                        'start_tick': m['start_tick'],
                        'end_tick': m['end_tick'],
                        'duration_ticks': duration_ticks,
                        'position': m['position'],
                        'avg_tick_move': m['avg_tick_move'],
                        'displacement': m['displacement']
                    })

    # --- Spawn spread ---
    our_spawn_spread = 0
    if our_spawn_positions:
        sp = list(our_spawn_positions.values())
        for i in range(len(sp)):
            for j in range(i+1, len(sp)):
                d = dist(sp[i], sp[j])
                our_spawn_spread = max(our_spawn_spread, d)

    enemy_spawn_spread = 0
    if enemy_spawn_positions:
        sp = list(enemy_spawn_positions.values())
        for i in range(len(sp)):
            for j in range(i+1, len(sp)):
                d = dist(sp[i], sp[j])
                enemy_spawn_spread = max(enemy_spawn_spread, d)

    # --- Summary stats ---
    our_total_damage = our_ability_damage + our_melee_damage
    enemy_total_damage = enemy_ability_damage + enemy_melee_damage

    # Final HP
    last_frame = data['frames'][-1]
    our_final_hp = sum(b['health'] for b in last_frame['bots'] if b['id'] in our_bot_ids)
    enemy_final_hp = sum(b['health'] for b in last_frame['bots'] if b['id'] in enemy_bot_ids)
    our_alive_final = sum(1 for b in last_frame['bots'] if b['id'] in our_bot_ids and b['alive'])
    enemy_alive_final = sum(1 for b in last_frame['bots'] if b['id'] in enemy_bot_ids and b['alive'])

    return {
        'file': os.path.basename(filepath),
        'match_id': match_id,
        'map': map_id,
        'duration_ticks': duration,
        'duration_sec': round(duration / 10, 1),
        'enemy_name': enemy_name,
        'we_won': we_won,
        'our_spawn_spread': round(our_spawn_spread),
        'enemy_spawn_spread': round(enemy_spawn_spread),

        # Deaths
        'our_deaths': our_deaths,
        'enemy_deaths': enemy_deaths,
        'our_first_death_tick': our_deaths[0][0] if our_deaths else None,
        'enemy_first_death_tick': enemy_deaths[0][0] if enemy_deaths else None,
        'our_deaths_before_40': sum(1 for t, _ in our_deaths if t <= 40),
        'our_deaths_before_80': sum(1 for t, _ in our_deaths if t <= 80),
        'our_alive_final': our_alive_final,
        'enemy_alive_final': enemy_alive_final,

        # Abilities
        'our_ability_count': len(our_abilities),
        'enemy_ability_count': len(enemy_abilities),
        'our_first_ability_tick': min(our_abilities) if our_abilities else None,
        'enemy_first_ability_tick': min(enemy_abilities) if enemy_abilities else None,
        'our_ability_ticks': our_abilities,
        'enemy_ability_ticks': enemy_abilities,

        # Melee
        'our_melee_count': len(our_melee),
        'enemy_melee_count': len(enemy_melee),

        # Damage
        'our_ability_damage': our_ability_damage,
        'enemy_ability_damage': enemy_ability_damage,
        'our_melee_damage': our_melee_damage,
        'enemy_melee_damage': enemy_melee_damage,
        'our_zone_damage': our_zone_damage,
        'enemy_zone_damage': enemy_zone_damage,
        'our_total_combat_damage': our_total_damage,
        'enemy_total_combat_damage': enemy_total_damage,

        # HP
        'our_hp_at_50': our_hp_at_50,
        'enemy_hp_at_50': enemy_hp_at_50,
        'our_total_hp_at_50': sum(our_hp_at_50.values()),
        'enemy_total_hp_at_50': sum(enemy_hp_at_50.values()),
        'our_final_hp': our_final_hp,
        'enemy_final_hp': enemy_final_hp,

        # Distances
        'avg_ally_dist_early': round(sum(ally_dists_early) / len(ally_dists_early), 1) if ally_dists_early else None,
        'avg_ally_dist_mid': round(sum(ally_dists_mid) / len(ally_dists_mid), 1) if ally_dists_mid else None,
        'avg_ally_dist_all': round(sum(ally_dists_all) / len(ally_dists_all), 1) if ally_dists_all else None,
        'avg_enemy_dist_early': round(sum(enemy_dists_early) / len(enemy_dists_early), 1) if enemy_dists_early else None,
        'avg_team_spread_early': round(sum(team_spread_early) / len(team_spread_early), 1) if team_spread_early else None,

        # Oscillation
        'oscillation_suspects': oscillation_suspects,

        # Per-bot damage
        'damage_taken': dict(damage_taken),
    }


def print_match_report(r):
    """Print detailed report for one match."""
    print(f"\n{'='*80}")
    print(f"MATCH: {r['file']}")
    print(f"{'='*80}")
    print(f"  Match ID:    {r['match_id']}")
    print(f"  Map:         {r['map']}")
    print(f"  Opponent:    {r['enemy_name']}")
    print(f"  Duration:    {r['duration_ticks']} ticks ({r['duration_sec']}s)")
    print(f"  Result:      {'WIN' if r['we_won'] else 'LOSS'}")
    print(f"  Final score: Us {r['our_alive_final']} alive ({r['our_final_hp']} HP) vs Enemy {r['enemy_alive_final']} alive ({r['enemy_final_hp']} HP)")
    print()

    # Spawn spread
    print(f"  --- SPAWN ---")
    print(f"  Our spawn spread:    {r['our_spawn_spread']}u")
    print(f"  Enemy spawn spread:  {r['enemy_spawn_spread']}u")
    print()

    # Deaths
    print(f"  --- DEATHS ---")
    print(f"  Our deaths (tick):   {[(t, bid.split(':')[1]) for t, bid in r['our_deaths']]}")
    print(f"  Enemy deaths (tick): {[(t, bid.split(':')[1]) for t, bid in r['enemy_deaths']]}")
    print(f"  Our first death:     tick {r['our_first_death_tick']}")
    print(f"  Enemy first death:   tick {r['enemy_first_death_tick']}")
    print(f"  Our deaths before t40: {r['our_deaths_before_40']}")
    print(f"  Our deaths before t80: {r['our_deaths_before_80']}")
    print()

    # Abilities
    print(f"  --- ABILITIES ---")
    print(f"  Our ability count:   {r['our_ability_count']}")
    print(f"  Enemy ability count: {r['enemy_ability_count']}")
    print(f"  Our first ability:   tick {r['our_first_ability_tick']}")
    print(f"  Enemy first ability: tick {r['enemy_first_ability_tick']}")
    # Ability utilization: max possible = 5 bots * (duration / 30) casts
    max_possible = 5 * (r['duration_ticks'] // 30 + 1)
    our_util = round(100 * r['our_ability_count'] / max_possible, 1) if max_possible > 0 else 0
    enemy_util = round(100 * r['enemy_ability_count'] / max_possible, 1) if max_possible > 0 else 0
    print(f"  Our ability util:    {our_util}% ({r['our_ability_count']}/{max_possible} max)")
    print(f"  Enemy ability util:  {enemy_util}% ({r['enemy_ability_count']}/{max_possible} max)")
    print()

    # Melee
    print(f"  --- MELEE ---")
    print(f"  Our melee hits:      {r['our_melee_count']}")
    print(f"  Enemy melee hits:    {r['enemy_melee_count']}")
    print()

    # Damage
    print(f"  --- DAMAGE ---")
    print(f"  Our ability damage:  {r['our_ability_damage']}")
    print(f"  Enemy ability dmg:   {r['enemy_ability_damage']}")
    print(f"  Our melee damage:    {r['our_melee_damage']}")
    print(f"  Enemy melee damage:  {r['enemy_melee_damage']}")
    print(f"  Our zone damage:     {r['our_zone_damage']}")
    print(f"  Enemy zone damage:   {r['enemy_zone_damage']}")
    print(f"  Our combat total:    {r['our_total_combat_damage']}")
    print(f"  Enemy combat total:  {r['enemy_total_combat_damage']}")
    dmg_ratio = round(r['our_total_combat_damage'] / r['enemy_total_combat_damage'], 2) if r['enemy_total_combat_damage'] > 0 else 'inf'
    print(f"  Damage ratio (us/them): {dmg_ratio}")
    print()

    # HP
    print(f"  --- HP ---")
    print(f"  Our total HP at t50:   {r['our_total_hp_at_50']}")
    print(f"  Enemy total HP at t50: {r['enemy_total_hp_at_50']}")
    print()

    # Distances
    print(f"  --- DISTANCES ---")
    print(f"  Avg nearest ally (t0-40):  {r['avg_ally_dist_early']}u")
    print(f"  Avg nearest ally (t40-80): {r['avg_ally_dist_mid']}u")
    print(f"  Avg nearest ally (all):    {r['avg_ally_dist_all']}u")
    print(f"  Avg nearest enemy (t0-40): {r['avg_enemy_dist_early']}u")
    print(f"  Avg team spread (t0-40):   {r['avg_team_spread_early']}u")
    print()

    # Oscillation
    if r['oscillation_suspects']:
        print(f"  --- OSCILLATION / TERRAIN TRAP DETECTED ---")
        for osc in r['oscillation_suspects']:
            bot_num = osc['bot_id'].split(':')[1]
            print(f"  Bot #{bot_num}: stuck t{osc['start_tick']}-t{osc['end_tick']} ({osc['duration_ticks']} ticks) "
                  f"at ({osc['position'][0]}, {osc['position'][1]}) "
                  f"avg_move={osc['avg_tick_move']}u/tick, net_disp={osc['displacement']}u")
        print()
    else:
        print(f"  No oscillation/terrain traps detected.")
        print()


def print_cross_match_summary(results):
    """Print patterns across all losses."""
    print(f"\n{'='*80}")
    print(f"CROSS-MATCH PATTERN ANALYSIS ({len(results)} losses)")
    print(f"{'='*80}")

    # Averages
    avg = lambda key: sum(r[key] for r in results if r[key] is not None) / max(1, sum(1 for r in results if r[key] is not None))

    print(f"\n  --- AVERAGE METRICS ACROSS LOSSES ---")
    print(f"  Avg match duration:        {avg('duration_ticks'):.0f} ticks ({avg('duration_sec'):.1f}s)")
    print(f"  Avg our spawn spread:      {avg('our_spawn_spread'):.0f}u")
    print(f"  Avg enemy spawn spread:    {avg('enemy_spawn_spread'):.0f}u")
    print(f"  Avg ally dist early:       {avg('avg_ally_dist_early'):.1f}u")
    print(f"  Avg ally dist mid:         {avg('avg_ally_dist_mid'):.1f}u")
    print(f"  Avg ally dist all:         {avg('avg_ally_dist_all'):.1f}u")
    print(f"  Avg enemy dist early:      {avg('avg_enemy_dist_early'):.1f}u")
    print(f"  Avg team spread early:     {avg('avg_team_spread_early'):.1f}u")
    print(f"  Avg our ability count:     {avg('our_ability_count'):.1f}")
    print(f"  Avg enemy ability count:   {avg('enemy_ability_count'):.1f}")
    print(f"  Avg our melee count:       {avg('our_melee_count'):.1f}")
    print(f"  Avg enemy melee count:     {avg('enemy_melee_count'):.1f}")
    print(f"  Avg our combat damage:     {avg('our_total_combat_damage'):.0f}")
    print(f"  Avg enemy combat damage:   {avg('enemy_total_combat_damage'):.0f}")

    # Pattern checks
    print(f"\n  --- PATTERN CHECKS ---")

    # 1. Early deaths (before tick 40)?
    early_death_count = sum(r['our_deaths_before_40'] for r in results)
    matches_with_early_deaths = sum(1 for r in results if r['our_deaths_before_40'] > 0)
    print(f"\n  EARLY DEATHS (before tick 40):")
    print(f"    Total early deaths:    {early_death_count} across {matches_with_early_deaths}/{len(results)} matches")
    for r in results:
        if r['our_deaths_before_40'] > 0:
            deaths = [(t, bid.split(':')[1]) for t, bid in r['our_deaths'] if t <= 40]
            print(f"    {r['enemy_name']}: {deaths}")

    # 2. Spread out early (ally dist > 400u)?
    spread_matches = [(r['enemy_name'], r['avg_ally_dist_early']) for r in results if r['avg_ally_dist_early'] and r['avg_ally_dist_early'] > 400]
    print(f"\n  EXCESSIVE EARLY SPREAD (ally dist > 400u):")
    if spread_matches:
        for name, d in spread_matches:
            print(f"    {name}: {d}u")
    else:
        print(f"    None")

    # 3. Out-abilitied?
    print(f"\n  ABILITY GAP:")
    for r in results:
        gap = r['our_ability_count'] - r['enemy_ability_count']
        our_ad = r['our_ability_damage']
        en_ad = r['enemy_ability_damage']
        print(f"    vs {r['enemy_name']}: us {r['our_ability_count']} vs them {r['enemy_ability_count']} (gap={gap:+d}) "
              f"| dmg: us {our_ad} vs them {en_ad}")

    # 4. Terrain traps / oscillation
    print(f"\n  TERRAIN TRAPS / OSCILLATION:")
    any_osc = False
    for r in results:
        if r['oscillation_suspects']:
            any_osc = True
            for osc in r['oscillation_suspects']:
                bn = osc['bot_id'].split(':')[1]
                print(f"    {r['enemy_name']} ({r['map']}): Bot #{bn} stuck t{osc['start_tick']}-t{osc['end_tick']} "
                      f"({osc['duration_ticks']}t) at {osc['position']}")
    if not any_osc:
        print(f"    None detected")

    # 5. Zone damage comparison
    print(f"\n  ZONE DAMAGE:")
    for r in results:
        print(f"    vs {r['enemy_name']} ({r['map']}): us {r['our_zone_damage']} vs them {r['enemy_zone_damage']}")

    # 6. First ability timing
    print(f"\n  FIRST ABILITY TIMING:")
    for r in results:
        print(f"    vs {r['enemy_name']}: us tick {r['our_first_ability_tick']} vs them tick {r['enemy_first_ability_tick']}")

    # 7. Death order timeline
    print(f"\n  DEATH TIMELINE (all matches):")
    for r in results:
        all_deaths = []
        for t, bid in r['our_deaths']:
            all_deaths.append((t, f"US #{bid.split(':')[1]}"))
        for t, bid in r['enemy_deaths']:
            all_deaths.append((t, f"THEM #{bid.split(':')[1]}"))
        all_deaths.sort()
        print(f"    vs {r['enemy_name']} ({r['map']}, {r['duration_ticks']}t):")
        for t, label in all_deaths:
            print(f"      t{t:4d}: {label} dies")

    # 8. Per-opponent summary
    print(f"\n  --- PER-OPPONENT SUMMARY ---")
    opponents = defaultdict(list)
    for r in results:
        opponents[r['enemy_name']].append(r)
    for opp, matches in sorted(opponents.items()):
        print(f"\n  {opp} ({len(matches)} match{'es' if len(matches) > 1 else ''}):")
        for r in matches:
            print(f"    Map: {r['map']}, Duration: {r['duration_ticks']}t")
            print(f"    Spawn spread: us {r['our_spawn_spread']}u vs them {r['enemy_spawn_spread']}u")
            print(f"    Ally dist early: {r['avg_ally_dist_early']}u | Enemy dist early: {r['avg_enemy_dist_early']}u")
            print(f"    Abilities: us {r['our_ability_count']} vs them {r['enemy_ability_count']}")
            print(f"    Combat dmg: us {r['our_total_combat_damage']} vs them {r['enemy_total_combat_damage']}")
            print(f"    Zone dmg: us {r['our_zone_damage']} vs them {r['enemy_zone_damage']}")
            print(f"    Final: us {r['our_alive_final']}alive/{r['our_final_hp']}hp vs them {r['enemy_alive_final']}alive/{r['enemy_final_hp']}hp")
            our_died = r['our_first_death_tick']
            them_died = r['enemy_first_death_tick']
            print(f"    First death: us t{our_died} vs them t{them_died}")


def main():
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    files = sorted(glob.glob(REPLAY_PATTERN))
    if not files:
        print(f"No files matching {REPLAY_PATTERN}")
        return

    print(f"Found {len(files)} loss replay files:")
    for f in files:
        print(f"  {f}")

    results = []
    for filepath in files:
        r = analyze_replay(filepath)
        results.append(r)
        print_match_report(r)

    print_cross_match_summary(results)

if __name__ == "__main__":
    main()
