// firstblood_exposure.mjs — Does WHO dies first + the exposure of our first-dying bot
// discriminate our CC wins vs losses? Tests the single-target exposed-forward-bot theory.
// Uses explicit kill events (killerId/victimId/tick). For our first-dying bot, measures
// continuous exposure geometry in the 20 ticks before death (not the binary 53/47 prior).
//   node src/clawber/firstblood_exposure.mjs           (full corpus)
//   ERA=recent node src/clawber/firstblood_exposure.mjs (since 2026-05-30)
import fs from 'fs';
import path from 'path';

const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC  = 'ef7e1954-e275-4882-933b-a423946442f5';
const ROOT = path.resolve('match-history');
const ERA = process.env.ERA || 'all';
const RECENT_SINCE = '2026-05-30T00:00:00Z';
const WIN = 20;  // ticks before death to characterize exposure

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function walk(d) { const o = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) o.push(...walk(p)); else if (e.name.endsWith('.json')) o.push(p); } return o; }
function botNum(id) { const m = id.match(/:(\d+)$/); return m ? +m[1] : -1; }

const seen = new Set();
const rows = [];

for (const p of walk(ROOT)) {
  let m; try { m = JSON.parse(fs.readFileSync(p)); } catch { continue; }
  if (!m.frames || !m.bots || !m.winner) continue;
  const agentOf = {}; for (const b of m.bots) agentOf[b.id] = b.agentId;
  const agents = new Set(Object.values(agentOf));
  if (!agents.has(OUR) || !agents.has(CC) || agents.size !== 2) continue;
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  if (ERA === 'recent' && (!m.startedAt || m.startedAt < RECENT_SINCE)) continue;
  const winnerAgent = agentOf[m.winner];
  if (winnerAgent !== OUR && winnerAgent !== CC) continue;
  const weWon = winnerAgent === OUR;

  // collect kills in tick order
  const kills = [];
  for (const fr of m.frames) for (const e of (fr.events || []))
    if (e.type === 'kill' && e.victimId && e.killerId) kills.push({ tick: e.tick ?? fr.tick, killerId: e.killerId, victimId: e.victimId });
  kills.sort((a, b) => a.tick - b.tick);
  // first COMBAT kill (killer is the opposing agent of victim)
  const firstKill = kills.find(k => agentOf[k.killerId] && agentOf[k.victimId] && agentOf[k.killerId] !== agentOf[k.victimId]);
  if (!firstKill) continue;
  const weGotFirstBlood = agentOf[firstKill.killerId] === OUR;
  const fbTick = firstKill.tick;

  // our first-dying bot (first kill whose victim is ours)
  const ourFirstDeath = kills.find(k => agentOf[k.victimId] === OUR);

  // exposure geometry of our first-dying bot in [death-WIN, death-1]
  let exposed = null, isolation = null, expMargin = null, deadRole = null, deathTick = null;
  if (ourFirstDeath) {
    deathTick = ourFirstDeath.tick; deadRole = botNum(ourFirstDeath.victimId);
    const vid = ourFirstDeath.victimId;
    const eD = [], aD = [];
    for (const fr of m.frames) {
      if (fr.tick < deathTick - WIN || fr.tick >= deathTick) continue;
      const self = fr.bots.find(b => b.id === vid && b.alive);
      if (!self) continue;
      const enemies = fr.bots.filter(b => b.alive && agentOf[b.id] === CC);
      const allies = fr.bots.filter(b => b.alive && agentOf[b.id] === OUR && b.id !== vid);
      if (enemies.length) eD.push(Math.min(...enemies.map(b => dist(self.position, b.position))));
      if (allies.length) aD.push(Math.min(...allies.map(b => dist(self.position, b.position))));
    }
    if (eD.length && aD.length) {
      const me = eD.reduce((a, b) => a + b, 0) / eD.length;
      const ma = aD.reduce((a, b) => a + b, 0) / aD.length;
      exposed = me < ma; isolation = ma; expMargin = ma - me;  // +margin = enemy nearer than ally = exposed
    }
  }
  rows.push({ weWon, weGotFirstBlood, fbTick, deathTick, deadRole, exposed, isolation, expMargin });
}

