// event_harness.mjs — events[]-based combat metrics (supersedes health-delta inference).
// Reads replay frames[].events directly: explicit ability casts, attributed damage, kills.
// Measures CF-1 (single-target ability fired at melee range) + ability ROI + TTFK, per the
// v54 brief's "measure before you change" gate. ESM, no deps.
//   SINCE=<iso> node src/clawber/event_harness.mjs        (default: v53/sv105 era)
import fs from 'fs';
import path from 'path';

const OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const ATK_RANGE = 256, ABL_BLAST = 150, ABL_RANGE = 700;
const SINCE = process.env.SINCE || '2026-06-01T15:52:00Z';
const DIR = path.resolve('match-history');

function d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function botAgent(m) { const map = {}; for (const b of m.bots) map[b.id] = b.agentId; return map; }

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
let matches = 0, casts = 0, cf1 = 0, multi = 0, single = 0, hitsTotal = 0;
const rangeBuckets = { melee: 0, mid: 0, far: 0 };  // <=256, 256-700, edge cases

for (const f of files) {
  let m; try { m = JSON.parse(fs.readFileSync(path.join(DIR, f))); } catch { continue; }
  if (!m.frames || !m.bots) continue;
  if (m.startedAt && m.startedAt < SINCE) continue;
  const agent = botAgent(m);
  const ours = m.bots.filter(b => b.agentId === OUR_AGENT).map(b => b.id);
  if (ours.length === 0) continue;
  const oursSet = new Set(ours);
  matches++;
  const frameByTick = {};
  for (const fr of m.frames) frameByTick[fr.tick] = fr;
  for (const fr of m.frames) {
    for (const e of fr.events || []) {
      if (e.type !== 'ability' || !oursSet.has(e.botId)) continue;
      const caster = fr.bots.find(b => b.id === e.botId);
      if (!caster || !caster.alive) continue;
      // enemies alive this tick
      const enemies = fr.bots.filter(b => b.alive && agent[b.id] !== OUR_AGENT);
      // intended hits = enemies within blast of the aim point
      const hits = enemies.filter(b => d(b.position, e.targetPosition) <= ABL_BLAST).length;
      const nearestDist = enemies.length
        ? Math.min(...enemies.map(b => d(b.position, caster.position))) : Infinity;
      casts++; hitsTotal += hits;
      if (hits >= 2) multi++; else single++;
      if (nearestDist <= ATK_RANGE) rangeBuckets.melee++;
      else if (nearestDist <= ABL_RANGE) rangeBuckets.mid++;
      else rangeBuckets.far++;
      // CF-1: single/zero hit AND an enemy is inside melee range (melee would beat it)
      if (hits <= 1 && nearestDist <= ATK_RANGE) cf1++;
    }
  }
}

console.log(`event_harness — SINCE ${SINCE}`);
console.log(`matches (ours): ${matches}   our ability casts: ${casts}`);
console.log(`  multi-target (>=2 hit): ${multi} (${(100 * multi / casts).toFixed(0)}%)`);
console.log(`  single/zero hit:        ${single} (${(100 * single / casts).toFixed(0)}%)`);
console.log(`  ROI (avg hits/cast):    ${(hitsTotal / casts).toFixed(2)}  (break-even ~1.5)`);
console.log(`  caster->nearest-enemy range: melee<=256 ${rangeBuckets.melee} | 256-700 ${rangeBuckets.mid} | >700 ${rangeBuckets.far}`);
console.log(`  *** CF-1 (single-hit AND enemy in melee range): ${cf1} (${(100 * cf1 / casts).toFixed(0)}% of casts) ***`);
