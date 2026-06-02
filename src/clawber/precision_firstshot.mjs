// precision_firstshot.mjs — where do our casts MISS/under-hit, and does landing the FIRST
// cast buy the first-blood win? Uses ground-truth damage:10 events (reliable). Closes the loop:
// precision -> first cast lands -> win first blood (the 60/38 pivot) -> win match.
//   node src/clawber/precision_firstshot.mjs   [CC=1]  [ERA=recent]
import fs from 'fs';
import path from 'path';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC = 'ef7e1954-e275-4882-933b-a423946442f5';
const R = 150, ABL_RANGE = 700;
const CC_ONLY = process.env.CC === '1', ERA = process.env.ERA || 'all';
const RECENT_SINCE = '2026-05-30T00:00:00Z';
const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function walk(d){const o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())o.push(...walk(p));else if(e.name.endsWith('.json'))o.push(p);}return o;}
const seen=new Set();

let casts=0, miss=0, single=0, multi=0;             // all-cast outcome distribution
const rangeMiss={melee:[0,0],mid:[0,0],far:[0,0]};  // [misses, total] by caster->nearest range
// per-match: first cast outcome + first-blood + win
const M=[];

for(const p of walk(path.resolve('match-history'))){
  let m;try{m=JSON.parse(fs.readFileSync(p));}catch{continue;}
  if(!m.frames||!m.bots||!m.winner)continue;
  const ag={};for(const b of m.bots)ag[b.id]=b.agentId;const set=new Set(Object.values(ag));
  if(!set.has(OUR))continue; if(CC_ONLY&&!(set.has(CC)&&set.size===2))continue;
  if(m.matchId){if(seen.has(m.matchId))continue;seen.add(m.matchId);}
  if(ERA==='recent'&&(!m.startedAt||m.startedAt<RECENT_SINCE))continue;
  const weWon=ag[m.winner]===OUR;
  const byTick={};for(const fr of m.frames)byTick[fr.tick]=fr;

  // first combat kill -> who got first blood
  const kills=[];
  for(const fr of m.frames)for(const e of(fr.events||[]))
    if(e.type==='kill'&&e.victimId&&e.killerId&&ag[e.killerId]!==ag[e.victimId])kills.push({tick:e.tick??fr.tick,k:e.killerId,v:e.victimId});
  kills.sort((a,b)=>a.tick-b.tick);
  const fb=kills[0]; const weGotFB=fb?ag[fb.k]===OUR:null;

  // collect our casts in tick order, score each by ground-truth hits
  let firstCastHits=null;
  const ourCasts=[];
  for(const fr of m.frames)for(const e of(fr.events||[])){
    if(e.type!=='ability'||!e.targetPosition||ag[e.botId]!==OUR)continue;
    const T=e.tick??fr.tick, cur=byTick[T]; if(!cur)continue;
    const caster=cur.bots.find(b=>b.id===e.botId); if(!caster||!caster.alive)continue;
    const en=cur.bots.filter(b=>b.alive&&ag[b.id]!==OUR); if(!en.length)continue;
    const nd=Math.min(...en.map(b=>D(caster.position,b.position))); if(nd>ABL_RANGE)continue;
    const h=(cur.events||[]).filter(x=>x.type==='damage'&&x.attackerId===e.botId&&x.damage===10).length;
    ourCasts.push({tick:T,h,nd});
  }
  ourCasts.sort((a,b)=>a.tick-b.tick);
  for(const c of ourCasts){
    casts++; if(c.h===0)miss++; else if(c.h===1)single++; else multi++;
    const bk=c.nd<=256?'melee':c.nd<=ABL_RANGE?'mid':'far';
    rangeMiss[bk][1]++; if(c.h===0)rangeMiss[bk][0]++;
  }
  if(ourCasts.length) firstCastHits=ourCasts[0].h;
  M.push({weWon,weGotFB,firstCastHits});
}

const pct=(a,b)=>b?(100*a/b).toFixed(1):'n/a';
console.log(`\n=== ${CC_ONLY?'CC-only':'all'} ERA=${ERA}  matches=${M.length}  casts=${casts} ===`);
console.log(`\n(1) CAST OUTCOME DISTRIBUTION (ground truth):`);
console.log(`   MISS (0 hit): ${pct(miss,casts)}%   single (1): ${pct(single,casts)}%   multi (2+): ${pct(multi,casts)}%`);
console.log(`   miss rate by caster->nearest-enemy range:`);
for(const k of ['melee','mid','far'])console.log(`     ${k}: ${pct(rangeMiss[k][0],rangeMiss[k][1])}% miss (n${rangeMiss[k][1]})`);

const withFC=M.filter(r=>r.firstCastHits!=null);
const fcHit=withFC.filter(r=>r.firstCastHits>=1), fcMiss=withFC.filter(r=>r.firstCastHits===0);
const fcMulti=withFC.filter(r=>r.firstCastHits>=2);
const wr=s=>s.length?pct(s.filter(r=>r.weWon).length,s.length):'n/a';
const fbr=s=>{const v=s.filter(r=>r.weGotFB!=null);return v.length?pct(v.filter(r=>r.weGotFB).length,v.length):'n/a';};
console.log(`\n(2) FIRST-CAST LEVERAGE — does landing our first ability buy the win / first blood?`);
console.log(`   first cast MISSED (0):  ${fcMiss.length} matches -> we win ${wr(fcMiss)}%, we get first blood ${fbr(fcMiss)}%`);
console.log(`   first cast HIT (>=1):   ${fcHit.length} matches -> we win ${wr(fcHit)}%, we get first blood ${fbr(fcHit)}%`);
console.log(`   first cast MULTI (>=2): ${fcMulti.length} matches -> we win ${wr(fcMulti)}%, we get first blood ${fbr(fcMulti)}%`);
console.log(`   (base: we win ${wr(withFC)}%, first blood ${fbr(withFC)}%)`);
console.log(`\n(3) first-cast miss rate: ${pct(fcMiss.length,withFC.length)}% of matches open with a whiffed cast`);
