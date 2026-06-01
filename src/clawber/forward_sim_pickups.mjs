// forward_sim_pickups.mjs — clean offline pickup-collection number. Our 5 bots are SIM-driven by
// the policy; enemies + pickups + zone come from the real replay each tick; our HP/ammo/alive are
// read from the real bot (proxy that keeps need-gates honest and stops sim-bots when the real bot
// died). A pickup is "collected" when a sim-bot comes within COLLECT(48)u of a still-live one.
// Move applied at SPEED, blocked by the occupancy obstacle grid. Same method for v54 vs candidates.
//   node src/clawber/forward_sim_pickups.mjs [bot1.js bot2.js ...]   (default: v54 v56)
import fs from 'fs';
import path from 'path';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628', SPEED = 12, COLLECT = 48;
const OCC = JSON.parse(fs.readFileSync(path.resolve('scouting/sunken_reef-occupancy.json')));
const isObs = (x, y) => { const c = Math.floor(x / 32), r = Math.floor(y / 32); return r >= 0 && r < 64 && c >= 0 && c < 64 && OCC.obstacle[r][c] === 1; };
const dd = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const load = f => new Function(fs.readFileSync(f, 'utf8') + '\n; return update;')();
const CANDS = process.argv.slice(2); if (!CANDS.length) CANDS.push('bots/v54-cf1-gate.js', 'bots/v56-directional-forage.js');

function simMatch(updateFactory, m, ourIds) {
  const update = updateFactory();           // fresh _s
  const F = m.frames;
  const sim = {}; for (const id of ourIds) { const b0 = F[0].bots.find(x => x.id === id); if (b0) sim[id] = { x: b0.x ?? b0.position?.x, y: b0.y ?? b0.position?.y }; }
  // pre-read real positions/state per tick (parsed frames use {x,y,health,ammo,alive})
  const collected = new Set(); let nCollected = 0, distTravelled = 0, forageMoves = 0;
  for (let t = 0; t < F.length; t++) {
    const fr = F[t];
    const realOur = {}; for (const b of fr.bots) if (ourIds.includes(b.id)) realOur[b.id] = b;
    const enemies = fr.bots.filter(b => !ourIds.includes(b.id)).map(b => ({ id: b.id, position: { x: b.x, y: b.y }, health: b.health, ammo: b.ammo, alive: b.alive, team: 1 }));
    const liveP = (fr.powerups || []).filter(p => !collected.has(p.id)).map(p => ({ id: p.id, type: p.type, position: { x: p.x, y: p.y }, expiresAtTick: p.expiresAtTick }));
    const ourBots = ourIds.map(id => { const r = realOur[id]; if (!r || !sim[id]) return null;
      return { id, position: { x: sim[id].x, y: sim[id].y }, health: r.health, ammo: r.ammo, alive: r.alive, team: 0 }; }).filter(Boolean);
    const bots = ourBots.concat(enemies);
    const zone = { centerX: fr.zone.cx, centerY: fr.zone.cy, radius: fr.zone.r };
    for (const id of ourIds) {
      const r = realOur[id]; if (!r || !r.alive || !sim[id]) continue;
      const input = { selfId: id, teamBotIds: ourIds, botNumber: +(String(id).split(':')[1] || 0), tick: fr.tick, bots, zone, powerups: liveP };
      let a; try { a = update(input); } catch { continue; }
      if (a && a.type === 'move' && a.direction) {
        const dm = Math.hypot(a.direction.x, a.direction.y) || 1;
        const nx = sim[id].x + (a.direction.x / dm) * SPEED, ny = sim[id].y + (a.direction.y / dm) * SPEED;
        if (!isObs(nx, ny)) { distTravelled += Math.hypot(nx - sim[id].x, ny - sim[id].y); sim[id].x = nx; sim[id].y = ny; }
        // forage-commit proxy: move heads (>0.7) at a live pickup within 360u
        for (const p of liveP) { const d = dd(p.position, sim[id]); if (d > 20 && d < 360) {
          const pr = ((a.direction.x / dm) * (p.position.x - sim[id].x) / d + (a.direction.y / dm) * (p.position.y - sim[id].y) / d);
          if (pr > 0.7) { forageMoves++; break; } } }
      }
      // collection check
      for (const p of liveP) { if (!collected.has(p.id) && dd(p.position, sim[id]) <= COLLECT) { collected.add(p.id); nCollected++; } }
    }
  }
  return { nCollected, forageMoves, distTravelled };
}

// load matches once
const files = []; (function walk(d){ for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) files.push(p); } })('match-history');
import { loadReplay } from './parse.mjs';
const matches = []; let scanned = 0;
for (const f of files) { if (scanned >= 60) break; const m = loadReplay(f); if (!m || m.won == null) continue; if (m.won && m.durationTicks <= 400) continue; matches.push(m); scanned++; }

const factories = CANDS.map(c => [c, () => load(c)]);
console.log(`forward-sim pickup collection over ${matches.length} loss/long matches (real enemies/pickups/zone; our bots policy-driven)`);
for (const [name, fac] of factories) {
  let coll = 0, forage = 0, dist = 0, totalP = 0;
  for (const m of matches) { const ourIds = [...m.ourIds]; const r = simMatch(fac, m, ourIds); coll += r.nCollected; forage += r.forageMoves; dist += r.distTravelled;
    totalP += new Set((m.frames.flatMap(f => (f.powerups || []).map(p => p.id)))).size; }
  console.log(`  ${path.basename(name).padEnd(28)} collected ${coll} (${(coll/matches.length).toFixed(2)}/game, ${(100*coll/totalP).toFixed(1)}% of ${totalP} spawned)  forage-moves ${forage} (${(forage/matches.length).toFixed(0)}/game)`);
}
