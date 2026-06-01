// huddle_window_analysis.mjs — find the wasteful "huddle" windows and profile their state so we can
// set v58's pursue-trigger thresholds. A huddle tick: our team balled near center (tight spread,
// near zone-center), NOT in melee combat (<2 of our bots have an enemy within ATK), >=1 live enemy,
// >=2 of our bots alive. Profile HP/ammo/zr/advantage/nearest-enemy during huddles; split win/loss;
// then calibrate which gate cutoffs cover the wasteful huddles (capable: healthy+ahead) cleanly.
import { loadReplay, walkJson, C } from './parse.mjs';
const dd = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const files = []; walkJson('match-history', files);

const pct = (arr, p) => { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const huddleTicks = { win: [], loss: [] };   // each entry: {hp,ammoCast,zr,adv,nearE,nEnem,tick}
let totMatch = { win: 0, loss: 0 }, huddleMatchTicks = { win: 0, loss: 0 };

for (const f of files) {
  const m = loadReplay(f); if (!m || m.won == null) continue;
  const tag = m.won ? 'win' : 'loss'; totMatch[tag]++;
  for (const fr of m.frames) {
    const us = fr.bots.filter(b => b.us && b.alive); const en = fr.bots.filter(b => !b.us && b.alive);
    if (us.length < 2 || en.length < 1) continue;
    // team geometry
    const cx = us.reduce((s, b) => s + b.x, 0) / us.length, cy = us.reduce((s, b) => s + b.y, 0) / us.length;
    let sp = 0, np = 0; for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) { sp += dd(us[i], us[j]); np++; } sp = np ? sp / np : 0;
    const distCtr = Math.hypot(cx - fr.zone.cx, cy - fr.zone.cy);
    const inMelee = us.filter(b => en.some(e => dd(b, e) <= C.ATK_RANGE)).length;
    const huddle = sp < 250 && distCtr < 230 && inMelee < 2;     // balled near center, not fighting
    if (!huddle) continue;
    huddleMatchTicks[tag]++;
    const meanHp = us.reduce((s, b) => s + b.health, 0) / us.length;
    const castable = us.filter(b => (b.ammo ?? 0) >= 2).length / us.length;
    const adv = us.length - en.length;
    let nearE = Infinity; for (const b of us) for (const e of en) { const d = dd(b, e); if (d < nearE) nearE = d; }
    huddleTicks[tag].push({ hp: meanHp, ammoCast: castable, zr: fr.zone.r, adv, nearE, nEnem: en.length, tick: fr.tick });
  }
}

function profile(tag) {
  const H = huddleTicks[tag]; if (!H.length) { console.log(`${tag}: no huddle ticks`); return; }
  const col = k => H.map(h => h[k]);
  console.log(`\n=== ${tag.toUpperCase()} — ${H.length} huddle ticks across ${totMatch[tag]} matches (${(huddleMatchTicks[tag]/totMatch[tag]).toFixed(0)} huddle-ticks/match) ===`);
  console.log(`  mean HP:     p10 ${pct(col('hp'),.1).toFixed(0)}  p50 ${pct(col('hp'),.5).toFixed(0)}  p90 ${pct(col('hp'),.9).toFixed(0)}`);
  console.log(`  zone radius: p10 ${pct(col('zr'),.1).toFixed(0)}  p50 ${pct(col('zr'),.5).toFixed(0)}  p90 ${pct(col('zr'),.9).toFixed(0)}`);
  console.log(`  castable%:   p10 ${(pct(col('ammoCast'),.1)*100).toFixed(0)}  p50 ${(pct(col('ammoCast'),.5)*100).toFixed(0)}  p90 ${(pct(col('ammoCast'),.9)*100).toFixed(0)}  (% bots w/ ammo>=2)`);
  console.log(`  advantage:   p10 ${pct(col('adv'),.1)}  p50 ${pct(col('adv'),.5)}  p90 ${pct(col('adv'),.9)}  (ourAlive - enemyAlive)`);
  console.log(`  nearEnemy:   p10 ${pct(col('nearE'),.1).toFixed(0)}  p50 ${pct(col('nearE'),.5).toFixed(0)}  p90 ${pct(col('nearE'),.9).toFixed(0)}`);
  console.log(`  tick:        p10 ${pct(col('tick'),.1)}  p50 ${pct(col('tick'),.5)}  p90 ${pct(col('tick'),.9)}`);
}
profile('win'); profile('loss');

// calibration: of huddle ticks, fraction that are CAPABLE (healthy+ahead+ammo-poor+zone-large+enemy-reachable)
function frac(tag, pred) { const H = huddleTicks[tag]; return H.length ? (100 * H.filter(pred).length / H.length).toFixed(0) : '-'; }
console.log('\n=== gate coverage on huddle ticks (what % of huddles each gate admits) ===');
for (const tag of ['win', 'loss']) {
  console.log(`${tag}: ammoPoor(<2cast≥60%) ${frac(tag,h=>h.ammoCast<=0.4)} | HP>40 ${frac(tag,h=>h.hp>40)} | zr>600 ${frac(tag,h=>h.zr>600)} | adv>=1 ${frac(tag,h=>h.adv>=1)} | enemy<700 ${frac(tag,h=>h.nearE<700)} | ALL ${frac(tag,h=>h.ammoCast<=0.4&&h.hp>40&&h.zr>600&&h.adv>=1&&h.nearE<700)}`);
}
