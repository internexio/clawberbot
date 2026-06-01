#!/usr/bin/env python3
"""
Full analysis of all 12 CrabCrusher-0308 replays.
Extracts convergence, first blood, ability usage, HP differential,
zone positioning, kill cascade, and spawn positions.
"""

import json
import math
import os
import glob
from collections import defaultdict

REPLAY_DIR = '/Users/davidpedersen/Mini/clawberbot/scouting/crabcrusher-0308/'
SEM_AGENT_ID = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'

def dist(a, b):
    return math.sqrt((a['x'] - b['x'])**2 + (a['y'] - b['y'])**2)

def centroid(positions):
    if not positions:
        return None
    return {'x': sum(p['x'] for p in positions) / len(positions),
            'y': sum(p['y'] for p in positions) / len(positions)}

def spread(positions):
    """Average pairwise distance as spread measure."""
    if len(positions) < 2:
        return 0
    c = centroid(positions)
    return sum(dist(p, c) for p in positions) / len(positions)

def get_frame_by_tick(frames, target_tick):
    """Get the closest frame at or before target_tick."""
    best = None
    for f in frames:
        if f['tick'] <= target_tick:
            best = f
        elif best is not None:
            break
    return best

def get_frame_exact(frames_dict, tick):
    """Get frame at exact tick, or None."""
    return frames_dict.get(tick)

