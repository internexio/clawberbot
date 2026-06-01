#!/usr/bin/env python3
"""Extract structured signals from CC loss replays.

Usage:
  ./analyze-cc-losses.py [replay_dir]

Produces a compact per-match summary + aggregate stats across all replays.
Designed to feed into KF debugging analysis.
"""
import json, sys, os, glob, math
from collections import Counter

OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'
CC_AGENT  = 'ef7e1954-e275-4882-933b-a423946442f5'

def avg(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs)/len(xs) if xs else 0

def dist(a, b):
    return math.hypot(a['x']-b['x'], a['y']-b['y'])

def analyze(path):
    d = json.load(open(path))
    bots = d['bots']
    frames = d['frames']
    cfg = d['gameConfig']

    our_ids = {b['id'] for b in bots if b['agentId'] == OUR_AGENT}
    cc_ids  = {b['id'] for b in bots if b['agentId'] == CC_AGENT}

    # Per-bot lifespan + killer
    death_tick = {bid: None for bid in our_ids | cc_ids}
    killer = {bid: None for bid in our_ids | cc_ids}

    # Ability casts and hits
    our_casts = 0; cc_casts = 0
    our_ability_hits = 0; cc_ability_hits = 0  # damage from ability events
    our_melee_hits = 0; cc_melee_hits = 0

    # Track damage attribution
    our_dmg = 0; cc_dmg = 0
    our_ability_dmg = 0; cc_ability_dmg = 0
    our_melee_dmg = 0; cc_melee_dmg = 0
    our_zone_dmg = 0; cc_zone_dmg = 0  # damage taken

    powerups_us = 0; powerups_cc = 0

    # Frame-by-frame: spread, distance to center, ammo
    our_spread = []
    cc_spread = []
    our_to_center = []
    cc_to_center = []
    our_ammo_curve = []  # avg ammo per side per tick
    cc_ammo_curve = []
    our_alive_curve = []
    cc_alive_curve = []
    inter_team_dist = []  # min distance between any our-bot and any cc-bot

    first_kill_tick = None
    first_kill_who = None  # 'us' or 'cc'

    for f in frames:
        tick = f['tick']
        # Bot state per side
        ours_alive = [b for b in f['bots'] if b['id'] in our_ids and b.get('alive')]
        cc_alive  = [b for b in f['bots'] if b['id'] in cc_ids and b.get('alive')]
        our_alive_curve.append(len(ours_alive))
        cc_alive_curve.append(len(cc_alive))
        our_ammo_curve.append(avg([b.get('ammo',0) for b in ours_alive]))
        cc_ammo_curve.append(avg([b.get('ammo',0) for b in cc_alive]))

        # Spread (avg pairwise distance among alive bots)
        def pair_dist(group):
            if len(group) < 2: return 0
            ds = []
            for i in range(len(group)):
                for j in range(i+1, len(group)):
                    ds.append(dist(group[i]['position'], group[j]['position']))
            return sum(ds)/len(ds)
        our_spread.append(pair_dist(ours_alive))
        cc_spread.append(pair_dist(cc_alive))

        # Distance to zone center
        zc = {'x': f['zone']['centerX'], 'y': f['zone']['centerY']}
        our_to_center.append(avg([dist(b['position'], zc) for b in ours_alive]))
        cc_to_center.append(avg([dist(b['position'], zc) for b in cc_alive]))

        # Inter-team min distance
        if ours_alive and cc_alive:
            md = min(dist(o['position'], c['position']) for o in ours_alive for c in cc_alive)
            inter_team_dist.append(md)

        # Events
        for e in f.get('events', []):
            t = e.get('type')
            if t == 'damage':
                aid, tid, dmg = e['attackerId'], e['targetId'], e['damage']
                if aid in our_ids and tid in cc_ids:
                    our_dmg += dmg
                    # Heuristic: ability dmg = 10, melee = 5
                    if dmg >= 10: our_ability_hits += 1; our_ability_dmg += dmg
                    else: our_melee_hits += 1; our_melee_dmg += dmg
                elif aid in cc_ids and tid in our_ids:
                    cc_dmg += dmg
                    if dmg >= 10: cc_ability_hits += 1; cc_ability_dmg += dmg
                    else: cc_melee_hits += 1; cc_melee_dmg += dmg
                elif aid == 'zone' or aid is None:
                    if tid in our_ids: our_zone_dmg += dmg
                    elif tid in cc_ids: cc_zone_dmg += dmg
            elif t == 'kill':
                tid = e.get('victimId') or e.get('targetId')
                aid = e.get('killerId') or e.get('attackerId')
                death_tick[tid] = tick
                killer[tid] = aid
                if first_kill_tick is None:
                    first_kill_tick = tick
                    first_kill_who = 'us' if aid in our_ids else 'cc'
            elif t == 'ability':
                aid = e.get('botId') or e.get('attackerId')
                if aid in our_ids: our_casts += 1
                elif aid in cc_ids: cc_casts += 1
            elif t == 'powerup_collect':
                bid = e.get('botId')
                if bid in our_ids: powerups_us += 1
                elif bid in cc_ids: powerups_cc += 1

    # Zone damage from non-attacker damage events: tally differently
    # (zone damage may have attackerId="zone" or be omitted — we already accumulated above)

    # Compute when each side hit 0 ammo (proxy: avg ammo < 1)
    def ammo_zero_tick(curve):
        for i, v in enumerate(curve):
            if v < 1: return i
        return None
    our_ammo_zero = ammo_zero_tick(our_ammo_curve)
    cc_ammo_zero = ammo_zero_tick(cc_ammo_curve)

    # Lifespan summary
    our_lifespans = [death_tick[b] if death_tick[b] is not None else len(frames) for b in our_ids]
    cc_lifespans  = [death_tick[b] if death_tick[b] is not None else len(frames) for b in cc_ids]
    our_killed = sum(1 for b in our_ids if death_tick[b] is not None)
    cc_killed  = sum(1 for b in cc_ids if death_tick[b] is not None)

    # Kill timings sorted
    our_deaths_sorted = sorted([death_tick[b] for b in our_ids if death_tick[b] is not None])
    cc_deaths_sorted  = sorted([death_tick[b] for b in cc_ids if death_tick[b] is not None])

    # Focus-fire detection: did CC kill our bots faster than we killed theirs?
    # Time from first damage on each killed bot to death
    # (Approximation: spread of death times — clustered means focus-fire)
    def cluster(deaths):
        if len(deaths) < 2: return None
        spread = deaths[-1] - deaths[0]
        return spread
    our_death_spread = cluster(our_deaths_sorted)
    cc_death_spread  = cluster(cc_deaths_sorted)

    # Ability accuracy proxy: hits / casts
    our_ab_acc = our_ability_hits / our_casts if our_casts else 0
    cc_ab_acc  = cc_ability_hits / cc_casts if cc_casts else 0

    return {
        'matchId': d['matchId'],
        'mapId': d['mapId'],
        'duration_ticks': len(frames),
        'us_killed': our_killed, 'cc_killed': cc_killed,
        'our_dmg': our_dmg, 'cc_dmg': cc_dmg,
        'our_ability_dmg': our_ability_dmg, 'cc_ability_dmg': cc_ability_dmg,
        'our_melee_dmg': our_melee_dmg, 'cc_melee_dmg': cc_melee_dmg,
        'our_zone_dmg_taken': our_zone_dmg, 'cc_zone_dmg_taken': cc_zone_dmg,
        'our_ab_casts': our_casts, 'cc_ab_casts': cc_casts,
        'our_ab_hits': our_ability_hits, 'cc_ab_hits': cc_ability_hits,
        'our_ab_acc': our_ab_acc, 'cc_ab_acc': cc_ab_acc,
        'our_melee_hits': our_melee_hits, 'cc_melee_hits': cc_melee_hits,
        'our_powerups': powerups_us, 'cc_powerups': powerups_cc,
        'first_kill_tick': first_kill_tick, 'first_kill_who': first_kill_who,
        'our_death_ticks': our_deaths_sorted,
        'cc_death_ticks': cc_deaths_sorted,
        'our_death_spread': our_death_spread,
        'cc_death_spread': cc_death_spread,
        'our_ammo_zero_tick': our_ammo_zero, 'cc_ammo_zero_tick': cc_ammo_zero,
        'avg_our_spread': avg(our_spread),
        'avg_cc_spread': avg(cc_spread),
        'avg_our_to_center': avg(our_to_center),
        'avg_cc_to_center': avg(cc_to_center),
        'avg_inter_team_dist': avg(inter_team_dist),
        'min_inter_team_dist': min(inter_team_dist) if inter_team_dist else None,
        'our_spread_p50': sorted(our_spread)[len(our_spread)//2] if our_spread else 0,
        'cc_spread_p50':  sorted(cc_spread)[len(cc_spread)//2] if cc_spread else 0,
    }

def main():
    repdir = sys.argv[1] if len(sys.argv)>1 else 'scouting/crabcrusher-0308/recent-losses'
    paths = sorted(glob.glob(os.path.join(repdir, 'L-*.json')))
    if not paths:
        print(f"No replays found in {repdir}"); sys.exit(1)
    results = [analyze(p) for p in paths]

    print(f"# Analysis of {len(results)} CC losses\n")

    for i, r in enumerate(results, 1):
        print(f"## Match {i}: {r['matchId']}  map={r['mapId']}  dur={r['duration_ticks']}t")
        print(f"   Kills:    us {r['us_killed']}/5 dead | cc {r['cc_killed']}/5 dead")
        print(f"   Damage:   us dealt {r['our_dmg']} (ab {r['our_ability_dmg']} / melee {r['our_melee_dmg']}) | cc dealt {r['cc_dmg']} (ab {r['cc_ability_dmg']} / melee {r['cc_melee_dmg']})")
        print(f"   Zone dmg taken: us {r['our_zone_dmg_taken']} | cc {r['cc_zone_dmg_taken']}")
        print(f"   Ability:  us {r['our_ab_hits']}/{r['our_ab_casts']} hits ({r['our_ab_acc']:.0%}) | cc {r['cc_ab_hits']}/{r['cc_ab_casts']} ({r['cc_ab_acc']:.0%})")
        print(f"   Powerups: us {r['our_powerups']} | cc {r['cc_powerups']}")
        print(f"   First kill: t={r['first_kill_tick']} by {r['first_kill_who']}")
        print(f"   Our deaths at:  {r['our_death_ticks']}")
        print(f"   CC deaths at:   {r['cc_death_ticks']}")
        print(f"   Ammo-0 tick: us t={r['our_ammo_zero_tick']} | cc t={r['cc_ammo_zero_tick']}")
        print(f"   Spread avg:  us {r['avg_our_spread']:.0f}u | cc {r['avg_cc_spread']:.0f}u")
        print(f"   Dist→center: us {r['avg_our_to_center']:.0f}u | cc {r['avg_cc_to_center']:.0f}u")
        print(f"   Inter-team avg/min dist: {r['avg_inter_team_dist']:.0f}u / {r['min_inter_team_dist']:.0f}u")
        print()

    # Aggregate
    print("# Aggregate across all 8 losses")
    def m(k): return avg([r[k] for r in results if r[k] is not None])
    print(f"  Avg our_dmg:     {m('our_dmg'):.0f}   |  Avg cc_dmg:     {m('cc_dmg'):.0f}")
    print(f"  Avg ab dmg:      us {m('our_ability_dmg'):.0f}  vs cc {m('cc_ability_dmg'):.0f}")
    print(f"  Avg melee dmg:   us {m('our_melee_dmg'):.0f}    vs cc {m('cc_melee_dmg'):.0f}")
    print(f"  Avg ab hits:     us {m('our_ab_hits'):.1f}     vs cc {m('cc_ab_hits'):.1f}")
    print(f"  Avg ab casts:    us {m('our_ab_casts'):.1f}    vs cc {m('cc_ab_casts'):.1f}")
    print(f"  Avg ab accuracy: us {m('our_ab_acc'):.0%}  vs cc {m('cc_ab_acc'):.0%}")
    print(f"  Avg powerups:    us {m('our_powerups'):.1f}    vs cc {m('cc_powerups'):.1f}")
    print(f"  Avg us_killed:   {m('us_killed'):.1f}/5  |  Avg cc_killed: {m('cc_killed'):.1f}/5")
    print(f"  Avg first_kill:  t={m('first_kill_tick'):.0f}")
    first_kill_us  = sum(1 for r in results if r['first_kill_who']=='us')
    print(f"  First kill by:   us {first_kill_us}/{len(results)} | cc {len(results)-first_kill_us}/{len(results)}")
    print(f"  Avg spread:      us {m('avg_our_spread'):.0f}u | cc {m('avg_cc_spread'):.0f}u")
    print(f"  Avg to center:   us {m('avg_our_to_center'):.0f}u | cc {m('avg_cc_to_center'):.0f}u")
    print(f"  Avg inter-team:  {m('avg_inter_team_dist'):.0f}u  min: {avg([r['min_inter_team_dist'] for r in results if r['min_inter_team_dist'] is not None]):.0f}u")
    print(f"  Avg ammo-0:      us t={avg([r['our_ammo_zero_tick'] for r in results if r['our_ammo_zero_tick']]):.0f} | cc t={avg([r['cc_ammo_zero_tick'] for r in results if r['cc_ammo_zero_tick']]):.0f}")
    print(f"  Avg death spread: us {avg([r['our_death_spread'] for r in results if r['our_death_spread']]):.0f}t | cc {avg([r['cc_death_spread'] for r in results if r['cc_death_spread']]):.0f}t  (smaller=more focus-fire)")

if __name__ == '__main__':
    main()