const wins = rows.filter(r => r.weWon), losses = rows.filter(r => !r.weWon);
console.log(`\n=== ERA=${ERA}  qualifying us-vs-CC matches with a combat first-blood: ${rows.length} (${wins.length}W / ${losses.length}L) ===\n`);

// (1) How deterministic is first blood?
const wFB = rows.filter(r => r.weGotFirstBlood), ccFB = rows.filter(r => !r.weGotFirstBlood);
const wr = s => s.length ? (100 * s.filter(r => r.weWon).length / s.length).toFixed(1) : 'n/a';
console.log('(1) FIRST-BLOOD PIVOT — our win rate conditioned on who scores the first combat kill:');
console.log(`    we get first blood : ${wFB.length} matches -> we win ${wr(wFB)}%`);
console.log(`    CC gets first blood: ${ccFB.length} matches -> we win ${wr(ccFB)}%`);
console.log(`    (base rate: we win ${wr(rows)}% overall)`);
const fbShareW = 100 * wins.filter(r => r.weGotFirstBlood).length / wins.length;
const fbShareL = 100 * losses.filter(r => r.weGotFirstBlood).length / losses.length;
console.log(`    we-got-first-blood share: WINS ${fbShareW.toFixed(0)}% vs LOSSES ${fbShareL.toFixed(0)}%`);

// helper stats on a numeric key over a subset
function stat(s, key) { const v = s.map(r => r[key]).filter(x => x != null); if (!v.length) return null; const mu = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length); return { mu, sd, n: v.length }; }
function welch(label, a, b, key) {
  const sa = stat(a, key), sb = stat(b, key); if (!sa || !sb) { console.log(`    ${label}: insufficient`); return; }
  const va = sa.sd ** 2, vb = sb.sd ** 2; const se = Math.sqrt(va / sa.n + vb / sb.n); const t = (sa.mu - sb.mu) / se;
  const p = 2 * (1 - ((x) => (1 + erf(x / Math.SQRT2)) / 2)(Math.abs(t)));
  console.log(`    ${label}: wins=${sa.mu.toFixed(1)} (n${sa.n}) losses=${sb.mu.toFixed(1)} (n${sb.n}) Δ=${(sa.mu - sb.mu).toFixed(1)}  t=${t.toFixed(2)} p≈${p.toFixed(3)}`);
}
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

// (2) first-blood tick
console.log('\n(2) FIRST-BLOOD TICK (when does the first kill land):');
welch('first-blood tick', wins, losses, 'fbTick');

// (3) exposure geometry of our first-dying bot
console.log('\n(3) EXPOSURE of our FIRST-DYING bot (20 ticks pre-death) — continuous, not binary:');
welch('isolation (dist to nearest ally)', wins, losses, 'isolation');
welch('exposure margin (allyDist - enemyDist; + = exposed)', wins, losses, 'expMargin');
const expW = wins.filter(r => r.exposed != null), expL = losses.filter(r => r.exposed != null);
const pct = s => (100 * s.filter(r => r.exposed).length / s.length).toFixed(0);
console.log(`    binary exposed (enemy<ally) rate: WINS ${pct(expW)}% (n${expW.length}) vs LOSSES ${pct(expL)}% (n${expL.length})  [prior: 47 vs 53]`);

// (4) role of first-dying bot
console.log('\n(4) ROLE (botNumber) of our first-dying bot — distribution W vs L:');
function roleDist(s) { const d = [0, 0, 0, 0, 0]; let n = 0; for (const r of s) if (r.deadRole >= 0 && r.deadRole < 5) { d[r.deadRole]++; n++; } return d.map(c => n ? (100 * c / n).toFixed(0) : '0'); }
console.log(`    WINS  : [${roleDist(wins).join(' ')}] %`);
console.log(`    LOSSES: [${roleDist(losses).join(' ')}] %`);
console.log('\n(2)+(3) caveat: tick-74-vs-75 and binary-exposure-53/47 are documented near-nulls;');
console.log('this re-tests at scale + adds CONTINUOUS isolation/margin to catch a graded effect.');