def analyze_replay(filepath):
    filename = os.path.basename(filepath)
    outcome = 'W' if filename.startswith('W-') else 'L'

    with open(filepath, 'r') as f:
        data = json.load(f)

    # Identify teams from bots list
    sem_ids = set()
    cc_ids = set()
    for bot in data['bots']:
        if bot['agentId'] == SEM_AGENT_ID:
            sem_ids.add(bot['id'])
        else:
            cc_ids.add(bot['id'])

    # Build frame dict by tick for fast lookup
    frames_by_tick = {f['tick']: f for f in data['frames']}
    all_ticks = sorted(frames_by_tick.keys())
    max_tick = max(all_ticks)

    result = {
        'file': filename,
        'outcome': outcome,
        'match_id': data.get('matchId', '?'),
        'duration_ticks': max_tick,
        'winner': data.get('winner', '?'),
    }

    # --- Spawn positions (tick 0) ---
    f0 = frames_by_tick.get(0)
    if f0:
        sem_t0 = [b['position'] for b in f0['bots'] if b['id'] in sem_ids]
        cc_t0 = [b['position'] for b in f0['bots'] if b['id'] in cc_ids]
        result['sem_spawn_centroid'] = centroid(sem_t0)
        result['cc_spawn_centroid'] = centroid(cc_t0)
        result['sem_spawn_spread'] = round(spread(sem_t0), 1)
        result['cc_spawn_spread'] = round(spread(cc_t0), 1)
    else:
        result['sem_spawn_centroid'] = None
        result['cc_spawn_centroid'] = None

    # --- Convergence: avg distance to zone center at sample ticks ---
    sample_ticks = [0, 25, 50, 75, 100, 150, 200]
    result['convergence'] = {}
    for tick in sample_ticks:
        # Find closest frame at or before tick
        candidate_ticks = [t for t in all_ticks if t <= tick]
        if not candidate_ticks:
            continue
        ft = frames_by_tick[max(candidate_ticks)]
        zone = ft['zone']
        zc = {'x': zone['centerX'], 'y': zone['centerY']}
        zr = zone['radius']

        sem_bots = [b for b in ft['bots'] if b['id'] in sem_ids and b['alive']]
        cc_bots = [b for b in ft['bots'] if b['id'] in cc_ids and b['alive']]

        sem_dists = [dist(b['position'], zc) for b in sem_bots] if sem_bots else []
        cc_dists = [dist(b['position'], zc) for b in cc_bots] if cc_bots else []

        result['convergence'][tick] = {
            'sem_avg_dist': round(sum(sem_dists)/len(sem_dists), 1) if sem_dists else None,
            'cc_avg_dist': round(sum(cc_dists)/len(cc_dists), 1) if cc_dists else None,
            'zone_radius': round(zr, 1),
            'sem_alive': len(sem_bots),
            'cc_alive': len(cc_bots),
        }

    # --- First blood ---
    kills = []
    for frame in data['frames']:
        for ev in frame.get('events', []):
            if ev.get('type') == 'kill':
                killer_team = 'SEM' if ev['killerId'] in sem_ids else 'CC'
                victim_team = 'SEM' if ev['victimId'] in sem_ids else 'CC'
                kills.append({
                    'tick': frame['tick'],
                    'killer_team': killer_team,
                    'victim_team': victim_team,
                    'killer_id': ev['killerId'],
                    'victim_id': ev['victimId'],
                })

    result['kills'] = kills
    result['total_kills_sem'] = sum(1 for k in kills if k['killer_team'] == 'SEM')
    result['total_kills_cc'] = sum(1 for k in kills if k['killer_team'] == 'CC')

    if kills:
        fb = kills[0]
        result['first_blood_tick'] = fb['tick']
        result['first_blood_team'] = fb['killer_team']
        result['first_blood_victim_team'] = fb['victim_team']
        # Kill cascade: how quickly does second kill follow?
        if len(kills) >= 2:
            result['second_kill_tick'] = kills[1]['tick']
            result['second_kill_team'] = kills[1]['killer_team']
            result['kill_cascade_gap'] = kills[1]['tick'] - kills[0]['tick']
        else:
            result['second_kill_tick'] = None
            result['second_kill_team'] = None
            result['kill_cascade_gap'] = None
    else:
        result['first_blood_tick'] = None
        result['first_blood_team'] = None
        result['first_blood_victim_team'] = None
        result['second_kill_tick'] = None
        result['second_kill_team'] = None
        result['kill_cascade_gap'] = None

    # --- Ability usage ---
    ability_events = []
    for frame in data['frames']:
        for ev in frame.get('events', []):
            if ev.get('type') == 'ability':
                team = 'SEM' if ev['botId'] in sem_ids else 'CC'
                # Find the firing bot's position at this tick
                ft = frames_by_tick.get(frame['tick'])
                bot_pos = None
                if ft:
                    for b in ft['bots']:
                        if b['id'] == ev['botId']:
                            bot_pos = b['position']
                            break
                target = ev.get('targetPosition', {})
                cast_range = dist(bot_pos, target) if (bot_pos and target) else None
                ability_events.append({
                    'tick': frame['tick'],
                    'team': team,
                    'cast_range': cast_range,
                })

    sem_abilities = [a for a in ability_events if a['team'] == 'SEM']
    cc_abilities = [a for a in ability_events if a['team'] == 'CC']

    result['sem_abilities_total'] = len(sem_abilities)
    result['cc_abilities_total'] = len(cc_abilities)

    sem_ranges = [a['cast_range'] for a in sem_abilities if a['cast_range'] is not None]
    cc_ranges = [a['cast_range'] for a in cc_abilities if a['cast_range'] is not None]

    result['sem_ability_avg_range'] = round(sum(sem_ranges)/len(sem_ranges), 1) if sem_ranges else None
    result['cc_ability_avg_range'] = round(sum(cc_ranges)/len(cc_ranges), 1) if cc_ranges else None
    result['sem_ability_max_range'] = round(max(sem_ranges), 1) if sem_ranges else None
    result['cc_ability_max_range'] = round(max(cc_ranges), 1) if cc_ranges else None

    # --- HP differential at t=50 ---
    for tick_check in [50, 49, 48]:
        f50 = frames_by_tick.get(tick_check)
        if f50:
            sem_hp = sum(b['health'] for b in f50['bots'] if b['id'] in sem_ids and b['alive'])
            cc_hp = sum(b['health'] for b in f50['bots'] if b['id'] in cc_ids and b['alive'])
            result['sem_hp_t50'] = sem_hp
            result['cc_hp_t50'] = cc_hp
            result['hp_diff_t50'] = sem_hp - cc_hp  # positive = SEM advantage
            break

    # --- Zone positioning at first ability fired ---
    if ability_events:
        first_ability_tick = ability_events[0]['tick']
        fa_frame = frames_by_tick.get(first_ability_tick)
        if fa_frame:
            zone = fa_frame['zone']
            zc = {'x': zone['centerX'], 'y': zone['centerY']}
            sem_bots = [b for b in fa_frame['bots'] if b['id'] in sem_ids and b['alive']]
            cc_bots = [b for b in fa_frame['bots'] if b['id'] in cc_ids and b['alive']]
            sem_d = sum(dist(b['position'], zc) for b in sem_bots)/len(sem_bots) if sem_bots else None
            cc_d = sum(dist(b['position'], zc) for b in cc_bots)/len(cc_bots) if cc_bots else None
            result['first_ability_tick'] = first_ability_tick
            result['sem_dist_first_ability'] = round(sem_d, 1) if sem_d else None
            result['cc_dist_first_ability'] = round(cc_d, 1) if cc_d else None
            result['zone_advantage_first_ability'] = 'SEM' if (sem_d and cc_d and sem_d < cc_d) else 'CC'
    else:
        result['first_ability_tick'] = None
        result['sem_dist_first_ability'] = None
        result['cc_dist_first_ability'] = None
        result['zone_advantage_first_ability'] = None

    # --- Ammo at t=50 ---
    f50 = frames_by_tick.get(50) or frames_by_tick.get(49)
    if f50:
        sem_ammo = sum(b.get('ammo', 0) for b in f50['bots'] if b['id'] in sem_ids and b['alive'])
        cc_ammo = sum(b.get('ammo', 0) for b in f50['bots'] if b['id'] in cc_ids and b['alive'])
        result['sem_ammo_t50'] = sem_ammo
        result['cc_ammo_t50'] = cc_ammo

    # --- Final HP at match end ---
    last_frame = frames_by_tick[max_tick]
    sem_final_hp = sum(b['health'] for b in last_frame['bots'] if b['id'] in sem_ids and b['alive'])
    cc_final_hp = sum(b['health'] for b in last_frame['bots'] if b['id'] in cc_ids and b['alive'])
    sem_final_alive = sum(1 for b in last_frame['bots'] if b['id'] in sem_ids and b['alive'])
    cc_final_alive = sum(1 for b in last_frame['bots'] if b['id'] in cc_ids and b['alive'])
    result['sem_final_hp'] = sem_final_hp
    result['cc_final_hp'] = cc_final_hp
    result['sem_final_alive'] = sem_final_alive
    result['cc_final_alive'] = cc_final_alive

    # --- CC isolated bot detection at key ticks ---
    # Check if any CC bot is far from CC centroid (>400u) at t=50, t=75
    for check_tick in [50, 75]:
        ct = frames_by_tick.get(check_tick)
        if ct:
            cc_positions = [b['position'] for b in ct['bots'] if b['id'] in cc_ids and b['alive']]
            if len(cc_positions) >= 2:
                cc_c = centroid(cc_positions)
                cc_dists_from_c = [dist(p, cc_c) for p in cc_positions]
                result[f'cc_max_isolation_t{check_tick}'] = round(max(cc_dists_from_c), 1)
                result[f'cc_isolated_bot_t{check_tick}'] = any(d > 400 for d in cc_dists_from_c)
            else:
                result[f'cc_max_isolation_t{check_tick}'] = None
                result[f'cc_isolated_bot_t{check_tick}'] = False

    return result


