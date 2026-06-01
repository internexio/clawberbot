// analyze.mjs — deterministic packager for the KF analysis layer. Emits a compact
// JSON briefing (lift reports split ALL/CC/non-CC + headline metric contrasts) to
// data/briefing.json. The KF chain (Debugger→Synthesizer→Strategist→Builder→Critic)
// reasons OVER this artifact — it never touches raw frames. This is the LLM boundary.
import fs from 'fs';
import { liftReport } from './mining/lift.mjs';

const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(s => JSON.parse(s));
const matches = readJsonl('data/matches.jsonl');
const metrics = readJsonl('data/metrics.jsonl');
const mx = {}; for (const r of metrics) mx[r.match_id] = r;

function featurize(m) {
  const x = mx[m.match_id] || {};
  const f = { ...(m.death_features || {}) };
  f.spread_tight      = x.mean_spread != null && x.mean_spread < 500;
  f.first_death_early = x.first_death_tick_us != null && x.first_death_tick_us < 60;
  f.highly_exposed    = x.max_exposure_gap > 400;
  f.lost_first_blood  = x.first_blood_us === false;
  f.low_multihit      = x.our_multihit != null && x.our_multihit < 1.5;
  f.outshot_multihit  = x.cc_multihit_on_us != null && x.our_multihit != null && x.cc_multihit_on_us > x.our_multihit;
  f.ammo_bottomed     = x.min_ammo === 0;
  f.behind_at_150     = x.our_alive_150 != null && x.our_alive_150 < x.enemy_alive_150;
  f.slow_contact      = x.time_to_first_contact != null && x.time_to_first_contact > 100;
  return { won: m.won, vs_cc: m.vs_cc, features: f };
}
const all = matches.map(featurize);
const mean = (set, k) => { const v = set.map(m => (mx[m.match_id] || {})[k]).filter(n => typeof n === 'number'); return v.length ? +(v.reduce((s, n) => s + n, 0) / v.length).toFixed(1) : null; };
const contrast = (set) => {
  const W = set.filter(m => m.won), L = set.filter(m => !m.won);
  const keys = ['mean_spread', 'our_multihit', 'cc_multihit_on_us', 'first_death_tick_us', 'max_exposure_gap', 'trade_ratio', 'dmg_dealt', 'dmg_taken'];
  const o = {}; for (const k of keys) o[k] = { win: mean(W, k), loss: mean(L, k) };
  return o;
};

const briefing = {
  generated_for: 'KF analysis layer (Debugger→Synthesizer→Strategist→Builder→Critic)',
  corpus: { matches: matches.length, vs_cc: matches.filter(m => m.vs_cc).length },
  lift: {
    all: liftReport(all),
    cc: liftReport(all.filter(m => m.vs_cc)),
    non_cc: liftReport(all.filter(m => !m.vs_cc)),
  },
  metric_contrast: {
    cc: contrast(matches.filter(m => m.vs_cc)),
    non_cc: contrast(matches.filter(m => !m.vs_cc)),
  },
};
fs.writeFileSync('data/briefing.json', JSON.stringify(briefing, null, 2));
console.log('wrote data/briefing.json');
console.log('CC metric contrast (win vs loss):', JSON.stringify(briefing.metric_contrast.cc));
