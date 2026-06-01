// spatial.mjs — formation/positioning metrics (NO terrain — replays lack tiles).
import { dist } from '../parse.mjs';

function pairwise(bots) {
  let s = 0, n = 0;
  for (let i = 0; i < bots.length; i++)
    for (let j = i + 1; j < bots.length; j++) { s += dist(bots[i], bots[j]); n++; }
  return n ? s / n : 0;
}

export function spatialMetrics(m) {
  const F = m.frames;
  let spreadSum = 0, spreadN = 0, espreadSum = 0, espreadN = 0;
  let dcSum = 0, dcN = 0, gapSum = 0, gapN = 0, neSum = 0, neN = 0;
  let spreadT40 = null, stuckEvents = 0, moveChecks = 0;
  const dcs = []; let prev = null;
  for (const fr of F) {
    const ours = fr.bots.filter(b => b.us && b.alive);
    const ens = fr.bots.filter(b => !b.us && b.alive);
    if (ours.length >= 2) {
      const sp = pairwise(ours); spreadSum += sp; spreadN++;
      if (spreadT40 === null && fr.tick >= 40) spreadT40 = sp;
    }
    if (ens.length >= 2) { espreadSum += pairwise(ens); espreadN++; }
    if (ours.length) {
      const cx = ours.reduce((s, b) => s + b.x, 0) / ours.length;
      const cy = ours.reduce((s, b) => s + b.y, 0) / ours.length;
      const dc = Math.hypot(cx - fr.zone.cx, cy - fr.zone.cy); dcSum += dc; dcN++; dcs.push(dc);
    }
    if (ours.length && ens.length) {
      let maxGap = -Infinity, minNE = Infinity;
      for (const b of ours) {
        let ne = Infinity; for (const e of ens) { const d = dist(b, e); if (d < ne) ne = d; }
        let na = Infinity; for (const o of ours) { if (o.id === b.id) continue; const d = dist(b, o); if (d < na) na = d; }
        if (ne < minNE) minNE = ne;
        const g = na - ne; if (g > maxGap) maxGap = g;
      }
      gapSum += maxGap; gapN++; neSum += minNE; neN++;
    }
    if (prev) for (const b of fr.bots) {
      if (!b.us || !b.alive) continue; const p = prev[b.id]; if (!p) continue;
      moveChecks++; if (Math.hypot(b.x - p.x, b.y - p.y) < 1) stuckEvents++;
    }
    const byId = {}; for (const b of fr.bots) byId[b.id] = b; prev = byId;
  }
  dcs.sort((a, b) => a - b);
  return {
    mean_spread: Math.round(spreadSum / (spreadN || 1)),
    spread_t40: spreadT40 == null ? null : Math.round(spreadT40),
    enemy_spread: Math.round(espreadSum / (espreadN || 1)),
    mean_dist_center: Math.round(dcSum / (dcN || 1)),
    p90_dist_center: dcs.length ? Math.round(dcs[Math.floor(dcs.length * 0.9)]) : 0,
    max_exposure_gap: gapN ? Math.round(gapSum / gapN) : 0,
    mean_min_enemy: neN ? Math.round(neSum / neN) : 0,
    stuck_rate: moveChecks ? +(stuckEvents / moveChecks).toFixed(3) : 0,
  };
}
