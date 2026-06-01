// cc_reactivity.mjs — does CC READ/counter our opening (reactive) or run a FIXED paced play?
import { loadReplay, walkJson } from './parse.mjs';
const files = []; walkJson('match-history', files);
const dd = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cen = bots => { const a = bots.filter(b => b.alive); if (!a.length) return null; return { x: a.reduce((s, b) => s + b.x, 0) / a.length, y: a.reduce((s, b) => s + b.y, 0) / a.length }; };
const spread = bots => { const a = bots.filter(b => b.alive); let s = 0, n = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { s += dd(a[i], a[j]); n++; } return n ? s / n : 0; };

let n = 0;
const ourSpr40 = [], ccSpr40 = [];          // for mirroring correlation
let ourEarlyMove = 0, ccEarlyMove = 0;      // centroid displacement, first 40 ticks (who commits)
let ourMidMove = 0, ccMidMove = 0;          // ticks 40-80
const ccSpr40all = [];                      // for invariance (CV)
// lead/lag cross-correlation accumulators: corr(our_adv[t], cc_adv[t+k])
const LAGS = [-2,-1,0,1,2]; const xc = {}; for (const k of LAGS) xc[k] = { sxy: 0, sx: 0, sy: 0, sxx: 0, syy: 0, nn: 0 }; // lag in STEPS (1 step=4 ticks)

for (const f of files) {
  const m = loadReplay(f); if (!m || !m.vsCC) continue;
  const F = m.frames; if (F.length < 80) continue; n++;
  const our = t => F[t] ? F[t].bots.filter(b => b.us) : [];
  const cc = t => F[t] ? F[t].bots.filter(b => !b.us) : [];
  // mirroring + invariance at tick ~40
  const f40 = F.find(x => x.tick >= 40); if (f40) { const os = spread(f40.bots.filter(b => b.us)), cs = spread(f40.bots.filter(b => !b.us)); ourSpr40.push(os); ccSpr40.push(cs); ccSpr40all.push(cs); }
  // centroid displacement windows
  const disp = (a, b) => { const c0 = cen(a), c1 = cen(b); return c0 && c1 ? dd(c0, c1) : 0; };
  ourEarlyMove += disp(F[0].bots.filter(b => b.us), (F.find(x => x.tick >= 40) || F[0]).bots.filter(b => b.us));
  ccEarlyMove += disp(F[0].bots.filter(b => !b.us), (F.find(x => x.tick >= 40) || F[0]).bots.filter(b => !b.us));
  // adv series: how much each centroid moved TOWARD the other's centroid per ~4-tick step
  const adv = [];
  for (let t = 4; t < 80 && t < F.length; t += 4) {
    const oc0 = cen(F[t - 4].bots.filter(b => b.us)), oc1 = cen(F[t].bots.filter(b => b.us));
    const cc0 = cen(F[t - 4].bots.filter(b => !b.us)), cc1 = cen(F[t].bots.filter(b => !b.us));
    if (!oc0 || !oc1 || !cc0 || !cc1) continue;
    const ourAdv = dd(oc0, cc0) - dd(oc1, cc0);   // our centroid closing toward CC's (positive=approach)
    const ccAdv = dd(cc0, oc0) - dd(cc1, oc0);    // CC centroid closing toward ours
    adv.push({ ourAdv, ccAdv });
  }
  // cross-correlate
  for (const k of LAGS) { for (let i = 0; i < adv.length; i++) { const j = i + k; if (j < 0 || j >= adv.length) continue;
    const x = adv[i].ourAdv, y = adv[j].ccAdv; const a = xc[k]; a.sxy += x * y; a.sx += x; a.sy += y; a.sxx += x * x; a.syy += y * y; a.nn++; } }
}
function pearson(sx, sy, sxy, sxx, syy, nn) { const cov = sxy / nn - (sx / nn) * (sy / nn); const vx = sxx / nn - (sx / nn) ** 2, vy = syy / nn - (sy / nn) ** 2; return cov / (Math.sqrt(vx * vy) || 1); }
// mirroring corr
const N = ourSpr40.length; const mx = ourSpr40.reduce((a, b) => a + b, 0) / N, my = ccSpr40.reduce((a, b) => a + b, 0) / N;
let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < N; i++) { sxy += (ourSpr40[i] - mx) * (ccSpr40[i] - my); sxx += (ourSpr40[i] - mx) ** 2; syy += (ccSpr40[i] - my) ** 2; }
const mirror = sxy / (Math.sqrt(sxx * syy) || 1);
const ccMean = my, ccSd = Math.sqrt(syy / N), ccCV = ccSd / ccMean;
console.log(`=== CC reactivity over ${n} vsCC matches ===`);
console.log(`\n1. LEAD/LAG (corr of our-approach[t] vs CC-approach[t+k]); peak at k>0 => CC LAGS us (reactive):`);
for (const k of LAGS) { const a = xc[k]; console.log(`   lag ${k>=0?'+':''}${k*4}t: r=${pearson(a.sx, a.sy, a.sxy, a.sxx, a.syy, a.nn).toFixed(3)}`); }
console.log(`\n2. MIRRORING: corr(our spread@t40, CC spread@t40) = ${mirror.toFixed(3)}  (high+ => CC mirrors our formation/adapts; ~0 => independent)`);
console.log(`\n3. INVARIANCE: CC opening spread@t40 mean ${ccMean.toFixed(0)}u, sd ${ccSd.toFixed(0)}, CV ${ccCV.toFixed(2)}  (low CV<~0.3 => fixed opening; high => variable)`);
console.log(`\n4. WHO COMMITS EARLY: centroid displacement t0->t40  US ${(ourEarlyMove / n).toFixed(0)}u  vs  CC ${(ccEarlyMove / n).toFixed(0)}u  (if CC<<US, CC holds/waits early)`);
