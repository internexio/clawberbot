// Full-corpus sizing of the hasAbilityAmmo>=2 leak: extra casts v60 unlocks vs v59, classified by
// phase + multi-hit quality, plus total-cast % delta and dead-with-ammo waste. Loss-skewed corpus.
import fs from 'fs';
const OUR='8f1e1fcf-7e3d-4a9c-90ee-1f0296746628', ABL_R=150;
const load=f=>new Function(fs.readFileSync(f,'utf8')+'\n; return update;')();
const DIR='match-history'; const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.json'));
const d2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
let games=0,wins=0,throws=0;
let v59casts=0,v60casts=0,extra=0;
const phase={open:0,mid:0,late:0}, quality={multi:0,single:0};
let deadHolding=0,deadBots=0;
for(const fn of files){
  let m;try{m=JSON.parse(fs.readFileSync(DIR+'/'+fn));}catch{continue;}
  if(!m.frames||!m.bots)continue;
  const ours=m.bots.filter(b=>b.agentId===OUR).map(b=>b.id); if(!ours.length)continue;
  const won=(()=>{const w=m.bots.find(b=>b.id===m.winner);return w&&w.agentId===OUR;})();
  games++; if(won)wins++;
  const u59=load('bots/v59-pickup-travel.js'), u60=load('bots/v60-last-ammo.js');
  const lastAmmo={};
  for(const fr of m.frames){
    const en=fr.bots.filter(b=>b.alive&&!ours.includes(b.id));
    for(const id of ours){
      const self=fr.bots.find(b=>b.id===id); if(!self)continue;
      if(self.alive)lastAmmo[id]=self.ammo;
      if(!self.alive)continue;
      const input={selfId:id,teamBotIds:ours,botNumber:+(String(id).split(':')[1]||0),
        tick:fr.tick,bots:fr.bots,zone:fr.zone,powerups:fr.powerups||[]};
      let a59,a60;try{a59=u59(input);a60=u60(input);}catch(e){throws++;continue;}
      if(a59&&a59.type==='ability')v59casts++;
      if(a60&&a60.type==='ability')v60casts++;
      if(a60&&a60.type==='ability'&&(!a59||a59.type!=='ability')){
        extra++;
        const t=fr.tick; phase[t<100?'open':t<600?'mid':'late']++;
        // multi-hit? count enemies within ABL_R of the cast target
        const tp=a60.targetPosition;
        if(tp){const h=en.filter(e=>d2(e.position,tp)<=ABL_R).length; quality[h>=2?'multi':'single']++;}
      }
    }
  }
  for(const id of ours){const a=lastAmmo[id]; if(a!==undefined){deadBots++; if(a>=1)deadHolding++;}}
}
console.log(`Corpus: ${games} games (${wins} wins, ${games-wins} losses — LOSS-SKEWED), throws ${throws}\n`);
console.log(`v59 total ability casts: ${v59casts} (${(v59casts/games).toFixed(1)}/game)`);
console.log(`v60 total ability casts: ${v60casts} (${(v60casts/games).toFixed(1)}/game)`);
console.log(`EXTRA casts v60 unlocks: ${extra} = ${(extra/games).toFixed(2)}/game  (+${(100*extra/v59casts).toFixed(0)}% over v59)`);
console.log(`\nExtra casts by PHASE: opening<100 ${phase.open} | mid 100-600 ${phase.mid} | late>600 ${phase.late}`);
console.log(`Extra casts by QUALITY: MULTI-HIT(>=2) ${quality.multi} (${(100*quality.multi/(quality.multi+quality.single)).toFixed(0)}%) | single ${quality.single}`);
console.log(`\nWaste (current v59): bots last-seen-alive holding >=1 ammo: ${deadHolding}/${deadBots} (${(100*deadHolding/deadBots).toFixed(0)}%)`);
