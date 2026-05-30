#!/usr/bin/env python3
"""
cc-cascade-firststrike.py — Mid-game cascade behavior + first-kill race vs CrabCrusher (CC).

Probes whether a fixable BEHAVIORAL lever exists AFTER the opening (tick 50-300), and which
opening outcome predicts the match. Built to answer adversarial-critic Finding 4 (the opening
compression diagnostic only covered tick 0-60; the cascade plays out later).

All combat is read from frames[].events[] (authoritative) — NOT ammo deltas. Event types:
  ability {tick, botId, targetPosition}
  damage  {tick, attackerId, targetId, damage}
  kill    {tick, targetId}        (victim's bot id)
  powerup_spawn / powerup_collect / zone_shrink
(Ability cost is NOT a reliable -2 ammo step in replays; count ability events instead.)

Metrics (wins vs losses, same-version recommended):
  - cascade fire-rate: ability events per alive-bot-tick in 50-300, US vs CC
  - cascade abilities/match (50-300), US vs CC
  - multi-hit victims/cast: total damage / casts / 10dmg, whole match, US vs CC
  - first-kill: avg tick of first kill, and fraction of matches WE landed it
  - alive@150: bots alive ~tick 150, US vs CC

2026-05-30 result (memory cc-ceiling-diagnostics): the first-kill race at tick ~60 is THE
outcome correlate (we win it 50-70% in wins, 33-43% in losses). CC's higher cascade fire-rate
is largely a SYMPTOM of having more bots alive after winning that race (a red herring). Multi-hit
is parity. v44 already runs the v37 cascade-fire relax -> little mid-game headroom -> Option C.

Usage:
  python3 scripts/cc-cascade-firststrike.py                  # default v40 + v37W/v42L sets
  python3 scripts/cc-cascade-firststrike.py <wins_glob> <losses_glob>
"""
import json, glob, math, sys

OUR = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"   # SEMalytics agentId

def load(f):
    d = json.load(open(f)); top = {b["id"].split(":")[0]: b["agentId"] for b in d["bots"]}
    return d, top, top.get(d["winner"].split(":")[0]) == OUR

def is_ours(bid, top): return top.get(bid.split(":")[0]) == OUR

def alivecount(fr, top, ours):
    return sum(1 for b in fr["bots"] if b.get("alive") and is_ours(b["id"], top) == ours)

def cascade(f):
    d, top, win = load(f); frames = {fr["tick"]: fr for fr in d["frames"]}
    our_bt = cc_bt = our_ab = cc_ab = 0
    our_dmg = cc_dmg = our_casts = cc_casts = 0
    fk_tick = None; fk_us = None
    for t, fr in frames.items():
        if 50 <= t <= 300:
            our_bt += alivecount(fr, top, True); cc_bt += alivecount(fr, top, False)
        for e in (fr.get("events") or []):
            ty = e.get("type")
            if ty == "ability":
                mine = is_ours(e.get("botId", ""), top)
                if 50 <= t <= 300:
                    if mine: our_ab += 1
                    else: cc_ab += 1
                if mine: our_casts += 1
                else: cc_casts += 1
            elif ty == "damage":
                if is_ours(e.get("attackerId", ""), top): our_dmg += e.get("damage", 0)
                else: cc_dmg += e.get("damage", 0)
            elif ty == "kill" and fk_tick is None:
                fk_tick = t
                fk_us = not is_ours(e.get("targetId") or e.get("victimId") or "", top)
    near150 = frames[min(frames, key=lambda x: abs(x - 150))]
    return dict(win=win,
        our_fr=(our_ab/our_bt*100 if our_bt else float('nan')),
        cc_fr=(cc_ab/cc_bt*100 if cc_bt else float('nan')),
        our_ab=our_ab, cc_ab=cc_ab,
        our_mh=(our_dmg/our_casts/10 if our_casts else float('nan')),
        cc_mh=(cc_dmg/cc_casts/10 if cc_casts else float('nan')),
        fk=fk_tick, fk_us=fk_us,
        a150o=alivecount(near150, top, True), a150c=alivecount(near150, top, False))

def run(name, files):
    R = [cascade(f) for f in files]
    for sel, lbl in [(True, "WINS"), (False, "LOSSES")]:
        g = [r for r in R if r["win"] == sel]
        if not g: continue
        def m(k):
            v = [r[k] for r in g if isinstance(r[k], (int, float)) and r[k] == r[k]]
            return sum(v)/len(v) if v else float('nan')
        fk = [r["fk"] for r in g if r["fk"] is not None]
        fkus = [r for r in g if r["fk_us"] is True]
        print(f"[{name} {lbl}] n={len(g)}")
        print(f"   cascade(50-300) fire-rate  US {m('our_fr'):.2f}  CC {m('cc_fr'):.2f}  (%/alive-bot-tick)")
        print(f"   cascade abilities/match    US {m('our_ab'):.1f}  CC {m('cc_ab'):.1f}")
        print(f"   multi-hit victims/cast     US {m('our_mh'):.2f}  CC {m('cc_mh'):.2f}")
        print(f"   first-kill tick {sum(fk)/len(fk) if fk else float('nan'):.0f}  | we landed first kill {len(fkus)}/{len(g)}")
        print(f"   alive@150  US {m('a150o'):.1f}  CC {m('a150c'):.1f}")

if __name__ == "__main__":
    if len(sys.argv) == 3:
        run("custom", glob.glob(sys.argv[1]) + glob.glob(sys.argv[2]))
    else:
        run("v40", glob.glob("match-history/v40-cc-wins/*.json") + glob.glob("match-history/v40-cc-losses/*.json"))
        run("v37W/v42L", glob.glob("match-history/v37-cc-wins/*.json") + glob.glob("match-history/v42-cc-losses/*.json"))
