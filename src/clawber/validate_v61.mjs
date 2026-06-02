// Counterfactual: v60 vs v61 over real frames (fresh _s per match, real state each tick).
// Surgical claim: the ONLY behavioral change is the clusterAim lead (2->1). So EVERY divergence
// must be an ability-vs-ability cast with only targetPosition shifted (~small). Any ACTION-TYPE
// flip (ability<->move/attack/idle) would mean the ABL_LEAD change leaked into gate logic
// (e.g. the CF-1 abWorth path) and must be scrutinized. Also checks: throws, total cast counts.
import fs from 'fs';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const load = f => new Function(fs.readFileSync(f, 'utf8') + '\n; return update;')();
const DIR = 'match-history';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
let scanned = 0, throws = 0, ticks = 0, diverge = 0;
let abVsAb = 0, typeFlip = 0, cast60 = 0, cast61 = 0;
let maxShift = 0, shiftSum = 0;
const flipSamples = [];
for (const fn of files) {
  if (scanned >= 500) break;
  let m; try { m = JSON.parse(fs.readFileSync(DIR + '/' + fn)); } catch { continue; }
  if (!m.frames || !m.bots) continue;
  const ours = m.bots.filter(b => b.agentId === OUR).map(b => b.id);
  if (!ours.length) continue;
  scanned++;
  const u60 = load('bots/v60-last-ammo.js'), u61 = load('bots/v61-lead-fix.js');
  for (const fr of m.frames) {
    for (const id of ours) {
      const self = fr.bots.find(b => b.id === id); if (!self || !self.alive) continue;
      const input = { selfId: id, teamBotIds: ours, botNumber: +(String(id).split(':')[1] || 0),
        tick: fr.tick, bots: fr.bots, zone: fr.zone, powerups: fr.powerups || [] };
      let a, b; try { a = u60(input); b = u61(input); } catch (e) { throws++; continue; }
      ticks++;
      if (a && a.type === 'ability') cast60++;
      if (b && b.type === 'ability') cast61++;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      diverge++;
      if (a && b && a.type === 'ability' && b.type === 'ability') {
        abVsAb++;
        const s = Math.hypot(a.targetPosition.x - b.targetPosition.x, a.targetPosition.y - b.targetPosition.y);
        shiftSum += s; if (s > maxShift) maxShift = s;
      } else {
        typeFlip++;
        if (flipSamples.length < 8) flipSamples.push(`${fn.slice(0,12)} t${fr.tick} ammo${self.ammo}: v60=${a&&a.type} v61=${b&&b.type}`);
      }
    }
  }
}
console.log(`v60-vs-v61 over ${scanned} games — decisions: ${ticks}, throws ${throws}`);
console.log(`  divergent decisions: ${diverge} (${(100*diverge/ticks).toFixed(2)}%)`);
console.log(`  ability-vs-ability (only aim shifted): ${abVsAb} (${diverge?(100*abVsAb/diverge).toFixed(1):0}% of divergences) <- SHOULD be ~100%`);
console.log(`  ACTION-TYPE FLIPS: ${typeFlip} (${diverge?(100*typeFlip/diverge).toFixed(1):0}%) <- should be ~0; any non-zero = gate leak`);
console.log(`  aim shift on cast divergences: mean ${abVsAb?(shiftSum/abVsAb).toFixed(1):0}u, max ${maxShift.toFixed(1)}u (expect <=~24u, 1 tick @ 12u)`);
console.log(`  total ability casts: v60=${cast60}  v61=${cast61}  (Δ ${cast61-cast60}, ${(100*(cast61-cast60)/cast60).toFixed(2)}%) <- CF-1 gate effect`);
if (flipSamples.length) { console.log('  type-flip samples:'); flipSamples.forEach(s => console.log('    ' + s)); }
