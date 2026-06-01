// Precise re-test: are EARLY (tick<=60) SINGLE-TARGET casts wasteful? Split by our win/loss.
import { loadReplay, walkJson } from './parse.mjs';
const BLAST=150; const dd=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const files=[]; walkJson('match-history',files);
const G={win:{n:0,early1:0,earlyMulti:0,earlyWhiff:0,ammo120:0,earlyKills:0},
         loss:{n:0,early1:0,earlyMulti:0,earlyWhiff:0,ammo120:0,earlyKills:0}};
let onlyCC=process.argv[2]!=='all';
for(const f of files){ const m=loadReplay(f); if(!m||m.won==null)continue; if(onlyCC&&!m.vsCC)continue; if(!m.hasEvents)continue;
  const g=G[m.won?'win':'loss']; g.n++;
  for(const fr of m.frames){ if(fr.tick>60)break;
    for(const e of fr.events){ if(e.type!=='ability'||!e.us)continue;
      const en=fr.bots.filter(b=>b.alive&&!b.us); const hits=en.filter(b=>dd(b,{x:e.tx,y:e.ty})<=BLAST).length;
      if(hits===0)g.earlyWhiff++; else if(hits>=2)g.earlyMulti++; else g.early1++; }
    for(const e of fr.events){ if(e.type==='kill'&&e.us===undefined){} } // noop
  }
  // early kills (our kills by tick 60)
  for(const k of m.events.kills){ if(k.tick<=60&&k.killerUs&&!k.victimUs)g.earlyKills++; }
  // ammo at 120
  const f120=m.frames.find(x=>x.tick>=120)||m.frames[m.frames.length-1];
  g.ammo120+=25-f120.bots.filter(b=>b.us).reduce((s,b)=>s+(b.ammo??0),0);
}
for(const tag of ['win','loss']){ const g=G[tag]; const a=x=>(x/g.n).toFixed(2);
  console.log(`${tag.toUpperCase()} (${g.n}): early(<=60t) single-target ${a(g.early1)}/match | multi ${a(g.earlyMulti)} | whiff ${a(g.earlyWhiff)} | early kills ${a(g.earlyKills)} | ammo spent by t120 ${a(g.ammo120)}`);
}
console.log(`\nIf early single-target count is ~EQUAL in W/L (and wins kill >= as much early), the "don't single-target early" lever is dead (matches v47/v48). If LOSSES single-target far more early for fewer kills, it's real waste.`);
