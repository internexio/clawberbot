import json, glob
from collections import Counter, defaultdict
OUR='8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'
files=sorted(glob.glob('match-history/replay-loss-*.json'))
# Window per loss: t>=250 ticks where our_alive>=opp_alive AND opp_alive in {1,2} AND opp total ammo==0 AND our_alive>=1
# Record: winMaxAmmo = max over window of (max single OUR alive bot ammo); enemy counts seen; tie vs strict lead
seg=[]   # one row per qualifying loss
nqual=0; nloss=0
for fp in files:
    try: d=json.load(open(fp))
    except: continue
    frames=d.get('frames'); 
    if not frames: continue
    ourids={b['id'] for b in d['bots'] if b.get('agentId')==OUR}
    if not ourids: continue
    if d.get('winner') in ourids: continue   # ensure loss
    nloss+=1
    oppname=next((b['name'].split(' #')[0] for b in d['bots'] if b.get('agentId')!=OUR),'?')
    winMaxAmmo=-1; firstMaxAmmo=None; encounts=set(); had_strict=False; had_tie=False; ntick=0
    for fr in frames:
        t=fr['tick']
        if t<250 or t%5: continue
        oa=[b for b in fr['bots'] if b['id'] in ourids and b['alive']]
        pa=[b for b in fr['bots'] if b['id'] not in ourids and b['alive']]
        na,npa=len(oa),len(pa)
        if not(na>=npa and 1<=npa<=2 and na>=1): continue
        pamm=sum(b.get('ammo',0) for b in pa)
        if pamm!=0: continue   # enemy must be ability-defanged
        ntick+=1
        mymax=max((b.get('ammo',0) for b in oa), default=0)
        if firstMaxAmmo is None: firstMaxAmmo=mymax
        winMaxAmmo=max(winMaxAmmo,mymax)
        encounts.add(npa)
        if na>npa: had_strict=True
        else: had_tie=True
    if ntick>0:
        nqual+=1
        seg.append(dict(opp=oppname,winMaxAmmo=winMaxAmmo,firstMaxAmmo=firstMaxAmmo,
                        only1=encounts=={1}, has2=(2 in encounts), strict=had_strict, tieonly=(not had_strict and had_tie)))
print(f"Losses analyzed: {nloss}   Qualifying 'ahead+enemy-defanged' losses: {nqual} ({100*nqual/nloss:.0f}%)\n")
print("== Castability of our team at the window (max single-bot ammo, best over window) ==")
b=Counter()
for r in seg:
    m=r['winMaxAmmo']
    if m<=0: b['dry (max 0 ammo) -> needs REARM/forage']+=1
    elif m==1: b['ammo-1 blocked (real cost=1, bot gate>=2) -> hasAbilityAmmo fix']+=1
    else: b['castable now (max>=2) -> aheadFinish pursuit']+=1
for k in ['castable now (max>=2) -> aheadFinish pursuit','ammo-1 blocked (real cost=1, bot gate>=2) -> hasAbilityAmmo fix','dry (max 0 ammo) -> needs REARM/forage']:
    print(f"   {k:60} {b[k]:>4}  ({100*b[k]/nqual:.0f}%)")
print("\n== Same, at the FIRST window tick (snapshot, not best-over-window) ==")
b2=Counter()
for r in seg:
    m=r['firstMaxAmmo'] or 0
    b2['>=2' if m>=2 else ('==1' if m==1 else '==0')]+=1
for k in ['>=2','==1','==0']: print(f"   max single-bot ammo {k}: {b2[k]} ({100*b2[k]/nqual:.0f}%)")
print("\n== Enemy count at the window (formation-paradox check) ==")
e=Counter()
for r in seg:
    if r['only1']: e['only ever 1 enemy (gang-safe)']+=1
    elif r['has2']: e['includes a 2-enemy phase (multi-hit risk)']+=1
    else: e['other']+=1
for k,v in e.most_common(): print(f"   {k:42} {v:>4} ({100*v/nqual:.0f}%)")
print("\n== Strict lead vs tie at window ==")
print(f"   had a STRICT body lead: {sum(r['strict'] for r in seg)} ({100*sum(r['strict'] for r in seg)/nqual:.0f}%)")
print(f"   tie-only (na==npa, e.g. 1v1/2v2): {sum(r['tieonly'] for r in seg)} ({100*sum(r['tieonly'] for r in seg)/nqual:.0f}%)")
# cross: of castable-now, how many only-1-enemy
cast=[r for r in seg if r['winMaxAmmo']>=2]
print(f"\n== Cross: of 'castable now' ({len(cast)}), only-1-enemy = {sum(r['only1'] for r in cast)} ({100*sum(r['only1'] for r in cast)/max(len(cast),1):.0f}%) ==")
ammo1=[r for r in seg if r['winMaxAmmo']==1]
print(f"== Cross: of 'ammo-1 blocked' ({len(ammo1)}), only-1-enemy = {sum(r['only1'] for r in ammo1)} ({100*sum(r['only1'] for r in ammo1)/max(len(ammo1),1):.0f}%) ==")
