// opponent.mjs — OPPONENT-side execution/aim metrics (from our POV, enemy = opponent).
// Motivation: win-mining (2026-06-01) showed our wins/losses have identical controllable
// inputs — the variable that actually moves outcomes is how much the OPPONENT lands on us.
// So measure the opponent's execution and track it per-opponent over time.
// Enemy `ammo` is visible in frames → opp shots = enemy ammo decrements; opp_aim = damage
// landed on us per shot. Damage/hit metrics come from our health drops (always available).
import { C } from '../parse.mjs';
const ABL_HIT = 9, CLUSTER_R = 2 * C.ABL_RADIUS;
function maxCluster(pts, R) {
  if (!pts.length) return 0; let best = 1;
  for (let i = 0; i < pts.length; i++) { let c = 1; for (let j = 0; j < pts.length; j++) if (i !== j && Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) <= R) c++; if (c > best) best = c; }
  return best;
}

export function opponentMetrics(m) {
  const F = m.frames;
  let oppShots = 0, oppShotsSeen = false, dmgToUs = 0, earlyDmgToUs = 0;
  let hitTicks = 0, hits = 0, multiSum = 0, firstKillTick = null;
  let prev = null;
  for (const fr of F) {
    if (prev) {
      const ourHit = [];
      for (const b of fr.bots) {
        const p = prev[b.id]; if (!p) continue;
        const inZone = Math.hypot(b.x - fr.zone.cx, b.y - fr.zone.cy) <= fr.zone.r;
        if (b.us) {
          const drop = p.health - b.health;
          if (drop > 0 && inZone) { dmgToUs += drop; if (fr.tick <= 50) earlyDmgToUs += drop; }
          if (drop >= ABL_HIT) ourHit.push(b);
          if (p.alive && !b.alive && firstKillTick === null) firstKillTick = fr.tick;  // opponent's first kill
        } else if (b.ammo != null && p.ammo != null) {
          const ad = p.ammo - b.ammo; if (ad > 0) { oppShots += ad; oppShotsSeen = true; }
        }
      }
      if (ourHit.length) { hitTicks++; hits += ourHit.length; multiSum += maxCluster(ourHit, CLUSTER_R); }
    }
    const byId = {}; for (const b of fr.bots) byId[b.id] = b; prev = byId;
  }
  return {
    opp_shots: oppShotsSeen ? oppShots : null,
    opp_dmg_to_us: Math.round(dmgToUs),
    opp_early_dmg_to_us: Math.round(earlyDmgToUs),
    opp_aim: oppShotsSeen && oppShots > 0 ? +(dmgToUs / oppShots).toFixed(2) : null,  // dmg landed per shot
    opp_ability_hits_on_us: hits,
    opp_multihit_on_us: hitTicks ? +(multiSum / hitTicks).toFixed(2) : 0,
    opp_first_kill_tick: firstKillTick,
  };
}
