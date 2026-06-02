// blast_colocation.mjs — Does CC's AoE multi-hit on OUR bots discriminate our wins vs losses?
// Tests the user's hypothesis: "CC beats us via spread → their blasts hit multiple of our bots."
// For every CC ability cast, count OUR alive bots inside the 150u blast (us-victims).
// Split per-match by W/L. Reciprocally measure OUR blast on CC as a sanity anchor (~1.56 prior).
//   node src/clawber/blast_colocation.mjs            (full corpus)
//   ERA=recent node src/clawber/blast_colocation.mjs (since 2026-05-30, current-formation era)
import fs from 'fs';
import path from 'path';

const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC  = 'ef7e1954-e275-4882-933b-a423946442f5';
const BLAST = 150;
const ROOT = path.resolve('match-history');
const ERA = process.env.ERA || 'all';            // 'all' | 'recent'
const RECENT_SINCE = '2026-05-30T00:00:00Z';
// OPENING restricts to the first-blood window AND requires all 5 of our bots still alive,
// removing the "fewer alive bots in losses -> mechanically fewer multi-hits" confound.
const OPENING = process.env.OPENING === '1';
const OPEN_TICK = 60;

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// recursively collect all *.json under match-history
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const seen = new Set();   // dedupe by matchId
const rows = [];          // per-match aggregates

for (const p of walk(ROOT)) {
  let m; try { m = JSON.parse(fs.readFileSync(p)); } catch { continue; }
  if (!m.frames || !m.bots || !m.winner) continue;
  const agentOf = {}; for (const b of m.bots) agentOf[b.id] = b.agentId;
  const agents = new Set(Object.values(agentOf));
  if (!agents.has(OUR) || !agents.has(CC)) continue;     // must be us vs CC
  if (agents.size !== 2) continue;                        // 1v1 agent matchup only
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  if (ERA === 'recent' && (!m.startedAt || m.startedAt < RECENT_SINCE)) continue;

  const winnerAgent = agentOf[m.winner];
  if (winnerAgent !== OUR && winnerAgent !== CC) continue;
  const weWon = winnerAgent === OUR;

  // tally CC casts -> our-victims, and our casts -> cc-victims
  let ccCasts = 0, ourHitByCC = 0, ccMulti = 0;          // CC blasting us
  let ourCasts = 0, ccHitByUs = 0, ourMulti = 0;         // us blasting CC
  const ccVictimDist = [0, 0, 0, 0];                     // index = #our bots hit (0,1,2,3+)

  for (const fr of m.frames) {
    if (!fr.events) continue;
    if (OPENING && fr.tick > OPEN_TICK) continue;
    const aliveBots = fr.bots.filter(b => b.alive);
    // confound control: in OPENING mode only count ticks where all 5 of our bots are alive
    if (OPENING && aliveBots.filter(b => agentOf[b.id] === OUR).length < 5) continue;
    for (const e of fr.events) {
      if (e.type !== 'ability' || !e.targetPosition) continue;
      const casterAgent = agentOf[e.botId];
      if (casterAgent === CC) {
        // count OUR alive bots in the blast
        const v = aliveBots.filter(b => agentOf[b.id] === OUR &&
                                        dist(b.position, e.targetPosition) <= BLAST).length;
        ccCasts++; ourHitByCC += v; if (v >= 2) ccMulti++;
        ccVictimDist[Math.min(v, 3)]++;
      } else if (casterAgent === OUR) {
        const v = aliveBots.filter(b => agentOf[b.id] === CC &&
                                        dist(b.position, e.targetPosition) <= BLAST).length;
        ourCasts++; ccHitByUs += v; if (v >= 2) ourMulti++;
      }
    }
  }
  if (ccCasts < (OPENING ? 1 : 3)) continue;   // need some CC fire to characterize the match
  rows.push({
    weWon, ccCasts, ourCasts,
    ccROIonUs: ourHitByCC / ccCasts,            // avg our bots hit per CC cast
    ccMultiRate: ccMulti / ccCasts,             // frac of CC casts hitting 2+ of us
    ourROIonCC: ourCasts ? ccHitByUs / ourCasts : 0,
    ccVictimDist,
  });
}

