// report.mjs — EPIC-3 runner. Derive boolean features (death causes + thresholded
// metrics) and emit the lift report, split ALL / vs-CC / non-CC.
// Run after backfill: node src/clawber/report.mjs
import fs from 'fs';
import { liftReport } from './mining/lift.mjs';

const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(s => JSON.parse(s));
const matches = readJsonl('data/matches.jsonl');
const metrics = readJsonl('data/metrics.jsonl');
const mx = {}; for (const r of metrics) mx[r.match_id] = r;

// thresholds: coarse/integer first (per the tuning rule); refine only after they prove out.
function featurize(m) {
  const x = mx[m.match_id] || {};
  const f = { ...(m.death_features || {}) };
  f.spread_tight       = x.mean_spread != null && x.mean_spread < 500;
  f.first_death_early  = x.first_death_tick_us != null && x.first_death_tick_us < 60;
  f.highly_exposed     = x.max_exposure_gap > 400;
  f.lost_first_blood   = x.first_blood_us === false;
  f.low_multihit       = x.our_multihit != null && x.our_multihit < 1.5;
  f.outshot_multihit   = x.cc_multihit_on_us != null && x.our_multihit != null && x.cc_multihit_on_us > x.our_multihit;
  f.ammo_bottomed      = x.min_ammo === 0;
  f.behind_at_150      = x.our_alive_150 != null && x.our_alive_150 < x.enemy_alive_150;
  f.slow_contact       = x.time_to_first_contact != null && x.time_to_first_contact > 100;
  return { won: m.won, vs_cc: m.vs_cc, features: f };
}
const all = matches.map(featurize);

function cell(v, w) { return String(v).padStart(w); }
function show(label, set) {
  const r = liftReport(set);
  console.log(`\n=== LIFT: ${label}  (W=${r.n_win} L=${r.n_loss}, min-N≥30 ${r.gate_ok ? 'OK' : 'NOT MET'}) ===`);
  console.log('feature'.padEnd(19) + 'L/W#'.padStart(8) + 'p_loss'.padStart(8) + 'p_win'.padStart(7) + 'lift'.padStart(8) + 'score'.padStart(8) + '  flag');
  for (const row of r.rows) {
    const lift = row.lift == null ? 'inf*' : row.lift;
    const flag = !row.reliable ? 'low-N' : '';
    console.log(row.feature.padEnd(19) + cell(`${row.loss_n}/${row.win_n}`, 8) + cell(row.p_loss, 8) + cell(row.p_win, 7) + cell(lift, 8) + cell(row.score, 8) + '  ' + flag);
  }
}
show('ALL opponents', all);
show('vs CrabCrusher', all.filter(m => m.vs_cc));
show('vs non-CC', all.filter(m => !m.vs_cc));
