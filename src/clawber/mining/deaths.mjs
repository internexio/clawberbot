// deaths.mjs — per-death primary-cause classifier + attribution dimensions.
// Primary cause (priority): zone > trapped > focused > starved > bad_trade.
// REFINEMENT (2026-06-01): bad_trade is a residual bucket and 71% of its deaths have an
// ally nearby (not the lone 1v1 the §3 gate assumes). So we additionally tag each death
// with orthogonal, more-mechanistic dimensions — lone-ness and local force balance — and
// SPLIT bad_trade by lone-ness, so the lift report can tell whether being LONE or being
// LOCALLY-OUTNUMBERED (both addressable: rally / don't-overextend) is the real signal,
// rather than the HP-based bad_trade correlate.
import { dist, C } from '../parse.mjs';

const ENGAGE_R = 320;           // "local" radius for ally/enemy force counting
const variance = (a) => {
  if (!a.length) return 0;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
};
const get = (fr, id) => fr.bots.find(b => b.id === id);

function analyzeOne(id, w) {
  if (!w.length) return null;
  let outside = 0, n = 0, ammoZero = false, dmgLate = 0;
  let loneTicks = 0, locE = 0, locA = 0;
  const xs = [], ys = [], attackers = new Set();
  for (let k = 0; k < w.length; k++) {
    const fr = w[k], b = get(fr, id); if (!b || !b.alive) continue; n++;
    if (Math.hypot(b.x - fr.zone.cx, b.y - fr.zone.cy) > fr.zone.r) outside++;
    if (b.ammo === 0) ammoZero = true;
    xs.push(b.x); ys.push(b.y);
    const allies = fr.bots.filter(x => x.us && x.alive && x.id !== id);
    const enemies = fr.bots.filter(x => !x.us && x.alive);
    const aNear = allies.filter(x => dist(b, x) < ENGAGE_R).length;
    const eNear = enemies.filter(x => dist(b, x) < ENGAGE_R).length;
    if (aNear === 0) loneTicks++;
    locA += aNear; locE += eNear;
    for (const e of enemies) if (dist(b, e) <= C.ATK_RANGE) attackers.add(e.id);
    if (k >= w.length - 3 && k > 0) { const p = get(w[k - 1], id); if (p) dmgLate += Math.max(0, p.health - b.health); }
  }
  const posVar = variance(xs) + variance(ys);
  const loneFrac = n ? loneTicks / n : 0;
  const localEnemyAvg = n ? locE / n : 0, localAllyAvg = n ? locA / n : 0;

  let badTrade = false; const b0 = get(w[0], id);
  if (b0) {
    let nd = Infinity, ne = null;
    for (const e of w[0].bots) { if (e.us || !e.alive) continue; const d = dist(b0, e); if (d < nd) { nd = d; ne = e; } }
    if (ne && nd <= C.ABL_RANGE && b0.health < ne.health) badTrade = true;
  }
  let cause = 'unknown';
  if (n && outside > n * 0.5) cause = 'zone';
  else if (posVar < 50 && dmgLate > 0) cause = 'trapped';
  else if (attackers.size >= 2) cause = 'focused';
  else if (ammoZero) cause = 'starved';
  else if (badTrade) cause = 'bad_trade';

  return {
    cause,
    lone: loneFrac > 0.5,                                  // no ally within ENGAGE_R for >half the window
    outnumbered: localEnemyAvg > localAllyAvg + 1,         // locally outnumbered at death
  };
}

export function classifyDeaths(m) {
  const F = m.frames;
  const causes = [];
  const features = {
    zone: false, focused: false, trapped: false, bad_trade: false, starved: false,
    bad_trade_lone: false, bad_trade_grouped: false,   // bad_trade split by lone-ness
    death_lone: false, death_outnumbered: false,        // orthogonal mechanistic dimensions
    focused_grouped: false,                             // focused while NOT lone (a pack getting picked apart)
  };
  let prevById = null;
  for (let i = 0; i < F.length; i++) {
    const fr = F[i];
    if (prevById) for (const b of fr.bots) {
      const p = prevById[b.id]; if (!p) continue;
      if (b.us && p.alive && !b.alive) {
        const w = F.slice(Math.max(0, i - 30), i);
        const r = analyzeOne(b.id, w); if (!r) continue;
        causes.push({ tick: fr.tick, ...r });
        if (r.cause in features) features[r.cause] = true;
        if (r.lone) features.death_lone = true;
        if (r.outnumbered) features.death_outnumbered = true;
        if (r.cause === 'bad_trade') features[r.lone ? 'bad_trade_lone' : 'bad_trade_grouped'] = true;
        if (r.cause === 'focused' && !r.lone) features.focused_grouped = true;
      }
    }
    const byId = {}; for (const b of fr.bots) byId[b.id] = b; prevById = byId;
  }
  return { causes, features, deaths: causes.length };
}
