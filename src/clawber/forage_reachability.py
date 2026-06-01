import json, glob, math
OUR='8f1e1fcf-7e3d-4a9c-90ee-1f0296746628'; SPEED=12
def dist(a,b): return math.hypot(a['x']-b['x'],a['y']-b['y'])
files=sorted(glob.glob('match-history/replay-loss-*.json'))
dry_windows=0; dry_with_reachable_ammo=0; reach_details=[]
for fp in files:
    try: d=json.load(open(fp))
    except: continue
    frames=d.get('frames'); 
    if not frames: continue
    ourids={b['id'] for b in d['bots'] if b.get('agentId')==OUR}
    if not ourids or d.get('winner') in ourids: continue
    # find dry-ahead-defanged window ticks; check reachable ammo pickup
    is_dry_loss=False; reachable_here=False
    for fr in frames:
        t=fr['tick']
        if t<250 or t%5: continue
        oa=[b for b in fr['bots'] if b['id'] in ourids and b['alive']]
        pa=[b for b in fr['bots'] if b['id'] not in ourids and b['alive']]
        na,npa=len(oa),len(pa)
        if not(na>=npa and 1<=npa<=2 and na>=1): continue
        if sum(b.get('ammo',0) for b in pa)!=0: continue
        mymax=max((b.get('ammo',0) for b in oa),default=0)
        if mymax!=0: continue   # DRY window only
        is_dry_loss=True
        z={'x':fr['zone']['centerX'],'y':fr['zone']['centerY']}; zr=fr['zone']['radius']
        for p in fr.get('powerups',[]):
            if p['type']!='ammo': continue
            pp=p['position']
            if dist(pp,z) > zr-50: continue            # in-zone
            ne=min((dist(pp,e['position']) for e in pa),default=9999)
            if ne<150: continue                         # not on enemy
            # reachable by SOME our bot before expiry
            for b in oa:
                trav=dist(pp,b['position'])
                ticksLeft=p.get('expiresAtTick',t+999)-t
                if trav<=450 and trav/SPEED <= ticksLeft:
                    reachable_here=True; break
            if reachable_here: break
    if is_dry_loss:
        dry_windows+=1
        if reachable_here: dry_with_reachable_ammo+=1
print(f"Dry ahead/defanged-window losses: {dry_windows}")
print(f"  ...with a REACHABLE in-zone ammo pickup during the window: {dry_with_reachable_ammo} ({100*dry_with_reachable_ammo/max(dry_windows,1):.0f}%)")
print(f"  ...with NO reachable ammo (genuine loss, forage can't help): {dry_windows-dry_with_reachable_ammo} ({100*(dry_windows-dry_with_reachable_ammo)/max(dry_windows,1):.0f}%)")
