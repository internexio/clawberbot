#!/usr/bin/env python3
"""Compare per-match signals between wins and losses for a given pending file's matches vs a target opponent.

Usage:
  ./compare-w-vs-l.py <pending-file> [target-opponent-substring]

Downloads each match's replay (if not already cached) and prints W vs L averages
side-by-side to surface what differs.
"""
import json, sys, os, subprocess, urllib.request, time, importlib.util
_spec = importlib.util.spec_from_file_location("analyze_cc_losses", os.path.join(os.path.dirname(__file__), "analyze-cc-losses.py"))
_mod = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_mod)
analyze = _mod.analyze

OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'
CACHE_DIR = 'match-history/replay-cache'
os.makedirs(CACHE_DIR, exist_ok=True)

def fetch_match(mid):
    try:
        with urllib.request.urlopen(f"https://clawber.ai/api/v1/match/{mid}") as r:
            return json.load(r)
    except Exception as e:
        return None

def fetch_replay(url, path):
    if os.path.exists(path): return True
    try:
        with urllib.request.urlopen(url) as r, open(path, 'wb') as f:
            f.write(r.read())
        return True
    except Exception as e:
        print(f"  err fetching replay: {e}")
        return False

def main():
    pending = sys.argv[1]
    target = sys.argv[2] if len(sys.argv) > 2 else None

    path = pending if os.path.exists(pending) else f"match-history/{pending}.txt" if os.path.exists(f"match-history/{pending}.txt") else None
    if not path:
        print(f"pending file not found: {pending}"); sys.exit(1)

    mids = [l.strip() for l in open(path) if l.strip()]
    print(f"Processing {len(mids)} matches from {path}")

    wins, losses = [], []
    for mid in mids:
        m = fetch_match(mid)
        if not m or m.get('status') != 'completed':
            print(f"  skip {mid}: not completed")
            continue
        us = next((p for p in m['participants'] if p.get('agentId') == OUR_AGENT), None)
        them = next((p for p in m['participants'] if p.get('agentId') != OUR_AGENT), None)
        if not us: continue
        if target and target.lower() not in them.get('agentName','').lower(): continue
        we_won = m.get('winnerId') == us.get('botId')
        replay_url = m.get('replayUrl')
        rid = mid[:8]
        rpath = os.path.join(CACHE_DIR, f"{rid}.json")
        if not fetch_replay(replay_url, rpath):
            continue
        r = analyze(rpath)
        r['_won'] = we_won
        (wins if we_won else losses).append(r)
        time.sleep(0.1)

    print(f"\nWins: {len(wins)}  Losses: {len(losses)}")
    if not wins or not losses:
        print("Need at least 1 win and 1 loss to compare"); return

    def avg(xs, k): return sum(x[k] for x in xs if x[k] is not None) / max(1, sum(1 for x in xs if x[k] is not None))

    keys = [
        'us_killed','cc_killed','our_dmg','cc_dmg','our_ability_dmg','cc_ability_dmg',
        'our_melee_dmg','cc_melee_dmg','our_ab_casts','cc_ab_casts','our_ab_hits','cc_ab_hits',
        'our_powerups','cc_powerups','first_kill_tick',
        'avg_our_spread','avg_cc_spread','avg_our_to_center','avg_cc_to_center',
        'avg_inter_team_dist','our_ammo_zero_tick','cc_ammo_zero_tick',
        'our_death_spread','cc_death_spread',
    ]
    print(f"\n{'metric':<28} {'WIN avg':>10} {'LOSS avg':>10} {'delta':>10}")
    print("-"*64)
    for k in keys:
        w = avg(wins, k); l = avg(losses, k)
        delta = w - l
        print(f"  {k:<26} {w:>10.1f} {l:>10.1f} {delta:>+10.1f}")

    # First-kill split
    fkw_us = sum(1 for x in wins if x['first_kill_who']=='us')
    fkl_us = sum(1 for x in losses if x['first_kill_who']=='us')
    print(f"\n  first_kill by us         {fkw_us}/{len(wins):<8} {fkl_us}/{len(losses):<8}")

if __name__ == '__main__':
    main()
