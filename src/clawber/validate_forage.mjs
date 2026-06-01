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
  const u54 = load('bots/v54-cf1-gate.js'), u55 = load('bots/v56-directional-forage.js');
  for (const fr of m.frames) {
    const en = fr.bots.filter(b => b.alive && !ours.includes(b.id));
    for (const id of ours) {
      const self = fr.bots.find(b => b.id === id); if (!self || !self.alive) continue;
      const allies = fr.bots.filter(b => b.alive && ours.includes(b.id) && b.id !== id);
      const en2 = fr.bots.filter(b => b.alive && !ours.includes(b.id));
      const usefulPs = (fr.powerups || []).filter(p => { const d = dd(p.position, self.position);
        return d > 20 && d < 450 && ((p.type === 'health' && self.health < 85) || (p.type === 'ammo' && (self.ammo ?? 5) < 4)); });
      if (!usefulPs.length) continue;
      const input = { selfId: id, teamBotIds: ours, botNumber: +(String(id).split(':')[1] || 0),
        tick: fr.tick, bots: fr.bots, zone: fr.zone, powerups: fr.powerups || [] };
      let a54, a55; try { a54 = u54(input); a55 = u55(input); } catch (e) { throws++; continue; }
      usefulTicks++;
      // forage = a MOVE aligned (>0.6) with SOME useful pickup; pick the best-aligned one.
      const bestProj = a => { if (!(a && a.type === 'move' && a.direction)) return { proj: -1, p: null };
        const m = Math.hypot(a.direction.x, a.direction.y) || 1; let bp = -1, bpk = null;
        for (const p of usefulPs) { const d = dd(p.position, self.position) || 1;
          const pr = (a.direction.x * (p.position.x - self.position.x) / d + a.direction.y * (p.position.y - self.position.y) / d) / m;
          if (pr > bp) { bp = pr; bpk = p; } } return { proj: bp, p: bpk }; };
      const r54 = bestProj(a54), r55 = bestProj(a55);
      projV54 += Math.max(-1, r54.proj); projV55 += Math.max(-1, r55.proj);
      const f54 = r54.proj > 0.6, f55 = r55.proj > 0.6;
      if (f55 && !f54) forageEngaged++; else if (f54 && !f55) v54Forage++; else if (!f54 && !f55) bothHuddle++;
      // SAFETY: of v55's forage moves, is it AWAY from the enemy (safe) and not into isolation?
      if (f55 && r55.p) {
        let nd = 1e9, ne = null; for (const e of en2) { const d = dd(e.position, self.position); if (d < nd) { nd = d; ne = e; } }
        const ux = (r55.p.position.x - self.position.x) / (dd(r55.p.position, self.position) || 1), uy = (r55.p.position.y - self.position.y) / (dd(r55.p.position, self.position) || 1);
        const ndAfter = ne ? Math.hypot(self.position.x + ux * 12 - ne.position.x, self.position.y + uy * 12 - ne.position.y) : 1e9;
        const allyAtPickup = allies.length ? Math.min(...allies.map(a => dd(a.position, r55.p.position))) : Infinity;
        if (ndAfter <= nd && allyAtPickup > 300) exposureV55++;   // toward-enemy AND isolating = the bad case
      }
    }
  }
}
console.log(`v54-vs-v55 over ${scanned} loss/long games — useful-pickup-in-range ticks: ${usefulTicks}, throws ${throws}`);
console.log(`  mean pickup-ward proj:  v54 ${(projV54/(usefulTicks||1)).toFixed(2)}  ->  v55 ${(projV55/(usefulTicks||1)).toFixed(2)}`);
console.log(`  v55 FORAGES where v54 huddles: ${forageEngaged}  | v54-only forage: ${v54Forage}  | both huddle: ${bothHuddle}`);
console.log(`  SAFETY — forage move toward an ISOLATED pickup (no ally within 300u): v55 ${exposureV55}  vs v54 ${exposureV54}`);
console.log(`  => v55 forages ~${(forageEngaged/scanned).toFixed(1)}x/game more than v54; isolation-exposure delta ${exposureV55-exposureV54} (lone-gate holds if ~0/low).`);