function summ(label, set) {
  const n = set.length;
  if (!n) { console.log(`${label}: n=0`); return null; }
  const mean = k => set.reduce((s, r) => s + r[k], 0) / n;
  const sd = (k, mu) => Math.sqrt(set.reduce((s, r) => s + (r[k] - mu) ** 2, 0) / n);
  const roi = mean('ccROIonUs'), roiSd = sd('ccROIonUs', roi);
  const mr = mean('ccMultiRate'), mrSd = sd('ccMultiRate', mr);
  const ourRoi = mean('ourROIonCC');
  const dist = [0, 0, 0, 0];
  let totCasts = 0;
  for (const r of set) { r.ccVictimDist.forEach((c, i) => dist[i] += c); totCasts += r.ccCasts; }
  console.log(`${label}: n=${n} matches`);
  console.log(`  CC blast on US   — avg our-bots-hit/cast: ${roi.toFixed(3)} (sd ${roiSd.toFixed(2)})`);
  console.log(`  CC multi-hit-us rate (>=2 ours/cast):    ${(100*mr).toFixed(1)}% (sd ${(100*mrSd).toFixed(0)}pp)`);
  console.log(`  OUR blast on CC  — avg cc-bots-hit/cast:  ${ourRoi.toFixed(3)}  [sanity anchor]`);
  console.log(`  CC cast outcome dist (over ${totCasts} casts): 0=${(100*dist[0]/totCasts).toFixed(0)}% 1=${(100*dist[1]/totCasts).toFixed(0)}% 2=${(100*dist[2]/totCasts).toFixed(0)}% 3+=${(100*dist[3]/totCasts).toFixed(0)}%`);
  return { n, roi, roiSd, mr, mrSd };
}

// Welch t-test (unequal variance) on the per-match means
function welch(label, a, b, key) {
  const m = s => s.reduce((x, r) => x + r[key], 0) / s.length;
  const v = (s, mu) => s.reduce((x, r) => x + (r[key] - mu) ** 2, 0) / (s.length - 1);
  const ma = m(a), mb = m(b), va = v(a, ma), vb = v(b, mb);
  const se = Math.sqrt(va / a.length + vb / b.length);
  const t = (ma - mb) / se;
  // df approx, then rough two-tailed p via normal for |t| (good enough at these n)
  const p = 2 * (1 - normcdf(Math.abs(t)));
  console.log(`  Δ ${label}: wins=${ma.toFixed(3)} losses=${mb.toFixed(3)} Δ=${(ma-mb).toFixed(3)}  t=${t.toFixed(2)} p≈${p.toFixed(3)}`);
}
function normcdf(x) { return (1 + erf(x / Math.SQRT2)) / 2; }
function erf(x) { const t = 1/(1+0.3275911*Math.abs(x)); const y = 1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x); return x>=0?y:-y; }

const wins = rows.filter(r => r.weWon), losses = rows.filter(r => !r.weWon);
console.log(`\n=== ERA=${ERA}  total qualifying us-vs-CC matches: ${rows.length} (${wins.length}W / ${losses.length}L) ===\n`);
console.log('HYPOTHESIS: if CC wins by multi-hitting our clustered bots, LOSSES should show');
console.log('higher CC-ROI-on-us and higher CC multi-hit-us rate than WINS.\n');
summ('WINS', wins);
console.log('');
summ('LOSSES', losses);
console.log('\n--- discrimination (wins vs losses) ---');
if (wins.length >= 2 && losses.length >= 2) {
  welch('CC avg our-bots-hit/cast', wins, losses, 'ccROIonUs');
  welch('CC multi-hit-us rate', wins, losses, 'ccMultiRate');
}
