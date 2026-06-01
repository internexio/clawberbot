// validate_forage.mjs — v54 vs v55 over real frames (shared _s, real positions fed each tick).
// (1) Does v55 forage where v54 huddles? (2) SAFETY: does the lone-gate prevent it from heading
// into isolation (the #1 loss driver)? Measures pickup-ward move divergence + isolation exposure.
import fs from 'fs';
import path from 'path';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628', SPEED = 12;
const dd = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const load = f => new Function(fs.readFileSync(f, 'utf8') + '\n; return update;')();
const DIR = 'match-history'; const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
let scanned = 0, throws = 0;
let forageEngaged = 0, v54Forage = 0, bothHuddle = 0, usefulTicks = 0;
let exposureV55 = 0, exposureV54 = 0;       // forage-move that heads into isolation (nearest ally would exceed 300)
let projV54 = 0, projV55 = 0;

for (const fn of files) {
  if (scanned >= 80) break;
  let m; try { m = JSON.parse(fs.readFileSync(path.join(DIR, fn))); } catch { continue; }
  if (!m.frames || !m.bots) continue;
  const ours = m.bots.filter(b => b.agentId === OUR).map(b => b.id); if (!ours.length) continue;
  const won = (() => { const w = m.bots.find(b => b.id === m.winner); return w && w.agentId === OUR; })();
  const dur = m.duration || m.frames[m.frames.length - 1].tick;
  if (won && dur <= 400) continue;          // failure/long corpus (where foraging matters)
  scanned++;
  const u54 = load('bots/v54-cf1-gate.js'), u55 = load('bots/v55-forage.js');
  for (const fr of m.frames) {
    const en = fr.bots.filter(b => b.alive && !ours.includes(b.id));
    for (const id of ours) {
      const self = fr.bots.find(b => b.id === id); if (!self || !self.alive) continue;
      const allies = fr.bots.filter(b => b.alive && ours.includes(b.id) && b.id !== id);
      // best useful pickup within forage range
      let best = null, bd = 1e9;
      for (const p of (fr.powerups || [])) {
        const useful = (p.type === 'health' && self.health < 85) || (p.type === 'ammo' && (self.ammo ?? 5) < 4);
        if (!useful) continue; const d = dd(p.position, self.position);
        if (d < bd && d > 20 && d < 400) { bd = d; best = p; }
      }
      const input = { selfId: id, teamBotIds: ours, botNumber: +(String(id).split(':')[1] || 0),
        tick: fr.tick, bots: fr.bots, zone: fr.zone, powerups: fr.powerups || [] };
      let a54, a55; try { a54 = u54(input); a55 = u55(input); } catch (e) { throws++; continue; }
      if (!best) continue;
      usefulTicks++;
      const ux = (best.position.x - self.position.x) / bd, uy = (best.position.y - self.position.y) / bd;
      const proj = a => (a && a.type === 'move' && a.direction)
        ? (a.direction.x * ux + a.direction.y * uy) / (Math.hypot(a.direction.x, a.direction.y) || 1) : -1;
      const p54 = proj(a54), p55 = proj(a55);
      projV54 += Math.max(-1, p54); projV55 += Math.max(-1, p55);
      const f54 = p54 > 0.6, f55 = p55 > 0.6;
      if (f55 && !f54) forageEngaged++; else if (f54 && !f55) v54Forage++; else if (!f54 && !f55) bothHuddle++;
      // SAFETY: would moving toward this pickup head into isolation? (nearest ally dist at the pickup)
      const allyAtPickup = allies.length ? Math.min(...allies.map(a => dd(a.position, best.position))) : Infinity;
      if (f55 && allyAtPickup > 300) exposureV55++;
      if (f54 && allyAtPickup > 300) exposureV54++;
    }
  }
}
console.log(`v54-vs-v55 over ${scanned} loss/long games — useful-pickup-in-range ticks: ${usefulTicks}, throws ${throws}`);
console.log(`  mean pickup-ward proj:  v54 ${(projV54/(usefulTicks||1)).toFixed(2)}  ->  v55 ${(projV55/(usefulTicks||1)).toFixed(2)}`);
console.log(`  v55 FORAGES where v54 huddles: ${forageEngaged}  | v54-only forage: ${v54Forage}  | both huddle: ${bothHuddle}`);
console.log(`  SAFETY — forage move toward an ISOLATED pickup (no ally within 300u): v55 ${exposureV55}  vs v54 ${exposureV54}`);
console.log(`  => v55 forages ~${(forageEngaged/scanned).toFixed(1)}x/game more than v54; isolation-exposure delta ${exposureV55-exposureV54} (lone-gate holds if ~0/low).`);
