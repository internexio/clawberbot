#!/usr/bin/env python3
"""
cc-opening-compression.py — Is our tick-0..60 formation compression BEHAVIORAL or GEOMETRIC?

Question: vs CrabCrusher (CC), our pack compresses during the approach and CC AoE-multi-hits
the cluster. Is that compression something we DO (behavioral convergence we could suppress —
Option A) or something the map FORCES (spawn geometry + zone-center pathing — Option C)?

METHODOLOGY (hardened after an adversarial-critic pass; the naive version was WRONG):
  - Per-BOT, not team-average. A team mean washes out a single over-exposed/over-converging bot,
    which is exactly the loss signal ("weakest bot exposed"). We report mean-bot AND the single
    most-converging bot per tick.
  - ORTHOGONALIZE inward velocity against the zone-center direction. The team centroid and the
    zone center both sit near arena center (1024,1024), so raw "velocity toward centroid" is
    nearly parallel to "velocity toward zone" by construction and proves nothing. We project the
    centroid direction onto the plane orthogonal to the zone direction first, so the residual is
    the part of convergence NOT explained by forced zone pathing.
  - Restrict a variant to LOW-ZONE-DEMAND ticks (inside zone_radius-200) where zone pull is weak.
  - Compare SAME-VERSION wins vs losses (default v40 vs v40) to remove era/bot confounds.

Reading: if residual-inward is materially higher in losses (esp. low-zone-demand and the
most-converging bot), compression is behavioral -> Option A has a target. If ~equal, it's
geometric -> Option C. (2026-05-30 result: small ~+0.4 u/tick excess in losses, inconsistent
across samples -> behavioral lever too thin to chase. See memory cc-ceiling-diagnostics.)

Usage:
  python3 scripts/cc-opening-compression.py                 # default v40 + v37W/v42L sample sets
  python3 scripts/cc-opening-compression.py <wins_glob> <losses_glob>
Replay schema: frames[].bots[]{id:"<uuid>:<idx>", position, health, ammo, alive}; winner=botId.
"""
import json, glob, math, sys

OUR = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"   # SEMalytics agentId

def load(f):
    d = json.load(open(f)); top = {b["id"].split(":")[0]: b["agentId"] for b in d["bots"]}
    return d, top, top.get(d["winner"].split(":")[0]) == OUR

def team(fr, top, ours):
    return [b for b in fr["bots"] if (top.get(b["id"].split(":")[0]) == OUR) == ours and b.get("alive")]

def unit(dx, dy):
    m = math.hypot(dx, dy); return (dx/m, dy/m) if m > 1e-9 else (0.0, 0.0)

def opening(f):
    d, top, win = load(f); frames = {fr["tick"]: fr for fr in d["frames"]}
    expo = 0; expN = 0; resid_mean = []; resid_max = []; lowzone = []; prev = {}
    for t in range(0, 61):
        if t not in frames: continue
        fr = frames[t]; allies = team(fr, top, True); enemies = team(fr, top, False)
        z = fr.get("zone", {}); zc = z.get("center", {})
        zx, zy = zc.get("x", 1024), zc.get("y", 1024); zr = z.get("radius", 1126)
        if len(allies) >= 2 and enemies:
            cx = sum(b["position"]["x"] for b in allies)/len(allies)
            cy = sum(b["position"]["y"] for b in allies)/len(allies)
            for b in allies:                                    # exposure: enemy closer than ally
                p = b["position"]
                nAlly = min(math.hypot(p["x"]-a["position"]["x"], p["y"]-a["position"]["y"]) for a in allies if a["id"] != b["id"])
                nEne = min(math.hypot(p["x"]-e["position"]["x"], p["y"]-e["position"]["y"]) for e in enemies)
                if nEne < nAlly: expo += 1; break
            expN += 1
            residt = []
            for b in allies:
                pid = b["id"]; p = b["position"]
                if pid in prev:
                    vx, vy = p["x"]-prev[pid]["x"], p["y"]-prev[pid]["y"]
                    if math.hypot(vx, vy) > 0.5:
                        ux, uy = unit(zx-p["x"], zy-p["y"])      # zone direction
                        wx, wy = unit(cx-p["x"], cy-p["y"])      # centroid direction
                        dot = wx*ux + wy*uy                      # remove zone-parallel component
                        ph = unit(wx - dot*ux, wy - dot*uy)
                        ri = vx*ph[0] + vy*ph[1]                 # behavioral inward (geometry-removed)
                        residt.append(ri)
                        if math.hypot(p["x"]-zx, p["y"]-zy) < zr - 200: lowzone.append(ri)
            if residt:
                resid_mean.append(sum(residt)/len(residt)); resid_max.append(max(residt))
        prev = {b["id"]: b["position"] for b in allies}
    f_ = lambda L: (sum(L)/len(L)) if L else float('nan')
    return win, (expo/expN if expN else float('nan')), f_(resid_mean), f_(resid_max), f_(lowzone)

def run(name, files):
    O = [opening(f) for f in files]
    for sel, lbl in [(True, "WINS"), (False, "LOSSES")]:
        g = [x for x in O if x[0] == sel]
        if not g: continue
        mean = lambda L: (lambda v: sum(v)/len(v) if v else float('nan'))([x for x in L if x is not None and x == x])
        print(f"[{name} {lbl}] n={len(g)}")
        print(f"   exposure-rate (enemy<ally): {mean([x[1] for x in g])*100:.0f}%")
        print(f"   resid-inward  mean-bot {mean([x[2] for x in g]):+.2f}  most-converging-bot {mean([x[3] for x in g]):+.2f}  low-zone-demand {mean([x[4] for x in g]):+.2f} u/tick")

if __name__ == "__main__":
    if len(sys.argv) == 3:
        run("custom", glob.glob(sys.argv[1]) + glob.glob(sys.argv[2]))
    else:
        run("v40", glob.glob("match-history/v40-cc-wins/*.json") + glob.glob("match-history/v40-cc-losses/*.json"))
        run("v37W/v42L", glob.glob("match-history/v37-cc-wins/*.json") + glob.glob("match-history/v42-cc-losses/*.json"))
