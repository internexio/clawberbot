// cc_firing_analysis.mjs — firm the US-vs-CC ability-pacing gap over ALL vsCC replays on disk
// (events[]-based, no force-queuing). Tests: (1) does CC favor multi-hit, (2) does CC SUSTAIN
// ability fire into the mid-game while we go silent (ammo-bottomed). Splits by our win/loss.
import { loadReplay, walkJson, OUR_AGENT } from './parse.mjs';
const BLAST = 150;
const dd = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const files = []; walkJson('match-history', files);
function blank() { return { games: 0, casts: 0, multi: 0, hitsSum: 0, first: [], byTick: [0, 0, 0, 0], spent60: 0, spent120: 0, spentEnd: 0, silentMid: 0 }; }
const groups = { all_us: blank(), all_cc: blank(), win_us: blank(), win_cc: blank(), loss_us: blank(), loss_cc: blank() };

let n = 0;
for (const f of files) {
  const m = loadReplay(f); if (!m || !m.vsCC || !m.hasEvents || m.won == null) continue; n++;
  const tag = m.won ? 'win' : 'loss';
  const sideStats = { us: groups.all_us, cc: groups.all_cc, [`${tag}_us`]: groups[`${tag}_us`], [`${tag}_cc`]: groups[`${tag}_cc`] };
  const first = { us: 9999, cc: 9999 };
  const midCasts = { us: 0, cc: 0 };
  for (const fr of m.frames) {
    for (const e of fr.events) {
      if (e.type !== 'ability') continue;
      const mine = e.us; const key = mine ? 'us' : 'cc';
      const victims = fr.bots.filter(b => b.alive && (mine ? !b.us : b.us));
      const hits = victims.filter(b => dd(b, { x: e.tx, y: e.ty }) <= BLAST).length;
      const t = fr.tick; const bk = t < 60 ? 0 : t < 120 ? 1 : t < 240 ? 2 : 3;
      for (const g of [groups[`all_${key}`], groups[`${tag}_${key}`]]) { g.casts++; g.hitsSum += hits; if (hits >= 2) g.multi++; g.byTick[bk]++; }
      if (t >= 120 && t < 360) midCasts[key]++;
      if (t < first[key]) first[key] = t;
    }
  }
  const amAt = (side, t) => { const fr = m.frames.find(x => x.tick >= t) || m.frames[m.frames.length - 1]; return fr.bots.filter(b => side === 'us' ? b.us : !b.us).reduce((s, b) => s + (b.ammo ?? 0), 0); };
  for (const key of ['us', 'cc']) {
    for (const g of [groups[`all_${key}`], groups[`${tag}_${key}`]]) {
      g.games++; if (first[key] < 9999) g.first.push(first[key]);
      g.spent60 += 25 - amAt(key, 60); g.spent120 += 25 - amAt(key, 120); g.spentEnd += 25 - amAt(key, 99999);
      if (midCasts[key] <= 2) g.silentMid++;
    }
  }
}
const med = a => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : '-'; };
function show(label, s) {
  if (!s.casts) { console.log(`${label}: no data`); return; }
  console.log(`${label} (${s.games} games, ${s.casts} casts):`);
  console.log(`   multi-hit ${(100 * s.multi / s.casts).toFixed(0)}% | hits/cast ${(s.hitsSum / s.casts).toFixed(2)} | median first-cast t${med(s.first)}`);
  console.log(`   casts by phase  t<60:${s.byTick[0]}  60-120:${s.byTick[1]}  120-240:${s.byTick[2]}  240+:${s.byTick[3]}`);
  console.log(`   ammo spent  t60 ${(s.spent60 / s.games).toFixed(1)}  t120 ${(s.spent120 / s.games).toFixed(1)}  end ${(s.spentEnd / s.games).toFixed(1)} /25  | games we went ~silent mid (≤2 casts t120-360): ${s.silentMid}/${s.games} (${(100 * s.silentMid / s.games).toFixed(0)}%)`);
}
console.log(`=== ${n} vsCC matches with events ===\n--- ALL ---`); show('US', groups.all_us); show('CC', groups.all_cc);
console.log('\n--- our WINS ---'); show('US', groups.win_us); show('CC', groups.win_cc);
console.log('\n--- our LOSSES ---'); show('US', groups.loss_us); show('CC', groups.loss_cc);
