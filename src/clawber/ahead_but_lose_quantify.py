import json, glob, math
from collections import defaultdict, Counter
OUR='8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'
files=sorted(glob.glob('match-history/replay-loss-*.json'))
def dist(a,b): return math.hypot(a['x']-b['x'],a['y']-b['y'])

results=[]
errors=0
for fp in files:
    try:
        d=json.load(open(fp))
        frames=d.get('frames')
        if not frames: continue
        bots=d['bots']
        ourids={b['id'] for b in bots if b.get('agentId')==OUR}
        if not ourids: continue
        oppname=next((b['name'].split(' #')[0] for b in bots if b.get('agentId')!=OUR),'?')
        # confirm it's actually a loss (winner not ours)
        we_won = d.get('winner') in ourids
        last=frames[-1]['tick']
        # walk frames (stride 5)
        ahead_window=False   # T>=250: our_alive>=opp_alive AND opp_ammo==0 AND our_ammo>=2 AND opp_alive>=1
        numlead_late=False    # T>=300: our_alive>opp_alive
        last_tick_ahead=-1    # latest tick our_alive strictly > opp_alive
        ever_ahead=False
        max_adv_late=-5
        # pickups
        spawned={}
        for fr in frames:
            t=fr['tick']
            for p in fr.get('powerups',[]):
                spawned.setdefault(p['id'],{'expires':p['expiresAtTick'],'last':t,'type':p['type'],'pos':p['position']})
                spawned[p['id']]['last']=t
            if t<200 or t%5: continue
            oa=[b for b in fr['bots'] if b['id'] in ourids and b['alive']]
            pa=[b for b in fr['bots'] if b['id'] not in ourids and b['alive']]
            na,npa=len(oa),len(pa)
            oamm=sum(b.get('ammo',0) for b in oa); pamm=sum(b.get('ammo',0) for b in pa)
            if na>npa: last_tick_ahead=t; ever_ahead=True
            if na>=npa and na>0: ever_ahead=ever_ahead or na>npa
            if t>=300 and na>npa: numlead_late=True
            if t>=250 and na>=1 and npa>=1 and na>=npa and pamm==0 and oamm>=2:
                ahead_window=True
            if t>=250: max_adv_late=max(max_adv_late, na-npa)
        # collection attribution
        fbt={fr['tick']:fr for fr in frames}
        ourc=oppc=0
        for pid,info in spawned.items():
            if info['last']<info['expires']-1:
                fr=fbt.get(info['last'])
                if not fr: continue
                alive=[b for b in fr['bots'] if b['alive']]
                if not alive: continue
                nb=min(alive,key=lambda b:dist(b['position'],info['pos']))
                if nb['id'] in ourids: ourc+=1
                else: oppc+=1
        results.append(dict(opp=oppname,ahead_window=ahead_window,numlead_late=numlead_late,
                            last_tick_ahead=last_tick_ahead,max_adv_late=max_adv_late,
                            ourc=ourc,oppc=oppc,last=last))
    except Exception as e:
        errors+=1
print(f"Analyzed {len(results)} loss replays ({errors} errors)\n")
N=len(results)
aw=[r for r in results if r['ahead_window']]
nl=[r for r in results if r['numlead_late']]
print(f"== 'AHEAD-BUT-LOSE' WINDOW (T>=250: our_alive>=opp_alive, enemy 0 ammo, us >=2 ammo, enemy alive) ==")
print(f"   {len(aw)}/{N} = {100*len(aw)/N:.0f}% of losses reached this winnable spot and still lost\n")
print(f"== Numerical lead late (T>=300 our_alive>opp_alive) then lost: {len(nl)}/{N} = {100*len(nl)/N:.0f}% ==\n")
# distribution of latest tick we were ahead
buckets=Counter()
for r in results:
    lt=r['last_tick_ahead']
    if lt<0: buckets['never ahead (after t200)']+=1
    elif lt<400: buckets['ahead only early (t200-400)']+=1
    elif lt<700: buckets['ahead mid (t400-700)']+=1
    else: buckets['ahead late (t700+)']+=1
print("== When were we last ahead on bodies? ==")
for k in ['never ahead (after t200)','ahead only early (t200-400)','ahead mid (t400-700)','ahead late (t700+)']:
    print(f"   {k:32} {buckets[k]:>4}  ({100*buckets[k]/N:.0f}%)")
# by opponent: ahead-window losses
print("\n== 'Ahead-but-lose' losses by opponent (top 12 opponents by loss count) ==")
byopp=defaultdict(lambda:[0,0]); 
for r in results:
    byopp[r['opp']][0]+=1
    if r['ahead_window']: byopp[r['opp']][1]+=1
for opp,(tot,winnable) in sorted(byopp.items(),key=lambda x:-x[1][0])[:12]:
    print(f"   {opp:34} losses={tot:>4}  ahead-but-lost={winnable:>4} ({100*winnable/tot:.0f}%)")
# pickup collection in ahead-window losses vs all
import statistics as st
def avg(xs): return st.mean(xs) if xs else 0
print(f"\n== Pickup collection ==")
print(f"   ALL losses:          us {avg([r['ourc'] for r in results]):.1f} vs opp {avg([r['oppc'] for r in results]):.1f} per match")
print(f"   AHEAD-BUT-LOST only:  us {avg([r['ourc'] for r in aw]):.1f} vs opp {avg([r['oppc'] for r in aw]):.1f} per match")
