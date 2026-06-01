// Counterfactual: v59 vs v60 over real frames (shared _s per match, real state fed each tick).
// Surgical claim: the ONLY behavioral change is at ammo==1 (v60 can cast, v59 can't). Measures
// extra effective casts unlocked + verifies all divergence occurs at ammo==1.
import fs from 'fs';
const OUR='8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const load=f=>new Function(fs.readFileSync(f,'utf8')+'\n; return update;')();
const DIR='match-history'; const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.json'));
let scanned=0,throws=0,ticks=0,diverge=0,extraCast=0,extraCastEndgame=0,divAtNon1=0;
const divAmmo={};
for(const fn of files){
  if(scanned>=250)break;
  let m;try{m=JSON.parse(fs.readFileSync(DIR+'/'+fn));}catch{continue;}
  if(!m.frames||!m.bots)continue;
  const ours=m.bots.filter(b=>b.agentId===OUR).map(b=>b.id); if(!ours.length)continue;
  scanned++;
  const u59=load('bots/v59-pickup-travel.js'), u60=load('bots/v60-last-ammo.js');
  for(const fr of m.frames){
    const en=fr.bots.filter(b=>b.alive&&!ours.includes(b.id));
    for(const id of ours){
      const self=fr.bots.find(b=>b.id===id); if(!self||!self.alive)continue;
      const input={selfId:id,teamBotIds:ours,botNumber:+(String(id).split(':')[1]||0),
        tick:fr.tick,bots:fr.bots,zone:fr.zone,powerups:fr.powerups||[]};
      let a59,a60; try{a59=u59(input);a60=u60(input);}catch(e){throws++;continue;}
      ticks++;
      const same=JSON.stringify(a59)===JSON.stringify(a60);
      if(!same){
        diverge++;
        const am=self.ammo;
        divAmmo[am]=(divAmmo[am]||0)+1;
        if(am!==1)divAtNon1++;
        if(a60&&a60.type==='ability'&&(!a59||a59.type!=='ability')){
          extraCast++;
          if(fr.tick>250&&en.length<=2)extraCastEndgame++;
        }
      }
    }
  }
}
console.log(`v59-vs-v60 over ${scanned} games — decisions evaluated: ${ticks}, throws ${throws}`);
console.log(`  divergent decisions: ${diverge}  (${(100*diverge/ticks).toFixed(2)}%)`);
console.log(`  divergence by self.ammo: ${JSON.stringify(divAmmo)}`);
console.log(`  SURGICAL CHECK — divergences at ammo!=1: ${divAtNon1} (must be 0)`);
console.log(`  EXTRA effective casts v60 unlocks (v60 casts where v59 didn't): ${extraCast}  = ${(extraCast/scanned).toFixed(2)}/game`);
console.log(`  ...of which ENDGAME (tick>250 & <=2 enemies): ${extraCastEndgame} = ${(extraCastEndgame/scanned).toFixed(2)}/game`);
