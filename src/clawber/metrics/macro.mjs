// macro.mjs — battle-royale outcome-shape metrics.
import { dist, C } from '../parse.mjs';

export function macroMetrics(m) {
  const F = m.frames;
  let firstDeathUs = null, firstEnemyDeath = null, ttfc = null;
  let prevById = null;
  for (const fr of F) {
    if (ttfc === null) {
      outer:
      for (const b of fr.bots) {
        if (!b.us || !b.alive) continue;
        for (const e of fr.bots) {
          if (e.us || !e.alive) continue;
          if (dist(b, e) <= C.ATK_RANGE) { ttfc = fr.tick; break outer; }
        }
      }
    }
    if (prevById) for (const b of fr.bots) {
      const p = prevById[b.id]; if (!p) continue;
      if (p.alive && !b.alive) {
        if (b.us) { if (firstDeathUs === null) firstDeathUs = fr.tick; }
        else if (firstEnemyDeath === null) firstEnemyDeath = fr.tick;
      }
    }
    const byId = {}; for (const b of fr.bots) byId[b.id] = b; prevById = byId;
  }
  const at = (tk) => { let best = F[0]; for (const fr of F) { if (fr.tick <= tk) best = fr; else break; } return best; };
  const cnt = (fr, us) => fr.bots.filter(b => b.us === us && b.alive).length;
  const f150 = at(150), fend = F[F.length - 1];

  // pickups collected by us (proxy): a powerup present last tick is gone this tick
  // with one of our alive bots within the 48u collection radius (+buffer).
  let pickupsUs = 0, prevPU = null, prevBots = null;
  for (const fr of F) {
    if (prevPU) {
      const cur = new Set(fr.powerups.map(p => p.id));
      for (const p of prevPU) if (!cur.has(p.id)) {
        const near = prevBots.some(b => b.us && b.alive && Math.hypot(b.x - p.x, b.y - p.y) <= 60);
        if (near) pickupsUs++;
      }
    }
    prevPU = fr.powerups; prevBots = fr.bots;
  }

  return {
    first_death_tick_us: firstDeathUs,
    first_enemy_death_tick: firstEnemyDeath,
    first_blood_us: firstEnemyDeath != null && (firstDeathUs == null || firstEnemyDeath < firstDeathUs),
    time_to_first_contact: ttfc,
    our_alive_150: cnt(f150, true), enemy_alive_150: cnt(f150, false),
    our_alive_end: cnt(fend, true), enemy_alive_end: cnt(fend, false),
    pickups_collected_us: pickupsUs,
  };
}
