// converge_weakest.mjs — Tests the "converge fire on the weakest/closest/zone-trapped CC bot
// for first kill" lever, vs the v38 prior (redirect-from-nearestEnemy cost opening DPS).
// Three decisive questions on clean 1v1 us-vs-CC replays:
//  Q1 Do our first-blood victims ALREADY tend to be the weakest by these metrics? (then nearestEnemy
//     already converges -> no gain). Q2 How killable is the "weakest" — does it actually die first?
//  Q3 Divergence: at the opening, how often does the team-weakest enemy != a bot's own nearestEnemy?
//     (high divergence = v38 redux = proven DPS loss).
//   node src/clawber/converge_weakest.mjs   [ERA=recent]
import fs from 'fs';
import path from 'path';

const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC  = 'ef7e1954-e275-4882-933b-a423946442f5';
const ROOT = path.resolve('match-history');
const ERA = process.env.ERA || 'all';
const RECENT_SINCE = '2026-05-30T00:00:00Z';
const REF_TICK = 40;   // opening reference tick for selection geometry

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function walk(d) { const o = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) o.push(...walk(p)); else if (e.name.endsWith('.json')) o.push(p); } return o; }
function centroid(bots) { const x = bots.reduce((s, b) => s + b.position.x, 0) / bots.length, y = bots.reduce((s, b) => s + b.position.y, 0) / bots.length; return { x, y }; }
// rank of value v among arr (1 = smallest); ties share lowest rank
function rankOf(v, arr) { return 1 + arr.filter(a => a < v).length; }

const seen = new Set();
let matches = 0, fbForUs = 0;
const victimRank = { dist: [], hp: [], zone: [] };  // rank of our first-blood victim (1=weakest)
const nVictims = { dist: 0, hp: 0, zone: 0 };
let divergeNum = 0, divergeDen = 0;     // fraction of our bots whose nearestEnemy != team-weakest-by-dist
let weakestDies = 0, weakestTotal = 0;  // does the REF_TICK closest-to-our-centroid CC bot die first?

for (const p of walk(ROOT)) {
  let m; try { m = JSON.parse(fs.readFileSync(p)); } catch { continue; }
  if (!m.frames || !m.bots || !m.winner) continue;
  const agentOf = {}; for (const b of m.bots) agentOf[b.id] = b.agentId;
  const agents = new Set(Object.values(agentOf));
  if (!agents.has(OUR) || !agents.has(CC) || agents.size !== 2) continue;
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  if (ERA === 'recent' && (!m.startedAt || m.startedAt < RECENT_SINCE)) continue;
  matches++;

  // kills in order
  const kills = [];
  for (const fr of m.frames) for (const e of (fr.events || []))
    if (e.type === 'kill' && e.victimId && e.killerId && agentOf[e.killerId] !== agentOf[e.victimId]) kills.push({ tick: e.tick ?? fr.tick, killerId: e.killerId, victimId: e.victimId });
  kills.sort((a, b) => a.tick - b.tick);

  const refFr = m.frames.find(f => f.tick >= REF_TICK) || m.frames[0];
  const zone = refFr.zone;
  const ourAlive = refFr.bots.filter(b => b.alive && agentOf[b.id] === OUR);
  const ccAlive = refFr.bots.filter(b => b.alive && agentOf[b.id] === CC);
  if (!ourAlive.length || ccAlive.length < 2) continue;
  const ourCent = centroid(ourAlive);

  // --- Q3 divergence: team-weakest-by-distance-to-our-centroid vs each bot's nearestEnemy ---
  const ccDistToCent = ccAlive.map(b => ({ id: b.id, d: dist(b.position, ourCent) }));
  const weakestId = ccDistToCent.sort((a, b) => a.d - b.d)[0].id;
  for (const ob of ourAlive) {
    const ne = ccAlive.map(b => ({ id: b.id, d: dist(b.position, ob.position) })).sort((a, b) => a.d - b.d)[0].id;
    divergeDen++; if (ne !== weakestId) divergeNum++;
  }

  // --- Q2 does the REF closest-to-centroid CC bot die first among CC? ---
  const firstCCdeath = kills.find(k => agentOf[k.victimId] === CC);
  if (firstCCdeath) { weakestTotal++; if (firstCCdeath.victimId === weakestId) weakestDies++; }

  // --- Q1 our first-blood victim's weakness rank at REF tick ---
  const ourFirstKill = kills.find(k => agentOf[k.killerId] === OUR && agentOf[k.victimId] === CC);
  if (ourFirstKill) {
    fbForUs++;
    const v = refFr.bots.find(b => b.id === ourFirstKill.victimId);
    if (v && v.alive) {
      const dists = ccAlive.map(b => dist(b.position, ourCent));
      const hps = ccAlive.map(b => b.health);
      const zones = ccAlive.map(b => zone ? zone.radius - dist(b.position, ({x:zone.centerX,y:zone.centerY})) : 0); // small = near edge
      victimRank.dist.push(rankOf(dist(v.position, ourCent), dists)); nVictims.dist++;
      victimRank.hp.push(rankOf(v.health, hps)); nVictims.hp++;
      victimRank.zone.push(rankOf(zone ? zone.radius - dist(v.position, ({x:zone.centerX,y:zone.centerY})) : 0, zones)); nVictims.zone++;
    }
  }
}

const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const pctRank1 = a => 100 * a.filter(r => r === 1).length / a.length;
console.log(`\n=== ERA=${ERA}  matches=${matches}  (REF tick=${REF_TICK}, ~${ccAvg()} CC bots alive) ===`);
function ccAvg() { return '2-5'; }
console.log(`\nQ1 — Our first-blood victim's WEAKNESS RANK among CC bots at t${REF_TICK} (1 = weakest; ~3 = random):`);
console.log(`   closest-to-our-centroid: avg rank ${avg(victimRank.dist).toFixed(2)}, rank-1 ${pctRank1(victimRank.dist).toFixed(0)}%  (n${nVictims.dist})`);
console.log(`   lowest HP              : avg rank ${avg(victimRank.hp).toFixed(2)}, rank-1 ${pctRank1(victimRank.hp).toFixed(0)}%`);
console.log(`   nearest zone edge      : avg rank ${avg(victimRank.zone).toFixed(2)}, rank-1 ${pctRank1(victimRank.zone).toFixed(0)}%`);
console.log(`\nQ2 — Does the t${REF_TICK} closest-to-our-centroid CC bot actually die first among CC?`);
console.log(`   ${weakestDies}/${weakestTotal} = ${(100 * weakestDies / weakestTotal).toFixed(0)}%  (random ~33-40% with 2-3 alive)`);
console.log(`\nQ3 — DIVERGENCE: fraction of our bots whose own nearestEnemy != the team 'weakest' (closest-to-centroid):`);
console.log(`   ${divergeNum}/${divergeDen} = ${(100 * divergeNum / divergeDen).toFixed(0)}%  (this fraction would be REDIRECTED off nearestEnemy = the v38 DPS-loss surface)`);
