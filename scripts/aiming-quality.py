#!/usr/bin/env python3
"""Ability aiming-quality analyzer.

For each ability cast, find the resulting damage events (same attacker, same tick)
and measure: distance from targetPosition (where they aimed) to the victim's actual
position at hit time. Lower = better aim. Also measures bot velocity to detect
"lead position" usage.

Key signals:
  - aim_error: distance from targetPosition to nearest hit victim
  - hit_rate: fraction of casts that produced any damage event
  - lead_quality: when victim was moving, did we aim ahead of them?

Usage:
  ./aiming-quality.py [replay-dir]
"""
import json, sys, os, glob, math
from collections import defaultdict

OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'
CC_AGENT  = 'ef7e1954-e275-4882-933b-a423946442f5'
BLAST = 150

def dist(a, b):
    return math.hypot(a['x']-b['x'], a['y']-b['y'])

def analyze(path):
    d = json.load(open(path))
    bots = d['bots']
    frames = d['frames']
    our_ids = {b['id'] for b in bots if b['agentId'] == OUR_AGENT}
    cc_ids  = {b['id'] for b in bots if b['agentId'] == CC_AGENT}

    winner = d.get('winner', '')
    winner_uuid = winner.split(':')[0] if winner else None
    our_uuid_prefix = next(iter(our_ids)).split(':')[0] if our_ids else None
    we_won = winner_uuid == our_uuid_prefix

    # Per-tick: cast events + damage events from same attacker
    # For each cast: find damage events at same tick from same attacker → victims
    # Compute aim_error = avg(distance from targetPosition to each victim position at that tick)
    our_casts, cc_casts = [], []

    for f in frames:
        tick = f['tick']
        pos = {b['id']: b['position'] for b in f['bots']}

        # Collect casts and damage by attacker
        casts_at_tick = []
        damage_by_attacker = defaultdict(list)
        for e in f.get('events', []):
            t = e.get('type')
            if t == 'ability':
                casts_at_tick.append((e.get('botId'), e.get('targetPosition')))
            elif t == 'damage' and e.get('damage', 0) >= 10:
                aid = e.get('attackerId'); tid = e.get('targetId')
                if aid and tid and aid != 'zone':
                    damage_by_attacker[aid].append(tid)

        for bot_id, target_pos in casts_at_tick:
            if not bot_id or not target_pos: continue
            victims = damage_by_attacker.get(bot_id, [])
            hit = len(victims) > 0
            victim_count = len(victims)

            # Compute aim error: distance from targetPosition to nearest victim's current position
            if hit:
                victim_distances = [dist(target_pos, pos[v]) for v in victims if v in pos]
                aim_error = min(victim_distances) if victim_distances else None
                # And mean error across all victims (for multi-hit it tells us spread of aim window)
                mean_error = sum(victim_distances)/len(victim_distances) if victim_distances else None
            else:
                aim_error = None
                mean_error = None

            entry = {
                'tick': tick,
                'hit': hit,
                'victim_count': victim_count,
                'aim_error': aim_error,
                'mean_error': mean_error,
            }
            if bot_id in our_ids:
                our_casts.append(entry)
            elif bot_id in cc_ids:
                cc_casts.append(entry)

    def summary(casts):
        if not casts: return {'casts':0,'hits':0,'hit_rate':0,'avg_aim_err':None,'avg_mean_err':None,'avg_victims_when_hit':0,'misses':0}
        hits = [c for c in casts if c['hit']]
        misses = len(casts) - len(hits)
        hit_rate = 100*len(hits)/len(casts)
        if hits:
            avg_aim_err = sum(h['aim_error'] for h in hits)/len(hits)
            avg_mean_err = sum(h['mean_error'] for h in hits)/len(hits)
            avg_victims = sum(h['victim_count'] for h in hits)/len(hits)
        else:
            avg_aim_err = avg_mean_err = avg_victims = 0
        return {
            'casts': len(casts), 'hits': len(hits), 'misses': misses,
            'hit_rate': hit_rate,
            'avg_aim_err': avg_aim_err,
            'avg_mean_err': avg_mean_err,
            'avg_victims_when_hit': avg_victims,
        }

    return {
        'matchId': d.get('matchId', os.path.basename(path))[:14],
        'we_won': we_won,
        'us': summary(our_casts),
        'cc': summary(cc_casts),
    }

def main():
    repdir = sys.argv[1] if len(sys.argv) > 1 else 'match-history/replay-cache'
    paths = sorted(glob.glob(os.path.join(repdir, '*.json')))
    results = [analyze(p) for p in paths]
    wins   = [r for r in results if r['we_won']]
    losses = [r for r in results if not r['we_won']]

    print(f"Replays: {len(results)}  W={len(wins)} L={len(losses)}\n")

    def avg(arr, side, k):
        vals = [r[side][k] for r in arr if r[side][k] is not None]
        return sum(vals)/len(vals) if vals else 0

    keys = ['casts', 'hits', 'misses', 'hit_rate', 'avg_aim_err', 'avg_mean_err', 'avg_victims_when_hit']
    print(f"{'metric':<26} {'OUR W':>10} {'OUR L':>10} {'Δ':>8} | {'CC W':>10} {'CC L':>10} {'Δ':>8}")
    print('-'*94)
    for k in keys:
        wu = avg(wins, 'us', k); lu = avg(losses, 'us', k)
        wc = avg(wins, 'cc', k); lc = avg(losses, 'cc', k)
        print(f"  {k:<24} {wu:>10.2f} {lu:>10.2f} {wu-lu:>+8.2f} | {wc:>10.2f} {lc:>10.2f} {wc-lc:>+8.2f}")

if __name__ == '__main__':
    main()
