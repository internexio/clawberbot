#!/usr/bin/env python3
"""Clustering-at-impact analyzer.

Tests the hypothesis: when CC's AoE lands on us, our bots are clustered
within the 150u blast radius. When our AoE lands on them, they're spread.

A "multi-hit event" = ≥2 damage events from the same attacker at the same
tick (one ability cast that hit multiple bots).

Per match:
  - multi_hit_count        — number of AoE multi-hit events
  - victims_per_multi_hit  — avg bots hit per AoE event (2.0, 2.5, etc.)
  - victim_pairwise_dist   — avg pairwise distance among victims at impact tick
                              (small means tight cluster; large means CC missed
                               with spread but caught us with chase-cluster)

Usage:
  ./clustering-at-impact.py [replay-dir]
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

    # Per (tick, attacker): list of (target_id, damage)
    # For ability damage (damage >= 10), group to find multi-hits
    cc_multi_hits = []   # CC attacking us: list of {tick, victims:[ids], positions:[(x,y)]}
    our_multi_hits = []  # We attacking them

    for f in frames:
        tick = f['tick']
        # Build position lookup
        pos = {b['id']: b['position'] for b in f['bots']}

        # Group damage events by attacker (only ability, damage>=10)
        by_attacker = defaultdict(list)
        for e in f.get('events', []):
            if e.get('type') != 'damage': continue
            if e.get('damage', 0) < 10: continue  # melee
            aid = e.get('attackerId'); tid = e.get('targetId')
            if not aid or not tid: continue
            if aid == 'zone': continue
            by_attacker[aid].append(tid)

        for aid, victims in by_attacker.items():
            if len(victims) < 2: continue  # not multi-hit
            # Get victim positions at this tick
            victim_positions = [pos[v] for v in victims if v in pos]
            if len(victim_positions) < 2: continue
            # Pairwise distance avg
            pds = []
            for i in range(len(victim_positions)):
                for j in range(i+1, len(victim_positions)):
                    pds.append(dist(victim_positions[i], victim_positions[j]))
            avg_pd = sum(pds)/len(pds) if pds else 0
            entry = {
                'tick': tick,
                'attacker': aid,
                'victims': victims,
                'count': len(victims),
                'avg_pairwise_dist': avg_pd,
            }
            if aid in cc_ids:
                cc_multi_hits.append(entry)
            elif aid in our_ids:
                our_multi_hits.append(entry)

    def summary(hits):
        if not hits: return {'count':0,'avg_victims':0,'avg_dist':0,'tight_pct':0}
        counts = [h['count'] for h in hits]
        dists  = [h['avg_pairwise_dist'] for h in hits]
        tight  = sum(1 for d in dists if d < BLAST)  # within blast radius
        return {
            'count': len(hits),
            'avg_victims': sum(counts)/len(counts),
            'max_victims': max(counts),
            'avg_dist': sum(dists)/len(dists),
            'tight_pct': 100*tight/len(hits),
        }

    return {
        'matchId': d.get('matchId', os.path.basename(path))[:14],
        'we_won': we_won,
        'cc_aoe_on_us': summary(cc_multi_hits),
        'our_aoe_on_cc': summary(our_multi_hits),
    }

def main():
    repdir = sys.argv[1] if len(sys.argv) > 1 else 'match-history/replay-cache'
    paths = sorted(glob.glob(os.path.join(repdir, '*.json')))
    if not paths:
        print(f"No replays in {repdir}"); sys.exit(1)

    results = [analyze(p) for p in paths]
    wins   = [r for r in results if r['we_won']]
    losses = [r for r in results if not r['we_won']]

    print(f"Replays: {len(results)}  W={len(wins)} L={len(losses)}\n")

    def avg(arr, side, k):
        vals = [r[side][k] for r in arr if r[side][k] is not None]
        return sum(vals)/len(vals) if vals else 0

    print("CC AoE landing on US (multi-hit events from CC):")
    print(f"  {'metric':<28} {'OUR W':>10} {'OUR L':>10} {'Δ':>10}")
    for k in ['count', 'avg_victims', 'max_victims', 'avg_dist', 'tight_pct']:
        w = avg(wins, 'cc_aoe_on_us', k); l = avg(losses, 'cc_aoe_on_us', k)
        print(f"  {k:<28} {w:>10.1f} {l:>10.1f} {w-l:>+10.1f}")

    print("\nOUR AoE landing on CC:")
    print(f"  {'metric':<28} {'OUR W':>10} {'OUR L':>10} {'Δ':>10}")
    for k in ['count', 'avg_victims', 'max_victims', 'avg_dist', 'tight_pct']:
        w = avg(wins, 'our_aoe_on_cc', k); l = avg(losses, 'our_aoe_on_cc', k)
        print(f"  {k:<28} {w:>10.1f} {l:>10.1f} {w-l:>+10.1f}")

    print("\nPer-match table (CC AoE on us | Our AoE on CC):")
    print(f"  {'matchId':<10} {'W/L':<4}   cc#  ccVμ  ccDμ  cc<150% | ourμ ourD% our<150%")
    for r in sorted(results, key=lambda x: x['we_won'], reverse=True):
        c = r['cc_aoe_on_us']; o = r['our_aoe_on_cc']
        print(f"  {r['matchId']:<10} {'WIN' if r['we_won'] else 'LOSS':<4} "
              f"{c['count']:>4}  {c['avg_victims']:>4.2f}  {c['avg_dist']:>4.0f}  {c['tight_pct']:>6.0f} | "
              f"{o['count']:>4}  {o['avg_victims']:>4.2f}  {o['avg_dist']:>4.0f}  {o['tight_pct']:>6.0f}")

if __name__ == '__main__':
    main()
