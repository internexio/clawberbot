// death_lone_analysis.mjs — characterize WHY our bots die isolated (the #1 loss driver, lift 3.6).
// For each of our deaths, decide if it was LONE (no living ally within 320u), then split:
//   last_survivor  — <=1 ally still alive (not isolation; just the endgame of a loss)
//   never_converged— was far from the pack since spawn (~tick 40) and stayed far
//   chase_overextend— diverged from pack AND closed on an enemy in the last ~40t (chased out)
//   rally_failed   — was converging toward the pack (dist shrinking) but died before reaching it
//   stray_other    — diverged from pack, not clearly chasing
// Split CC vs non-CC. This tells us the fix: anti-stray / better-rally / anti-chase / unavoidable.
import { loadReplay, walkJson, dist } from './parse.mjs';

const ENGAGE_R = 320, WIN = 40, SPAWN_T = 40;
const files = []; walkJson('match-history', files);
const cat = {}, catCC = {};
let loneDeaths = 0, loneDeathsCC = 0, allDeaths = 0;
const bump = (o, k) => o[k] = (o[k] || 0) + 1;
let strayDistSum = 0, strayN = 0, loneDurSum = 0;

let scanned = 0;
for (const f of files) {
  const m = loadReplay(f); if (!m || m.won == null) continue;
  if (m.won && m.durationTicks <= 400) continue;          // failure/long corpus
  scanned++;
  const F = m.frames;
  let prev = null;
  for (let i = 0; i < F.length; i++) {
    const fr = F[i];
    if (prev) for (const b of fr.bots) {
      const p = prev[b.id]; if (!p || !p.us) continue;
      if (p.alive && !b.alive) {                            // our bot died at frame i
        allDeaths++;
        const w = F.slice(Math.max(0, i - WIN), i);
        if (w.length < 8) continue;
        const di = i;
        // state at death
        const livingAllies = F[di - 1].bots.filter(x => x.us && x.alive && x.id !== b.id);
        const nearAlly = livingAllies.length ? Math.min(...livingAllies.map(a => dist(p, a))) : Infinity;
        const isLone = nearAlly > ENGAGE_R;
        if (!isLone) continue;
        loneDeaths++; if (m.vsCC) loneDeathsCC++;
        const C = m.vsCC ? catCC : cat;
        // last-survivor?
        if (livingAllies.length <= 1) { bump(C, 'last_survivor'); continue; }
        // trajectory over the window: distance to living-ally centroid, start vs end
        const packAt = (fr2) => { const al = fr2.bots.filter(x => x.us && x.alive && x.id !== b.id);
          if (!al.length) return null; return { x: al.reduce((s, a) => s + a.x, 0) / al.length, y: al.reduce((s, a) => s + a.y, 0) / al.length }; };
        const selfAt = (fr2) => fr2.bots.find(x => x.id === b.id);
        const pk0 = packAt(w[0]), pkN = packAt(w[w.length - 1]);
        const s0 = selfAt(w[0]), sN = selfAt(w[w.length - 1]);
        const dPack0 = pk0 && s0 ? dist(s0, pk0) : 0, dPackN = pkN && sN ? dist(sN, pkN) : 0;
        const divergence = dPackN - dPack0;                 // + = moving away from pack
        // enemy approach over window
        const enAt = (fr2, s) => { const en = fr2.bots.filter(x => !x.us && x.alive); return en.length ? Math.min(...en.map(e => dist(s, e))) : Infinity; };
        const de0 = s0 ? enAt(w[0], s0) : Infinity, deN = sN ? enAt(w[w.length - 1], sN) : Infinity;
        const enemyApproach = de0 - deN;                    // + = closing on enemy (chasing)
        // spawn-era pack distance
        const spawnFr = F.find(fx => fx.tick >= SPAWN_T); const ss = spawnFr ? selfAt(spawnFr) : null; const sp = spawnFr ? packAt(spawnFr) : null;
        const earlyPackDist = ss && sp ? dist(ss, sp) : 0;
        // lone duration before death
        let lone = 0; for (let k = w.length - 1; k >= 0; k--) { const s = selfAt(w[k]); const pk = packAt(w[k]); if (s && pk && dist(s, pk) > ENGAGE_R) lone++; else break; }
        strayDistSum += nearAlly; strayN++; loneDurSum += lone;
        if (earlyPackDist > 400 && divergence > -20) bump(C, 'never_converged');
        else if (divergence > 50 && enemyApproach > 30) bump(C, 'chase_overextend');
        else if (divergence < -20) bump(C, 'rally_failed');
        else bump(C, 'stray_other');
      }
    }
    const by = {}; for (const b of fr.bots) by[b.id] = b; prev = by;
  }
}
const show = (label, o, tot) => { console.log(`\n${label} (${tot} lone deaths):`);
  for (const [k, v] of Object.entries(o).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}  (${(100 * v / (tot || 1)).toFixed(0)}%)`); };
console.log(`corpus ${scanned} loss/long matches | our deaths ${allDeaths} | LONE deaths ${loneDeaths} (${(100*loneDeaths/(allDeaths||1)).toFixed(0)}% of deaths), of which vs CC ${loneDeathsCC}`);
console.log(`mean nearest-ally-dist at lone death: ${(strayDistSum/(strayN||1)).toFixed(0)}u | mean lone-duration before death: ${(loneDurSum/(strayN||1)).toFixed(0)}t`);
show('ALL opponents', cat, loneDeaths - loneDeathsCC + Object.values(catCC).reduce((a,b)=>a+b,0) - Object.values(catCC).reduce((a,b)=>a+b,0));
const totNon = Object.values(cat).reduce((a,b)=>a+b,0), totCC = Object.values(catCC).reduce((a,b)=>a+b,0);
show('vs NON-CC', cat, totNon);
show('vs CC', catCC, totCC);
