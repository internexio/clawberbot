#!/usr/bin/env python3
"""Team damage-dropoff analyzer.

Hypothesis: when 1 of our bots dies, remaining 4 deliver proportionally less
damage than they should — early death cascades into late game.

Measures damage rate per tick segmented by bots-alive (5, 4, 3, 2, 1).
Compares damage-per-alive-bot in each segment to see if it scales linearly
or drops off (early-death cascade).

Also computes "first-death tick" and "team wipe gradient" (how steep is the
decline from full team to wipe).

Usage:
  ./damage-dropoff.py [replay-dir]
"""
import json, sys, os, glob, math
from collections import defaultdict

OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'
CC_AGENT  = 'ef7e1954-e275-4882-933b-a423946442f5'

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

    # Per tick: how many of our bots alive, and damage they dealt this tick
    # Aggregate damage-per-tick by alive-count
    # Bins: 5_alive, 4_alive, 3_alive, 2_alive, 1_alive
    our_bins = {5: {'ticks':0, 'damage':0}, 4: {'ticks':0, 'damage':0}, 3: {'ticks':0, 'damage':0}, 2: {'ticks':0, 'damage':0}, 1: {'ticks':0, 'damage':0}}
    cc_bins  = {5: {'ticks':0, 'damage':0}, 4: {'ticks':0, 'damage':0}, 3: {'ticks':0, 'damage':0}, 2: {'ticks':0, 'damage':0}, 1: {'ticks':0, 'damage':0}}

    first_death_tick_us = None
    first_death_tick_cc = None

    for f in frames:
        tick = f['tick']
        # Count alive
        our_alive = sum(1 for b in f['bots'] if b['id'] in our_ids and b.get('alive'))
        cc_alive  = sum(1 for b in f['bots'] if b['id'] in cc_ids and b.get('alive'))

        # Damage dealt THIS tick
        our_dmg = 0; cc_dmg = 0
        for e in f.get('events', []):
            if e.get('type') == 'damage':
                aid = e.get('attackerId'); dmg = e.get('damage', 0)
                if aid in our_ids: our_dmg += dmg
                elif aid in cc_ids: cc_dmg += dmg
            elif e.get('type') == 'kill':
                vid = e.get('victimId')
                if vid in our_ids and first_death_tick_us is None:
                    first_death_tick_us = tick
                elif vid in cc_ids and first_death_tick_cc is None:
                    first_death_tick_cc = tick

        if our_alive in our_bins:
            our_bins[our_alive]['ticks'] += 1
            our_bins[our_alive]['damage'] += our_dmg
        if cc_alive in cc_bins:
            cc_bins[cc_alive]['ticks'] += 1
            cc_bins[cc_alive]['damage'] += cc_dmg

    # Compute damage per bot per tick at each alive level
    def dpbt(bins):
        out = {}
        for n in [5,4,3,2,1]:
            b = bins[n]
            if b['ticks'] > 0 and n > 0:
                out[n] = b['damage'] / (b['ticks'] * n)
            else:
                out[n] = 0
        return out

    return {
        'matchId': d.get('matchId', os.path.basename(path))[:14],
        'we_won': we_won,
        'us_dpbt': dpbt(our_bins),
        'cc_dpbt': dpbt(cc_bins),
        'us_bin_ticks': {n: our_bins[n]['ticks'] for n in [5,4,3,2,1]},
        'cc_bin_ticks': {n: cc_bins[n]['ticks'] for n in [5,4,3,2,1]},
        'first_death_us': first_death_tick_us,
        'first_death_cc': first_death_tick_cc,
    }

def main():
    repdir = sys.argv[1] if len(sys.argv) > 1 else 'match-history/replay-cache'
    paths = sorted(glob.glob(os.path.join(repdir, '*.json')))
    results = [analyze(p) for p in paths]
    wins   = [r for r in results if r['we_won']]
    losses = [r for r in results if not r['we_won']]

    print(f"Replays: {len(results)}  W={len(wins)} L={len(losses)}\n")

    def avg(arr, side, n):
        vals = [r[side].get(n, 0) for r in arr]
        return sum(vals)/len(vals) if vals else 0
    def avg_first_death(arr, key):
        vals = [r[key] for r in arr if r[key] is not None]
        return sum(vals)/len(vals) if vals else 0

    print("Damage per bot per tick, by team-size:")
    print(f"  {'alive':<6} {'OUR W':>10} {'OUR L':>10} {'Δ':>8} | {'CC W':>10} {'CC L':>10} {'Δ':>8}")
    for n in [5,4,3,2,1]:
        wu = avg(wins, 'us_dpbt', n); lu = avg(losses, 'us_dpbt', n)
        wc = avg(wins, 'cc_dpbt', n); lc = avg(losses, 'cc_dpbt', n)
        print(f"  {n} alive {wu:>10.2f} {lu:>10.2f} {wu-lu:>+8.2f} | {wc:>10.2f} {lc:>10.2f} {wc-lc:>+8.2f}")

    print(f"\nTicks spent at each team size (avg per match):")
    print(f"  {'alive':<6} {'OUR W':>10} {'OUR L':>10}        | {'CC W':>10} {'CC L':>10}")
    for n in [5,4,3,2,1]:
        wu = avg(wins, 'us_bin_ticks', n); lu = avg(losses, 'us_bin_ticks', n)
        wc = avg(wins, 'cc_bin_ticks', n); lc = avg(losses, 'cc_bin_ticks', n)
        print(f"  {n} alive {wu:>10.1f} {lu:>10.1f}        | {wc:>10.1f} {lc:>10.1f}")

    print(f"\nFirst death tick:")
    print(f"  our W: {avg_first_death(wins, 'first_death_us'):.0f}   our L: {avg_first_death(losses, 'first_death_us'):.0f}")
    print(f"  cc  W: {avg_first_death(wins, 'first_death_cc'):.0f}   cc  L: {avg_first_death(losses, 'first_death_cc'):.0f}")

if __name__ == '__main__':
    main()
