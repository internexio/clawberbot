// isolation_and_split.mjs — two follow-up theories on the CC matchup:
//  (A) "Weakest = CC bot furthest from its OWN allies" (the cut-off straggler). Does CC expose one,
//      does it die first, and would converging on it redirect us off nearestEnemy (v38 surface)?
//  (B) "Split our team into 2 centroids (2+3)" — natural experiment: does our team's clusteredness
//      (1-cluster vs 2-cluster) at the opening correlate with W/L or with winning first blood?
//   node src/clawber/isolation_and_split.mjs   [ERA=recent]
import fs from 'fs';
import path from 'path';

const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC  = 'ef7e1954-e275-4882-933b-a423946442f5';
const ROOT = path.resolve('match-history');
const ERA = process.env.ERA || 'all';
const RECENT_SINCE = '2026-05-30T00:00:00Z';
const REF_TICK = 40;

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function walk(dir) { const o = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) o.push(...walk(p)); else if (e.name.endsWith('.json')) o.push(p); } return o; }
const cen = bs => ({ x: bs.reduce((s, b) => s + b.position.x, 0) / bs.length, y: bs.reduce((s, b) => s + b.position.y, 0) / bs.length });
const rankOf = (v, arr) => 1 + arr.filter(a => a > v).length;  // rank 1 = LARGEST (most isolated)
// nearest-ally distance for a bot among its own team
const isoOf = (b, team) => { const o = team.filter(t => t.id !== b.id); return o.length ? Math.min(...o.map(t => d(b.position, t.position))) : 0; };
// best 2-cluster (2+3) within-cluster spread vs 1-cluster spread, for 5 points -> "split gain"
function splitGain(pts) {
  if (pts.length < 4) return 0;
  const c1 = cen(pts.map(p => ({ position: p })));
  const spread1 = pts.reduce((s, p) => s + d(p, c1), 0) / pts.length;
  // try all 2-subset / 3-subset partitions, take min total within-cluster mean dist
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const A = [pts[i], pts[j]], B = pts.filter((_, k) => k !== i && k !== j);
    const ca = cen(A.map(p => ({ position: p }))), cb = cen(B.map(p => ({ position: p })));
    const w = (A.reduce((s, p) => s + d(p, ca), 0) + B.reduce((s, p) => s + d(p, cb), 0)) / pts.length;
    if (w < best) best = w;
  }
  return spread1 > 0 ? 1 - best / spread1 : 0;  // fraction of spread removed by splitting (high = naturally 2 clusters)
}

const seen = new Set();
let matches = 0;
const vicIsoRank = []; let isoDies = 0, isoTot = 0, divNum = 0, divDen = 0;
const ccSpread = [];                         // CC nearest-ally dist (are they uniformly wide?)
const split = { winFB: [], loseFB: [], win: [], lose: [] };

for (const p of walk(ROOT)) {
  let m; try { m = JSON.parse(fs.readFileSync(p)); } catch { continue; }
  if (!m.frames || !m.bots || !m.winner) continue;
  const ag = {}; for (const b of m.bots) ag[b.id] = b.agentId;
  const set = new Set(Object.values(ag));
  if (!set.has(OUR) || !set.has(CC) || set.size !== 2) continue;
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  if (ERA === 'recent' && (!m.startedAt || m.startedAt < RECENT_SINCE)) continue;
  const weWon = ag[m.winner] === OUR;
  matches++;

  const kills = [];
  for (const fr of m.frames) for (const e of (fr.events || []))
    if (e.type === 'kill' && e.victimId && e.killerId && ag[e.killerId] !== ag[e.victimId]) kills.push({ tick: e.tick ?? fr.tick, killerId: e.killerId, victimId: e.victimId });
  kills.sort((a, b) => a.tick - b.tick);

  const refFr = m.frames.find(f => f.tick >= REF_TICK) || m.frames[0];
  const ours = refFr.bots.filter(b => b.alive && ag[b.id] === OUR);
  const ccs = refFr.bots.filter(b => b.alive && ag[b.id] === CC);
  if (ours.length < 4 || ccs.length < 2) continue;

  // (A) CC isolation
  const isos = ccs.map(b => ({ id: b.id, iso: isoOf(b, ccs) }));
  isos.forEach(x => ccSpread.push(x.iso));
  const mostIso = isos.slice().sort((a, b) => b.iso - a.iso)[0].id;
  // does most-isolated CC bot die first among CC?
  const firstCC = kills.find(k => ag[k.victimId] === CC);
  if (firstCC) { isoTot++; if (firstCC.victimId === mostIso) isoDies++; }
  // our first-blood victim's isolation rank (1 = most isolated)
  const ourFK = kills.find(k => ag[k.killerId] === OUR && ag[k.victimId] === CC);
  if (ourFK) { const v = refFr.bots.find(b => b.id === ourFK.victimId); if (v && v.alive) vicIsoRank.push(rankOf(isoOf(v, ccs), isos.map(x => x.iso))); }
  // divergence: converge on most-isolated -> how many of our bots redirect off their nearestEnemy
  for (const ob of ours) { const ne = ccs.map(b => ({ id: b.id, dd: d(ob.position, b.position) })).sort((a, b) => a.dd - b.dd)[0].id; divDen++; if (ne !== mostIso) divNum++; }

  // (B) our team split quality at REF
  const sg = splitGain(ours.map(b => b.position));
  (weWon ? split.win : split.lose).push(sg);
  if (ourFK) (weWon ? split.winFB : split.loseFB).push(sg); // when we win first blood, were we split?
}

const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const pr1 = a => a.length ? 100 * a.filter(r => r === 1).length / a.length : NaN;
console.log(`\n=== ERA=${ERA}  matches=${matches} ===`);
console.log(`\n(A) "WEAKEST = CC bot furthest from its own allies" (the cut-off straggler)`);
console.log(`   CC nearest-ally distance — mean ${avg(ccSpread).toFixed(0)}u (this is how WIDE CC plays; if uniformly large, no real straggler)`);
console.log(`   our first-blood victim's CC-isolation rank: avg ${avg(vicIsoRank).toFixed(2)} (1=most isolated; ~${((ccSpread.length? (1+ (4)/2):0)).toFixed(1)}=random), rank-1 ${pr1(vicIsoRank).toFixed(0)}%  (n${vicIsoRank.length})`);
console.log(`   most-isolated CC bot dies first: ${isoDies}/${isoTot} = ${(100*isoDies/isoTot).toFixed(0)}%`);
console.log(`   DIVERGENCE if we converge on it: ${divNum}/${divDen} = ${(100*divNum/divDen).toFixed(0)}% of our bots redirected off nearestEnemy (v38 surface)`);
console.log(`\n(B) "SPLIT our team into 2 centroids (2+3)" — natural experiment on our opening clusteredness`);
console.log(`   split-gain = fraction of team spread removed by a 2+3 partition (high = team already in 2 clusters):`);
console.log(`   our WINS   : ${avg(split.win).toFixed(3)} (n${split.win.length})`);
console.log(`   our LOSSES : ${avg(split.lose).toFixed(3)} (n${split.lose.length})`);
console.log(`   when we WIN first blood : ${avg(split.winFB).toFixed(3)} (n${split.winFB.length})`);
console.log(`   when we LOSE first blood: ${avg(split.loseFB).toFixed(3)} (n${split.loseFB.length})`);
