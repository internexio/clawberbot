// opponent_report.mjs — per-opponent execution/aim rollup + over-time drift.
// Mines the variable that actually moves outcomes (opponent execution), not our own play.
// Run after backfill: node src/clawber/opponent_report.mjs
import fs from 'fs';
const rows = fs.readFileSync('data/metrics.jsonl', 'utf8').split('\n').filter(Boolean).map(s => JSON.parse(s));

const by = {};
for (const r of rows) {
  const k = r.opponent_agent_id || r.opponent_name || 'unknown';
  (by[k] ||= { name: r.opponent_name || k, rows: [] }).rows.push(r);
}
const mean = (a, k) => { const v = a.map(x => x[k]).filter(x => typeof x === 'number'); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const wr = (a) => a.length ? a.filter(x => x.won).length / a.length : 0;
const f = (x, d = 1) => x == null ? '  -  ' : x.toFixed(d);

const groups = Object.values(by).filter(g => g.rows.length >= 8).sort((a, b) => b.rows.length - a.rows.length);
console.log(`Per-opponent execution (opponents with ≥8 matches; ${groups.length} shown). opp_aim = dmg landed on us per opponent shot.\n`);
console.log('opponent'.padEnd(34) + 'n'.padStart(5) + 'ourWR'.padStart(7) + 'opp_aim'.padStart(9) + 'earlyDmg'.padStart(9) + 'multiHit'.padStart(9) + 'shots'.padStart(7));
for (const g of groups) {
  const n = g.rows.length;
  console.log(g.name.slice(0, 33).padEnd(34) + String(n).padStart(5) + (100 * wr(g.rows)).toFixed(0).padStart(6) + '%' +
    f(mean(g.rows, 'opp_aim'), 2).padStart(9) + f(mean(g.rows, 'opp_early_dmg_to_us'), 0).padStart(9) +
    f(mean(g.rows, 'opp_multihit_on_us'), 2).padStart(9) + f(mean(g.rows, 'opp_shots'), 0).padStart(7));
}

// Over-time drift: opponents with timestamps + ≥12 matches → split earlier/later half by started_at
console.log('\n=== execution DRIFT (earlier half → later half, opponents with ≥12 timestamped matches) ===');
for (const g of groups) {
  const ts = g.rows.filter(r => r.started_at).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  if (ts.length < 12) continue;
  const mid = Math.floor(ts.length / 2);
  const e = ts.slice(0, mid), l = ts.slice(mid);
  const ea = mean(e, 'opp_aim'), la = mean(l, 'opp_aim');
  const ewr = wr(e), lwr = wr(l);
  const drift = ea != null && la != null ? (la - ea).toFixed(2) : '-';
  console.log(`${g.name.slice(0, 28).padEnd(29)} opp_aim ${f(ea, 2)}→${f(la, 2)} (Δ${drift})   ourWR ${(100 * ewr).toFixed(0)}%→${(100 * lwr).toFixed(0)}%   [${e.length}+${l.length}]`);
}