def print_summary(results):
    wins = [r for r in results if r['outcome'] == 'W']
    losses = [r for r in results if r['outcome'] == 'L']

    print("=" * 100)
    print("FULL MATCH SUMMARY TABLE — ALL 12 REPLAYS")
    print("=" * 100)
    print(f"{'File':<50} {'Out'} {'Dur':>5} {'FB@':>5} {'FBTeam':<7} {'SEM_HP50':>8} {'CC_HP50':>8} {'DIFF':>6} {'SEM_Abl':>7} {'CC_Abl':>7} {'SEM_Rng':>7} {'CC_Rng':>7}")
    print("-" * 120)
    for r in sorted(results, key=lambda x: (x['outcome'], x['file'])):
        fb_tick = str(r.get('first_blood_tick', '?'))
        fb_team = r.get('first_blood_team', '?')
        sem_hp50 = str(r.get('sem_hp_t50', '?'))
        cc_hp50 = str(r.get('cc_hp_t50', '?'))
        diff = str(r.get('hp_diff_t50', '?'))
        sem_abl = str(r.get('sem_abilities_total', '?'))
        cc_abl = str(r.get('cc_abilities_total', '?'))
        sem_rng = str(r.get('sem_ability_avg_range', '?'))
        cc_rng = str(r.get('cc_ability_avg_range', '?'))
        print(f"{r['file']:<50} {r['outcome']:>3} {r['duration_ticks']:>5} {fb_tick:>5} {fb_team:<7} {sem_hp50:>8} {cc_hp50:>8} {diff:>6} {sem_abl:>7} {cc_abl:>7} {sem_rng:>7} {cc_rng:>7}")

    print()
    print("=" * 100)
    print("CONVERGENCE TABLE — avg dist to zone center per team (lower = more central)")
    print("=" * 100)
    print(f"{'File':<50} {'Out'} | {'t0 SEM':>7} {'t0 CC':>7} | {'t50 SEM':>7} {'t50 CC':>7} | {'t100 SEM':>8} {'t100 CC':>8} | {'IsoCC@50':>8} {'IsoCC@75':>8}")
    print("-" * 130)
    for r in sorted(results, key=lambda x: (x['outcome'], x['file'])):
        c = r.get('convergence', {})
        def cd(tick, team):
            d = c.get(tick, {})
            v = d.get(f'{team}_avg_dist')
            return str(round(v)) if v is not None else '?'
        iso50 = str(r.get('cc_max_isolation_t50', '?'))
        iso75 = str(r.get('cc_max_isolation_t75', '?'))
        print(f"{r['file']:<50} {r['outcome']:>3} | {cd(0,'sem'):>7} {cd(0,'cc'):>7} | {cd(50,'sem'):>7} {cd(50,'cc'):>7} | {cd(100,'sem'):>8} {cd(100,'cc'):>8} | {iso50:>8} {iso75:>8}")

    print()
    print("=" * 100)
    print("KILL TIMELINE")
    print("=" * 100)
    print(f"{'File':<50} {'Out'} {'FB@':>5} {'FB Winner':<12} {'2nd@':>5} {'2nd Winner':<12} {'Cascade':>7} {'SEMKills':>8} {'CCKills':>8}")
    print("-" * 120)
    for r in sorted(results, key=lambda x: (x['outcome'], x['file'])):
        fb = str(r.get('first_blood_tick', '?'))
        fbw = r.get('first_blood_team', '?')
        sk = str(r.get('second_kill_tick', '?'))
        skw = str(r.get('second_kill_team', '?'))
        casc = str(r.get('kill_cascade_gap', '?'))
        print(f"{r['file']:<50} {r['outcome']:>3} {fb:>5} {fbw:<12} {sk:>5} {skw:<12} {casc:>7} {r['total_kills_sem']:>8} {r['total_kills_cc']:>8}")

    print()
    print("=" * 100)
    print("ABILITY RANGE DETAIL")
    print("=" * 100)
    print(f"{'File':<50} {'Out'} {'SEM Avg':>7} {'SEM Max':>7} {'CC Avg':>7} {'CC Max':>7} {'FA Tick':>7} {'SEM@FA':>8} {'CC@FA':>8} {'Zone Adv':>9}")
    print("-" * 120)
    for r in sorted(results, key=lambda x: (x['outcome'], x['file'])):
        print(f"{r['file']:<50} {r['outcome']:>3} "
              f"{str(r.get('sem_ability_avg_range','?')):>7} "
              f"{str(r.get('sem_ability_max_range','?')):>7} "
              f"{str(r.get('cc_ability_avg_range','?')):>7} "
              f"{str(r.get('cc_ability_max_range','?')):>7} "
              f"{str(r.get('first_ability_tick','?')):>7} "
              f"{str(r.get('sem_dist_first_ability','?')):>8} "
              f"{str(r.get('cc_dist_first_ability','?')):>8} "
              f"{str(r.get('zone_advantage_first_ability','?')):>9}")

    print()
    print("=" * 100)
    print("STATISTICAL PATTERNS: WINS vs LOSSES")
    print("=" * 100)

    def avg(lst):
        lst = [x for x in lst if x is not None]
        return round(sum(lst)/len(lst), 1) if lst else None

    for label, group in [('WINS (n={})'.format(len(wins)), wins), ('LOSSES (n={})'.format(len(losses)), losses)]:
        print(f"\n--- {label} ---")
        print(f"  First blood tick (avg):    {avg([r.get('first_blood_tick') for r in group])}")
        print(f"  First blood by SEM:        {sum(1 for r in group if r.get('first_blood_team') == 'SEM')} / {len(group)}")
        print(f"  First blood by CC:         {sum(1 for r in group if r.get('first_blood_team') == 'CC')} / {len(group)}")
        print(f"  No first blood:            {sum(1 for r in group if r.get('first_blood_tick') is None)} / {len(group)}")
        print(f"  Kill cascade gap (avg):    {avg([r.get('kill_cascade_gap') for r in group])}")
        print(f"  HP diff at t50 (avg):      {avg([r.get('hp_diff_t50') for r in group])} (pos=SEM ahead)")
        print(f"  SEM HP at t50 (avg):       {avg([r.get('sem_hp_t50') for r in group])}")
        print(f"  CC HP at t50 (avg):        {avg([r.get('cc_hp_t50') for r in group])}")
        print(f"  SEM abilities total (avg): {avg([r.get('sem_abilities_total') for r in group])}")
        print(f"  CC abilities total (avg):  {avg([r.get('cc_abilities_total') for r in group])}")
        print(f"  SEM ability avg range:     {avg([r.get('sem_ability_avg_range') for r in group])}")
        print(f"  CC ability avg range:      {avg([r.get('cc_ability_avg_range') for r in group])}")
        print(f"  SEM ability max range:     {avg([r.get('sem_ability_max_range') for r in group])}")
        print(f"  CC ability max range:      {avg([r.get('cc_ability_max_range') for r in group])}")
        print(f"  SEM ammo at t50 (avg):     {avg([r.get('sem_ammo_t50') for r in group])}")
        print(f"  CC ammo at t50 (avg):      {avg([r.get('cc_ammo_t50') for r in group])}")

        # Convergence
        for tick in [0, 50, 100]:
            sem_d = avg([r['convergence'].get(tick, {}).get('sem_avg_dist') for r in group])
            cc_d = avg([r['convergence'].get(tick, {}).get('cc_avg_dist') for r in group])
            print(f"  Dist to zone center t={tick:<3}:  SEM={sem_d}  CC={cc_d}")

        print(f"  CC isolated bot at t50:    {sum(1 for r in group if r.get('cc_isolated_bot_t50'))} / {len(group)}")
        print(f"  CC isolated bot at t75:    {sum(1 for r in group if r.get('cc_isolated_bot_t75'))} / {len(group)}")
        print(f"  CC max isolation at t50:   {avg([r.get('cc_max_isolation_t50') for r in group])}")
        print(f"  Zone advantage at 1st abl: SEM={sum(1 for r in group if r.get('zone_advantage_first_ability')=='SEM')} CC={sum(1 for r in group if r.get('zone_advantage_first_ability')=='CC')}")
        print(f"  Match duration (avg):      {avg([r.get('duration_ticks') for r in group])}")

    # Detailed kill breakdowns
    print()
    print("=" * 100)
    print("KILL-BY-KILL TIMELINE (all matches)")
    print("=" * 100)
    for r in sorted(results, key=lambda x: (x['outcome'], x['file'])):
        kills_str = ', '.join([f"t{k['tick']}:{k['killer_team']}>{k['victim_team']}" for k in r['kills']])
        print(f"{r['outcome']} {r['file']:<55} | kills: {kills_str if kills_str else 'none'}")


def main():
    replay_files = sorted(glob.glob(os.path.join(REPLAY_DIR, '*.json')))
    print(f"Found {len(replay_files)} replay files\n")

    results = []
    for fp in replay_files:
        print(f"  Parsing {os.path.basename(fp)}...")
        r = analyze_replay(fp)
        results.append(r)

    print(f"\nParsed {len(results)} replays successfully.\n")
    print_summary(results)


if __name__ == '__main__':
    main()
