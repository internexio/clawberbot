// precision_headroom.mjs — How many hits does our 2-tick lead cost us?
// Ability resolves INSTANTLY at the cast tick (damage:10 events land same-tick, no travel),
// but clusterAim leads targets by 2 ticks. We aim ~24u ahead of the impact moment.
// For each of our casts: ground-truth hits (damage:10 events) vs what re-aiming with
// lead 0/1/2/3 would have LANDED at impact, vs an oracle (perfect aim on current positions).
//   node src/clawber/precision_headroom.mjs   [ERA=recent]  [CC=1 -> CC-only]
import fs from 'fs';
import path from 'path';

const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC  = 'ef7e1954-e275-4882-933b-a423946442f5';
const ROOT = path.resolve('match-history');
const ERA = process.env.ERA || 'all';
const CC_ONLY = process.env.CC === '1';
const RECENT_SINCE = '2026-05-30T00:00:00Z';
const R = 150;            // ABL_RADIUS / ability_effect_radius
const ABL_RANGE = 700;

const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function walk(dir) { const o = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) o.push(...walk(p)); else if (e.name.endsWith('.json')) o.push(p); } return o; }

// faithful clusterAim reconstruction, parameterized by leadTicks; returns aim point.
// enemies: [{pos:{x,y}, vel:{x,y}}], primaryIdx = index of caster's nearest enemy
function clusterAim(enemies, primaryIdx, leadTicks) {
  const lead = e => ({ x: e.pos.x + e.vel.x * leadTicks, y: e.pos.y + e.vel.y * leadTicks });
  const leads = enemies.map(lead);
  const primaryLead = leads[primaryIdx];
  if (enemies.length < 2) return primaryLead;
  const reach = [];
  for (let i = 0; i < leads.length; i++) if (i !== primaryIdx && D(leads[i], primaryLead) <= R * 2) reach.push(i);
  const cands = [primaryLead];
  for (let i = 0; i < reach.length; i++) {
    cands.push({ x: (primaryLead.x + leads[reach[i]].x) / 2, y: (primaryLead.y + leads[reach[i]].y) / 2 });
    for (let j = i + 1; j < reach.length; j++)
      cands.push({ x: (primaryLead.x + leads[reach[i]].x + leads[reach[j]].x) / 3, y: (primaryLead.y + leads[reach[i]].y + leads[reach[j]].y) / 3 });
  }
  let best = primaryLead, bestHits = 1;
  for (const c of cands) {
    if (D(c, primaryLead) > R) continue;
    let h = 0; for (const l of leads) if (D(l, c) <= R) h++;
    if (h > bestHits) { bestHits = h; best = c; }
  }
  return best;
}
// oracle: best achievable hits on CURRENT positions (perfect info, instant), primary-anchored
function oracleHits(enemies, primaryIdx) {
  const pts = enemies.map(e => e.pos), pr = pts[primaryIdx];
  const cands = [...pts];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) cands.push({ x: (pts[i].x + pts[j].x) / 2, y: (pts[i].y + pts[j].y) / 2 });
  let best = 1;
  for (const c of cands) {
    if (D(c, pr) > R) continue;                 // anchored: must still hit primary
    let h = 0; for (const p of pts) if (D(p, c) <= R) h++;
    if (h > best) best = h;
  }
  return best;
}
const landedHits = (enemies, aim) => enemies.reduce((n, e) => n + (D(e.pos, aim) <= R ? 1 : 0), 0);

const seen = new Set();
let casts = 0, matchesUsed = 0;
let actualSum = 0;
const landedByLead = { 0: 0, 1: 0, 2: 0, 3: 0 };
let oracleSum = 0, mismatch = 0;

for (const p of walk(ROOT)) {
  let m; try { m = JSON.parse(fs.readFileSync(p)); } catch { continue; }
  if (!m.frames || !m.bots || !m.winner) continue;
  const ag = {}; for (const b of m.bots) ag[b.id] = b.agentId;
  const set = new Set(Object.values(ag));
  if (!set.has(OUR)) continue;
  if (CC_ONLY && !(set.has(CC) && set.size === 2)) continue;
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  if (ERA === 'recent' && (!m.startedAt || m.startedAt < RECENT_SINCE)) continue;
  matchesUsed++;
  const byTick = {}; for (const fr of m.frames) byTick[fr.tick] = fr;

  for (const fr of m.frames) {
    for (const e of (fr.events || [])) {
      if (e.type !== 'ability' || !e.targetPosition || ag[e.botId] !== OUR) continue;
      const T = e.tick ?? fr.tick;
      const cur = byTick[T], prev = byTick[T - 1];
      if (!cur) continue;
      const caster = cur.bots.find(b => b.id === e.botId);
      if (!caster || !caster.alive) continue;
      const enemyBots = cur.bots.filter(b => b.alive && ag[b.id] !== OUR);
      if (!enemyBots.length) continue;
      // velocity from prev frame
      const enemies = enemyBots.map(b => {
        const pp = prev && prev.bots.find(x => x.id === b.id && x.alive);
        return { id: b.id, pos: b.position, vel: pp ? { x: b.position.x - pp.position.x, y: b.position.y - pp.position.y } : { x: 0, y: 0 } };
      });
      // nearest enemy to caster = primary
      let pi = 0, pd = Infinity;
      enemies.forEach((en, i) => { const d = D(caster.position, en.pos); if (d < pd) { pd = d; pi = i; } });
      if (pd > ABL_RANGE) continue;       // out of cast range (bot wouldn't cast); skip
      casts++;
      // ground-truth hits: ability damage (==10) events by this caster at tick T
      const actual = (cur.events || []).filter(x => x.type === 'damage' && x.attackerId === e.botId && x.damage === 10).length;
      actualSum += actual;
      // landed hits at impact (current positions) for each lead value
      for (const L of [0, 1, 2, 3]) landedByLead[L] += landedHits(enemies, clusterAim(enemies, pi, L));
      oracleSum += oracleHits(enemies, pi);
      // sanity: does our lead=2 reconstruction's landed count match ground truth?
      if (landedHits(enemies, clusterAim(enemies, pi, 2)) !== actual) mismatch++;
    }
  }
}

const per = x => (x / casts).toFixed(3);
console.log(`\n=== ERA=${ERA}${CC_ONLY ? ' CC-only' : ''}  matches=${matchesUsed}  our casts=${casts} ===`);
console.log(`ability resolves INSTANTLY (damage same-tick). Bot currently uses lead=2.\n`);
console.log(`ground-truth hits/cast (damage:10 events):   ${per(actualSum)}`);
console.log(`reconstruction sanity — lead=2 vs ground truth mismatch: ${mismatch}/${casts} (${(100*mismatch/casts).toFixed(0)}%)\n`);
console.log(`LANDED hits/cast if we had aimed with lead =`);
for (const L of [0, 1, 2, 3]) console.log(`   lead=${L}: ${per(landedByLead[L])}${L===2?'   <- current':''}`);
console.log(`\noracle (perfect aim on current positions, primary-anchored): ${per(oracleSum)}/cast`);
const cur2 = landedByLead[2] / casts, best0 = landedByLead[0] / casts;
console.log(`\nHEADROOM:`);
console.log(`   lead 2->0 gain: ${(best0 - cur2).toFixed(3)} hits/cast (${((best0/cur2-1)*100).toFixed(0)}%)`);
console.log(`   to oracle:      ${((oracleSum/casts) - cur2).toFixed(3)} hits/cast remaining`);
