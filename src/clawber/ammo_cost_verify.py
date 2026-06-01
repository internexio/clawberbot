import json, glob
from collections import Counter, defaultdict
OUR='8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'
files=sorted(glob.glob('match-history/replay-*.json'))
ammo1_cast_damage=[0,0]  # [had_damage, no_damage] for casts made at ammo_before==1
regen_events=Counter()   # ammo increases tick-over-tick with no nearby pickup
incr_dist=Counter()
nfiles=0
import math
def dist(a,b): return math.hypot(a['x']-b['x'],a['y']-b['y'])
for fp in files[:200]:
    try: d=json.load(open(fp))
    except: continue
    frames=d.get('frames')
    if not frames: continue
    nfiles+=1
    tl=defaultdict(dict); pos=defaultdict(dict)
    for fr in frames:
        for b in fr['bots']:
            tl[b['id']][fr['tick']]=b.get('ammo'); pos[b['id']][fr['tick']]=b.get('position')
    # ammo-1 casts effectiveness
    for fr in frames:
        dmg_by={}
        for e in fr.get('events',[]):
            if e.get('type')=='damage': dmg_by.setdefault(e.get('attackerId'),0); dmg_by[e['attackerId']]+=e.get('damage',0)
        for e in fr.get('events',[]):
            if e.get('type')=='ability':
                bid=e['botId']; t=fr['tick']; ab=tl[bid].get(t-1)
                if ab==1:
                    if dmg_by.get(bid,0)>0: ammo1_cast_damage[0]+=1
                    else: ammo1_cast_damage[1]+=1
    # detect ammo regen: ammo[t] > ammo[t-1] with no pickup within 60u (would be regen not pickup)
    for fr in frames:
        t=fr['tick']
        pk=fr.get('powerups',[])
        for b in fr['bots']:
            bid=b['id']; a=tl[bid].get(t); ap=tl[bid].get(t-1)
            if a is not None and ap is not None and a>ap:
                incr_dist[a-ap]+=1
                near=any(p['type']=='ammo' and dist(p['position'],b['position'])<80 for p in pk)
                regen_events['pickup_nearby' if near else 'NO pickup (regen?)']+=1
print(f"Replays sampled: {nfiles}\n")
print("== Did casts made at ammo==1 deal damage? ==")
tot=sum(ammo1_cast_damage)
print(f"   ammo-1 casts WITH damage: {ammo1_cast_damage[0]}  | WITHOUT: {ammo1_cast_damage[1]}  (of {tot})")
print("\n== Ammo INCREASES tick-over-tick (explains cost split if regen exists) ==")
print(f"   increase sizes: {dict(incr_dist)}")
print(f"   attribution: {dict(regen_events)}")
