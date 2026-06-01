// ammo_economy.mjs — events[]-based opening ammo audit. Are we over-spending on the first kills?
// Per our ability cast: was it productive (multi-hit >=2, or contributed to a kill) or WASTED
// (whiff = 0 enemies within blast; overkill = sole target already <=15 HP; redundant = another
// of our bots cast within BLAST of the same point within 3 ticks)? Track ammo-spend timeline and
// casts/ammo to the first 2 kills. Reads match-history (events) + optional explicit files.
import fs from 'fs';
import path from 'path';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628', BLAST = 150;
const dd = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const args = process.argv.slice(2);

function analyze(m, ourSet) {
  const F = m.frames;
  // collect our ability casts with context
  const casts = [];
  const kills = [];
  for (const fr of F) {
    for (const e of (fr.events || [])) {
      if (e.type === 'ability' && ourSet.has(e.botId)) {
        const enemies = fr.bots.filter(b => b.alive && !ourSet.has(b.id));
        const tp = e.targetPosition;
        const inBlast = enemies.filter(b => dd(b.position, tp) <= BLAST);
        const minHp = inBlast.length ? Math.min(...inBlast.map(b => b.health)) : null;
        casts.push({ tick: fr.tick, bot: e.botId, tp, hits: inBlast.length, minHp });
      }
      if (e.type === 'kill' && ourSet.has(e.killerId) && !ourSet.has(e.victimId)) kills.push(fr.tick);
    }
  }
  // ammo spend timeline (25 total - sum of our ammo at tick)
  const ammoAt = t => { const fr = F.find(f => f.tick >= t) || F[F.length - 1];
    const us = fr.bots.filter(b => ourSet.has(b.id)); return us.reduce((s, b) => s + (b.ammo ?? 0), 0); };
  const spent = t => 25 - ammoAt(t);
  // classify casts
  let whiff = 0, overkill = 0, multi = 0, single = 0, redundant = 0;
  for (let i = 0; i < casts.length; i++) {
    const c = casts[i];
    if (c.hits === 0) whiff++;
    else if (c.hits >= 2) multi++;
    else { single++; if (c.minHp != null && c.minHp <= 15) overkill++; }
    // redundant: another of our casts within BLAST of c.tp within +/-3 ticks
    for (let j = 0; j < casts.length; j++) { if (j === i) continue; const d = casts[j];
      if (Math.abs(d.tick - c.tick) <= 3 && dd(d.tp, c.tp) <= BLAST && d.hits <= 1 && c.hits <= 1) { redundant++; break; } }
  }
  kills.sort((a, b) => a - b);
  const k2 = kills[1] ?? null;
  return { totalCasts: casts.length, spent60: spent(60), spent120: spent(120), spentEnd: 25 - ammoAt(99999),
    whiff, overkill, multi, single, redundant, opening: casts.filter(c => c.tick <= 120).length,
    k2tick: k2, spentByK2: k2 != null ? spent(k2) : null, castsByK2: k2 != null ? casts.filter(c => c.tick <= k2).length : null };
}

function loadRaw(p) { try { const m = JSON.parse(fs.readFileSync(p)); if (!m.frames || !m.bots) return null;
  return { m, ourSet: new Set(m.bots.filter(b => b.agentId === OUR).map(b => b.id)) }; } catch { return null; } }

if (args.length) {                       // explicit replay files (the 3 v57 matches)
  for (const p of args) { const r = loadRaw(p); if (!r) { console.log('skip', p); continue; }
    const a = analyze(r.m, r.ourSet);
    console.log(`\n${path.basename(p)}: casts=${a.totalCasts} (opening<=120: ${a.opening}) | ammo spent t60=${a.spent60}/25 t120=${a.spent120} end=${a.spentEnd}`);
    console.log(`  2nd-kill tick ${a.k2tick}, by then spent ${a.spentByK2} ammo / ${a.castsByK2} casts`);
    console.log(`  cast quality: multi(>=2) ${a.multi}  single ${a.single}  WHIFF(0hit) ${a.whiff}  overkill(<=15hp) ${a.overkill}  redundant ${a.redundant}`); }
}

// aggregate over the corpus
const files = []; (function w(d){ for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) w(p); else if (e.name.endsWith('.json')) files.push(p); } })('match-history');
let n = 0, S = { totalCasts: 0, spent60: 0, spent120: 0, spentEnd: 0, whiff: 0, overkill: 0, multi: 0, single: 0, redundant: 0, opening: 0, k2: 0, spentByK2: 0, castsByK2: 0, k2n: 0 };
for (const f of files) { if (n >= 200) break; const r = loadRaw(f); if (!r || !r.ourSet.size) continue;
  if (!r.m.frames.some(fr => (fr.events || []).length)) continue; n++;
  const a = analyze(r.m, r.ourSet);
  S.totalCasts += a.totalCasts; S.spent60 += a.spent60; S.spent120 += a.spent120; S.spentEnd += a.spentEnd;
  S.whiff += a.whiff; S.overkill += a.overkill; S.multi += a.multi; S.single += a.single; S.redundant += a.redundant; S.opening += a.opening;
  if (a.k2tick != null) { S.k2 += a.k2tick; S.spentByK2 += a.spentByK2; S.castsByK2 += a.castsByK2; S.k2n++; } }
const av = x => (x / n).toFixed(1);
console.log(`\n=== CORPUS (${n} matches with events) — per-match averages ===`);
console.log(`ammo spent: t60 ${av(S.spent60)}/25  t120 ${av(S.spent120)}/25  end ${av(S.spentEnd)}/25   (we have 25 total; >12 by t120 = front-loaded)`);
console.log(`ability casts/match: ${av(S.totalCasts)} (opening<=120: ${av(S.opening)})`);
console.log(`cast quality (total over ${n}): multi ${S.multi} (${(100*S.multi/S.totalCasts).toFixed(0)}%) | single ${S.single} (${(100*S.single/S.totalCasts).toFixed(0)}%) | WHIFF ${S.whiff} (${(100*S.whiff/S.totalCasts).toFixed(0)}%) | overkill ${S.overkill} (${(100*S.overkill/S.totalCasts).toFixed(0)}%) | redundant ${S.redundant} (${(100*S.redundant/S.totalCasts).toFixed(0)}%)`);
console.log(`to 2nd kill (${S.k2n} matches): mean tick ${(S.k2/S.k2n).toFixed(0)}, spent ${(S.spentByK2/S.k2n).toFixed(1)} ammo / ${(S.castsByK2/S.k2n).toFixed(1)} casts`);
console.log(`WASTE = whiff+overkill+redundant = ${S.whiff+S.overkill+S.redundant} casts (${(100*(S.whiff+S.overkill+S.redundant)/S.totalCasts).toFixed(0)}% of casts) ≈ recoverable ammo`);
