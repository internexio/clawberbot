// combat.mjs — tempo/damage metrics from DAMAGE SIGNATURES (action field is absent,
// and ammo decrements by 1/shot so it can't distinguish ability from melee).
// Ground truth (game-config.json): melee=5, ability=10, zone=3 dmg.
// An enemy/our bot losing >=9 HP in ONE tick ⇒ an ability landed on it (melee maxes
// at 5; 9 excludes melee+zone=8). Multi-hit = co-damaged targets within one blast.
import { C } from '../parse.mjs';

const ABL_HIT = 9;            // hp drop threshold for "an ability landed"
const CLUSTER_R = 2 * C.ABL_RADIUS; // 300u — two targets one 150r blast could both cover

// max number of points lying within R of a common member (greedy cluster size)
function maxCluster(points, R) {
  if (!points.length) return 0;
  let best = 1;
  for (let i = 0; i < points.length; i++) {
    let c = 1;
    for (let j = 0; j < points.length; j++)
      if (i !== j && Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) <= R) c++;
    if (c > best) best = c;
  }
  return best;
}

export function combatMetrics(m) {
  const F = m.frames;
  let dmgDealt = 0, dmgTaken = 0, shotsFired = 0, minAmmo = 5;
  let ourAblTicks = 0, ourAblHits = 0, ourMultiSum = 0;   // our abilities landing on enemies
  let ccAblTicks = 0, ccAblHits = 0, ccMultiSum = 0;       // enemy abilities landing on us
  let prev = null;
  for (const fr of F) {
    if (prev) {
      const enemHit = [], ourHit = [];
      for (const b of fr.bots) {
        const p = prev[b.id]; if (!p) continue;
        const inZone = Math.hypot(b.x - fr.zone.cx, b.y - fr.zone.cy) <= fr.zone.r;
        const drop = p.health - b.health;
        if (b.us) {
          if (drop > 0 && inZone) dmgTaken += drop;
          if (drop >= ABL_HIT) ourHit.push(b);
          if (b.ammo != null && p.ammo != null) { const ad = p.ammo - b.ammo; if (ad > 0) shotsFired += ad; }
          if (b.ammo != null && b.alive) minAmmo = Math.min(minAmmo, b.ammo);
        } else {
          if (drop > 0) dmgDealt += inZone ? drop : Math.max(0, drop - C.ZONE_DPS);
          if (drop >= ABL_HIT) enemHit.push(b);
        }
      }
      if (enemHit.length) { ourAblTicks++; ourAblHits += enemHit.length; ourMultiSum += maxCluster(enemHit, CLUSTER_R); }
      if (ourHit.length) { ccAblTicks++; ccAblHits += ourHit.length; ccMultiSum += maxCluster(ourHit, CLUSTER_R); }
    }
    const byId = {}; for (const b of fr.bots) byId[b.id] = b; prev = byId;
  }
  return {
    dmg_dealt: Math.round(dmgDealt), dmg_taken: Math.round(dmgTaken),
    trade_ratio: +(dmgDealt / (dmgTaken || 1)).toFixed(2),
    shots_fired: shotsFired, min_ammo: minAmmo,
    our_ability_hits: ourAblHits,
    our_multihit: ourAblTicks ? +(ourMultiSum / ourAblTicks).toFixed(2) : 0,
    cc_ability_hits_on_us: ccAblHits,
    cc_multihit_on_us: ccAblTicks ? +(ccMultiSum / ccAblTicks).toFixed(2) : 0,
    realized_dps: +(dmgDealt / (m.durationTicks || 1)).toFixed(3),
  };
}
