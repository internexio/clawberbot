// validate_pickup_fix.mjs — counterfactual for the pickup-GRAVITY fix on the v44-era corpus.
// Gravity only fires when the bot NEEDS the pickup, so we test the situations it targets: our bot
// within gravity range of a NEEDED pickup (health & hp<70, or ammo & ammo<4) that v44 tended to
// walk past. At each such moment we run v53 (gravity on) and v44 (gravity off) and measure how
// much more pickup-ward v53's move is. Sizes "does gravity pull us toward needed pickups."
import fs from 'fs';
import path from 'path';

const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const GRAV_RANGE = 160;   // a touch above the bot's pull range, to catch near-misses
const load = f => new Function(fs.readFileSync(f, 'utf8') + '\n; return update;')();
const DIR = path.resolve('match-history');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));

let moments = 0, bentToward = 0, projGainSum = 0, angV53Sum = 0, angV44Sum = 0;
let scanned = 0;
for (const f of files) {
  if (scanned >= 120) break;
  let m; try { m = JSON.parse(fs.readFileSync(path.join(DIR, f))); } catch { continue; }
  if (!m.frames || !m.bots) continue;
  const ours = m.bots.filter(b => b.agentId === OUR).map(b => b.id);
  if (!ours.length) continue;
  const won = (() => { const w = m.bots.find(b => b.id === m.winner); return w && w.agentId === OUR; })();
  const dur = m.duration || m.frames[m.frames.length - 1].tick;
  if (won && dur <= 400) continue;     // failure corpus
  scanned++;
  const u53 = load('bots/v53-pickup-gravity.js');
  const u44 = load('bots/v44-safe-pickup-v41base.js');
  for (const fr of m.frames) {
    const pus = fr.powerups || [];
    if (!pus.length) continue;
    for (const id of ours) {
      const self = fr.bots.find(b => b.id === id);
      if (!self || !self.alive) continue;
      // is there a NEEDED pickup within gravity range?
      let best = null, bd = 1e9;
      for (const p of pus) {
        const need = (p.type === 'health' && self.health < 70) || (p.type === 'ammo' && (self.ammo ?? 5) < 4);
        if (!need) continue;
        const d = Math.hypot(p.position.x - self.position.x, p.position.y - self.position.y);
        if (d <= GRAV_RANGE && d > 20 && d < bd) { bd = d; best = p; }
      }
      if (!best) continue;
      const input = { selfId: id, teamBotIds: ours, botNumber: +(String(id).split(':')[1] || 0),
        tick: fr.tick, bots: fr.bots, zone: fr.zone, powerups: pus };
      let a53, a44; try { a53 = u53(input); a44 = u44(input); } catch { continue; }
      if (!(a53 && a53.type === 'move' && a53.direction) || !(a44 && a44.type === 'move' && a44.direction)) continue;
      // unit vector toward the pickup
      const tx = best.position.x - self.position.x, ty = best.position.y - self.position.y;
      const tn = Math.hypot(tx, ty) || 1; const ux = tx / tn, uy = ty / tn;
      const proj = (a) => { const n = Math.hypot(a.direction.x, a.direction.y) || 1; return (a.direction.x * ux + a.direction.y * uy) / n; };
      const p53 = proj(a53), p44 = proj(a44);   // cos(angle to pickup); 1 = straight at it
      moments++;
      projGainSum += (p53 - p44);
      angV53Sum += Math.acos(Math.max(-1, Math.min(1, p53))) * 180 / Math.PI;
      angV44Sum += Math.acos(Math.max(-1, Math.min(1, p44))) * 180 / Math.PI;
      if (p53 > p44 + 0.02) bentToward++;
    }
  }
}
console.log(`v44-era failure corpus (${scanned} matches) — needed-pickup-within-${GRAV_RANGE}u moments: ${moments}`);
console.log(`  v53 move is MORE pickup-ward than v44: ${bentToward}/${moments} (${(100*bentToward/(moments||1)).toFixed(0)}%)`);
console.log(`  mean angle-to-pickup of the move:  v44 ${(angV44Sum/(moments||1)).toFixed(0)}deg  ->  v53 ${(angV53Sum/(moments||1)).toFixed(0)}deg  (lower = more directly toward pickup)`);
console.log(`  mean projection gain (cos toward pickup), v53-v44: +${(projGainSum/(moments||1)).toFixed(3)}`);
