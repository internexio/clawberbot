#!/usr/bin/env python3
"""Per-tick focus-fire analyzer.

For each replay, infers which enemy each of our bots is targeting per tick,
and computes focus-fire density (ticks where N+ bots target the same enemy).
Compares W vs L matches to test the hypothesis that focus-fire density
predicts wins, not ammo/pickup behavior.

Usage:
  ./focus-fire-analyzer.py <replay-dir>
  ./focus-fire-analyzer.py match-history/replay-cache/

Signal source:
  - damage events (attackerId + targetId) — primary, ground truth
  - ability events (targetPosition) — resolve to nearest enemy in 150u blast at that tick

Output: per-match table + W-vs-L aggregate comparison.
"""
import json, sys, os, glob, math
from collections import defaultdict

OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'
CC_AGENT  = 'ef7e1954-e275-4882-933b-a423946442f5'
BLAST = 150

def dist(a, b):
    return math.hypot(a['x']-b['x'], a['y']-b['y'])

def analyze_focus(path):
    d = json.load(open(path))
    bots = d['bots']
    frames = d['frames']

    our_ids = {b['id'] for b in bots if b['agentId'] == OUR_AGENT}
    cc_ids  = {b['id'] for b in bots if b['agentId'] == CC_AGENT}

    # Winner determination
    # winner field is "{botUuid}:N" — extract botUuid prefix
    winner = d.get('winner', '')
    winner_uuid = winner.split(':')[0] if winner else None
    our_uuid_prefix = next(iter(our_ids)).split(':')[0] if our_ids else None
    we_won = winner_uuid == our_uuid_prefix

    # Per-tick: targets that each of OUR bots is engaging
    # Also: targets that each of CC bots is engaging
    # tick -> {enemy_id: set(our_bot_ids hitting/aiming at them)}
    our_focus_per_tick = defaultdict(lambda: defaultdict(set))
    cc_focus_per_tick  = defaultdict(lambda: defaultdict(set))

    # Need frame state lookup by tick for ability targetPosition resolution
    frames_by_tick = {f['tick']: f for f in frames}

    for f in frames:
        tick = f['tick']
        events = f.get('events', [])

        for e in events:
            t = e.get('type')

            if t == 'damage':
                aid = e.get('attackerId')
                tid = e.get('targetId')
                if not aid or not tid: continue
                if aid in our_ids and tid in cc_ids:
                    our_focus_per_tick[tick][tid].add(aid)
                elif aid in cc_ids and tid in our_ids:
                    cc_focus_per_tick[tick][tid].add(aid)

            elif t == 'ability':
                bid = e.get('botId')
                pos = e.get('targetPosition')
                if not bid or not pos: continue
                # Resolve nearest enemy within blast at that tick
                state = frames_by_tick.get(tick) or f
                enemies = cc_ids if bid in our_ids else our_ids
                best = None; best_d = BLAST
                for b in state['bots']:
                    if b['id'] in enemies and b.get('alive'):
                        dd = dist(b['position'], pos)
                        if dd < best_d:
                            best_d = dd; best = b['id']
                if best is None: continue
                if bid in our_ids:
                    our_focus_per_tick[tick][best].add(bid)
                else:
                    cc_focus_per_tick[tick][best].add(bid)

    # Aggregate per-side
    def aggregate(focus_per_tick):
        active_ticks = [t for t, m in focus_per_tick.items() if m]
        if not active_ticks:
            return {'active_ticks':0,'focus2':0,'focus3':0,'focus4':0,'focus5':0,'mean_max':0,'mean_max_per_tick':0}
        per_tick_max = []
        f2=f3=f4=f5=0
        for t in active_ticks:
            mx = max(len(s) for s in focus_per_tick[t].values())
            per_tick_max.append(mx)
            if mx >= 2: f2 += 1
            if mx >= 3: f3 += 1
            if mx >= 4: f4 += 1
            if mx >= 5: f5 += 1
        return {
            'active_ticks': len(active_ticks),
            'focus2': f2, 'focus3': f3, 'focus4': f4, 'focus5': f5,
            'focus2_pct': 100*f2/len(active_ticks),
            'focus3_pct': 100*f3/len(active_ticks),
            'focus4_pct': 100*f4/len(active_ticks),
            'mean_max': sum(per_tick_max)/len(per_tick_max),
        }

    return {
        'matchId': d.get('matchId', os.path.basename(path)),
        'duration': len(frames),
        'we_won': we_won,
        'us': aggregate(our_focus_per_tick),
        'cc': aggregate(cc_focus_per_tick),
    }

def main():
    repdir = sys.argv[1] if len(sys.argv) > 1 else 'match-history/replay-cache'
    paths = sorted(glob.glob(os.path.join(repdir, '*.json')))
    if not paths:
        print(f"No replays in {repdir}"); sys.exit(1)

    results = [analyze_focus(p) for p in paths]
    wins   = [r for r in results if r['we_won']]
    losses = [r for r in results if not r['we_won']]

    print(f"Replays analyzed: {len(results)}  (wins {len(wins)}, losses {len(losses)})\n")

    def avg(arr, side, k):
        vals = [r[side][k] for r in arr]
        return sum(vals)/len(vals) if vals else 0

    keys = ['active_ticks', 'focus2_pct', 'focus3_pct', 'focus4_pct', 'mean_max']

    print(f"{'metric':<32} {'OUR W':>10} {'OUR L':>10} {'Δ':>8} | {'CC W':>10} {'CC L':>10} {'Δ':>8}")
    print('-'*92)
    for k in keys:
        wu = avg(wins, 'us', k); lu = avg(losses, 'us', k)
        wc = avg(wins, 'cc', k); lc = avg(losses, 'cc', k)
        print(f"  {k:<30} {wu:>10.1f} {lu:>10.1f} {wu-lu:>+8.1f} | {wc:>10.1f} {lc:>10.1f} {wc-lc:>+8.1f}")

    print("\nPer-match table:")
    print(f"{'matchId':<10} {'W/L':<4} {'our.f2%':>8} {'our.f3%':>8} {'our.f4%':>8} {'our.maxμ':>9} | {'cc.f2%':>8} {'cc.f3%':>8} {'cc.f4%':>8} {'cc.maxμ':>9}")
    for r in sorted(results, key=lambda x: x['we_won'], reverse=True):
        us, cc = r['us'], r['cc']
        print(f"  {r['matchId'][:8]} {'WIN' if r['we_won'] else 'LOSS':<4} "
              f"{us['focus2_pct']:>8.1f} {us['focus3_pct']:>8.1f} {us['focus4_pct']:>8.1f} {us['mean_max']:>9.2f} | "
              f"{cc['focus2_pct']:>8.1f} {cc['focus3_pct']:>8.1f} {cc['focus4_pct']:>8.1f} {cc['mean_max']:>9.2f}")

if __name__ == '__main__':
    main()
