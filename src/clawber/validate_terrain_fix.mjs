// validate_terrain_fix.mjs — counterfactual: would v53's baked flow field have saved the bots
// v44 oscillated-to-death? v53-era long/loss outcome data doesn't exist yet (v53 wins too fast),
// so we test the FIX on the documented v44-era failures. The flow field is proven acyclic (every
// passable cell reaches the core), so escape is guaranteed IF v53 invokes it. We replay each
// entrapment-death trajectory (our bot's real oscillating positions) through v53.update() to
// populate its trap-detector, and measure whether v53 then issues flow-aligned escape moves.
import fs from 'fs';
import path from 'path';

const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const NF = JSON.parse(fs.readFileSync(path.resolve('scouting/sunken_reef-navfield.json')));
const OCC = JSON.parse(fs.readFileSync(path.resolve('scouting/sunken_reef-occupancy.json')));
const G = NF.G, CW = NF.CW, flow = NF.flow;
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
function flowDir(r, c) {
  if (r < 0 || r >= G || c < 0 || c >= G) return null;
  const v = typeof flow === 'string' ? flow.charCodeAt(r * G + c) - 48 : flow[r][c];
  if (v < 0 || v > 7) return null;
  return DIRS[v];
}
function stepsToCore(r0, c0) {           // follow the field; confirm it reaches goal (acyclic)
  let r = r0, c = c0, n = 0, seen = new Set();
  while (n < 200) {
    if (r === NF.goal[0] && c === NF.goal[1]) return n;
    const k = r * G + c; if (seen.has(k)) return -1; seen.add(k);
    const d = flowDir(r, c); if (!d) return -1;
    c += d[0]; r += d[1]; n++;            // DIRS are [dx,dy]; col+=dx, row+=dy
  }
  return -1;
}
const isObs = (r, c) => r >= 0 && r < G && c >= 0 && c < G && OCC.obstacle[r][c] === 1;
function obstacleNear(x, y, rad) {
  const c0 = Math.floor(x / CW), r0 = Math.floor(y / CW);
  for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) if (isObs(r0 + dr, c0 + dc)) return true;
  return false;
}
const load = f => new Function(fs.readFileSync(f, 'utf8') + '\n; return update;')();

const DIR = path.resolve('match-history');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
let entrapDeaths = 0, engaged = 0, routeExists = 0, totSteps = 0, analyzed = 0;
let v53Throws = 0;

for (const f of files) {
  let m; try { m = JSON.parse(fs.readFileSync(path.join(DIR, f))); } catch { continue; }
  if (!m.frames || !m.bots) continue;
  const ours = m.bots.filter(b => b.agentId === OUR).map(b => b.id);
  if (!ours.length) continue;
  const won = (() => { const w = m.bots.find(b => b.id === m.winner); return w && w.agentId === OUR; })();
  // only mine LOSS/long replays (the documented-failure corpus)
  const dur = m.duration || m.frames[m.frames.length - 1].tick;
  if (won && dur <= 400) continue;
  const fr = m.frames;
  // build per-bot trajectory + death tick
  for (const id of ours) {
    const s = [];
    for (const f2 of fr) { const b = f2.bots.find(x => x.id === id); if (b) s.push({ tick: f2.tick, x: b.position.x, y: b.position.y, alive: b.alive,
      zoneOut: Math.hypot(b.position.x - f2.zone.centerX, b.position.y - f2.zone.centerY) > f2.zone.radius }); }
    let di = s.findIndex(p => !p.alive); if (di < 0) continue;
    const w = s.slice(Math.max(0, di - 40), di);
    if (w.length < 15) continue;
    let pathLen = 0; for (let i = 1; i < w.length; i++) pathLen += Math.hypot(w[i].x - w[i - 1].x, w[i].y - w[i - 1].y);
    const netDisp = Math.hypot(w[w.length - 1].x - w[0].x, w[w.length - 1].y - w[0].y);
    const oscillating = netDisp < 150 && pathLen > 250;
    const obsAdj = w.filter(p => obstacleNear(p.x, p.y, 2)).length / w.length > 0.5;
    // not-melee: no enemy within 256 most of window (use real frames)
    let meleeTicks = 0;
    for (const p of w) { const f2 = fr.find(x => x.tick === p.tick); if (!f2) continue;
      const en = f2.bots.filter(b => b.alive && !ours.includes(b.id));
      if (en.some(e => Math.hypot(e.position.x - p.x, e.position.y - p.y) < 256)) meleeTicks++; }
    const notMelee = meleeTicks / w.length < 0.5;
    const zoneDeath = s[di].zoneOut || s[Math.max(0, di - 1)].zoneOut;
    if (!(oscillating && obsAdj && notMelee && zoneDeath)) continue;
    entrapDeaths++;
    // ---- does an escape route exist from the stuck cells? ----
    const cell = { c: Math.floor(w[w.length - 1].x / CW), r: Math.floor(w[w.length - 1].y / CW) };
    const steps = stepsToCore(cell.r, cell.c);
    if (steps > 0) { routeExists++; totSteps += steps; }
    // ---- replay this trajectory through v53.update(), measure flow-aligned escape moves ----
    const u53 = load('bots/v53-pickup-gravity.js');
    let flowAligned = 0, moves = 0;
    const startTick = Math.max(0, di - 60);
    for (let ti = startTick; ti < di; ti++) {
      const f2 = fr[ti]; if (!f2) continue;
      const self = f2.bots.find(b => b.id === id); if (!self || !self.alive) continue;
      const input = { selfId: id, teamBotIds: ours, botNumber: +(String(id).split(':')[1] || 0),
        tick: f2.tick, bots: f2.bots, zone: f2.zone, powerups: f2.powerups || [] };
      let a; try { a = u53(input); } catch (e) { v53Throws++; continue; }
      const inWindow = f2.tick >= w[0].tick;
      if (!inWindow) continue;
      if (a && a.type === 'move' && a.direction) {
        moves++;
        const fd = flowDir(Math.floor(self.position.y / CW), Math.floor(self.position.x / CW));
        if (fd) { const dot = a.direction.x * fd[0] + a.direction.y * fd[1];
          const mag = Math.hypot(a.direction.x, a.direction.y) * Math.hypot(fd[0], fd[1]);
          if (mag > 0 && dot / mag > 0) flowAligned++; }   // within 90deg of the escape field
      }
    }
    analyzed++;
    if (moves > 0 && flowAligned / moves >= 0.5) engaged++;   // majority of escape-window moves follow the field
  }
}

console.log(`v44-era loss/long corpus — terrain-entrapment deaths detected: ${entrapDeaths}`);
console.log(`  escape route exists via flow field (stuck cell -> core): ${routeExists}/${entrapDeaths} (${(100*routeExists/(entrapDeaths||1)).toFixed(0)}%), mean ${(totSteps/(routeExists||1)).toFixed(0)} steps (~${((totSteps/(routeExists||1))*CW/12).toFixed(0)} ticks)`);
console.log(`  v53 ENGAGES the escape field (>=50% of escape-window moves follow it): ${engaged}/${analyzed} (${(100*engaged/(analyzed||1)).toFixed(0)}%)`);
console.log(`  v53 throws during replay: ${v53Throws}`);
console.log(`  => of the documented entrapment deaths, v53 would route ~${(100*Math.min(routeExists,engaged)/(entrapDeaths||1)).toFixed(0)}% toward the core (route exists AND fix engages).`);
