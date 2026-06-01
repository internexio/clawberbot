// terrain_overlay.mjs — overlay our recorded trajectories on the Sunken Reef obstacle
// grid to quantify terrain-entrapment deaths. Replays lack tiles, so terrain comes from
// the one-time vision-extracted grid (scouting/sunken_reef-grid.json). One static map.
// Run: node src/clawber/terrain_overlay.mjs
import fs from 'fs';
import { parseReplay, walkJson, dist } from './parse.mjs';

// Prefer the deterministic occupancy grid (bot negative-space) over the vision grid.
const GRID_PATH = fs.existsSync('scouting/sunken_reef-occupancy.json')
  ? 'scouting/sunken_reef-occupancy.json' : 'scouting/sunken_reef-grid.json';
const G = JSON.parse(fs.readFileSync(GRID_PATH));
console.log(`grid source: ${GRID_PATH} (${G.source || 'vision'})`);
const N = G.grid, CW = G.cellWorld, obstacle = G.obstacle;
const cellOf = (x, y) => [Math.min(N - 1, Math.max(0, Math.floor(y / CW))), Math.min(N - 1, Math.max(0, Math.floor(x / CW)))];
const isObs = (r, c) => r >= 0 && r < N && c >= 0 && c < N && obstacle[r][c] === 1;
function obstacleNear(x, y, rad) {
  const [r, c] = cellOf(x, y);
  for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) if (isObs(r + dr, c + dc)) return true;
  return false;
}

// ---- pass 1: CALIBRATION SANITY — bots never stand in reefs; obstacle-overlap must be low ----
let posTot = 0, posInObs = 0, files = [];
walkJson('match-history', files);
const reps = [];
for (const f of files) {
  let d; try { d = JSON.parse(fs.readFileSync(f)); } catch { continue; }
  if (!d.frames || !d.bots || d.mapId !== 'sunken_reef') continue;
  const m = parseReplay(d); if (!m || m.won == null) continue;
  reps.push(m);
  for (const fr of m.frames) for (const b of fr.bots) {
    if (!b.us || !b.alive) continue;
    posTot++; const [r, c] = cellOf(b.x, b.y); if (isObs(r, c)) posInObs++;
  }
}
const overlapPct = posTot ? 100 * posInObs / posTot : 0;
console.log(`CALIBRATION: ${reps.length} sunken_reef replays; bot-positions-in-obstacle-cell = ${overlapPct.toFixed(1)}% (should be LOW if grid aligns; high ⇒ miscalibrated)`);

// ---- pass 2: entrapment-death detection ----
// A death is "terrain-entrapment" if, in the ~40 ticks before death, the bot was moving
// (path length large) but going nowhere (net displacement small) = oscillating against a
// wall, AND an obstacle cell sits within ~2 cells (~80u), AND it wasn't simply in melee
// combat (no enemy within 256u most of the window).
function analyzeDeaths(m) {
  const F = m.frames;
  const series = {}; // botId -> [{tick,x,y,alive, enemies:[...]}]
  for (const fr of F) for (const b of fr.bots) {
    if (!b.us) continue;
    (series[b.id] ||= []).push({ tick: fr.tick, x: b.x, y: b.y, alive: b.alive,
      nearestEnemy: Math.min(...fr.bots.filter(e => !e.us && e.alive).map(e => Math.hypot(e.x - b.x, e.y - b.y)), Infinity),
      zoneOut: Math.hypot(b.x - fr.zone.cx, b.y - fr.zone.cy) > fr.zone.r });
  }
  const out = [];
  for (const id in series) {
    const s = series[id];
    let di = -1; for (let i = 1; i < s.length; i++) if (s[i - 1].alive && !s[i].alive) { di = i; break; }
    if (di < 0) continue; // survived
    const w = s.slice(Math.max(0, di - 40), di).filter(p => p.alive);
    if (w.length < 15) continue;
    let pathLen = 0; for (let i = 1; i < w.length; i++) pathLen += Math.hypot(w[i].x - w[i - 1].x, w[i].y - w[i - 1].y);
    const netDisp = Math.hypot(w[w.length - 1].x - w[0].x, w[w.length - 1].y - w[0].y);
    const oscillating = netDisp < 150 && pathLen > 250;            // moved a lot, went nowhere
    const obsAdj = w.filter(p => obstacleNear(p.x, p.y, 2)).length / w.length > 0.5;
    const notMelee = w.filter(p => p.nearestEnemy > 256).length / w.length > 0.6; // not just orbiting an enemy
    const zoneDeath = s[di].zoneOut || s[Math.max(0, di - 1)].zoneOut;
    const isLast = di === s.length - 1 ? false : false; // refined below at match level
    if (oscillating && obsAdj && notMelee) out.push({ id, tick: s[di].tick, netDisp: Math.round(netDisp), pathLen: Math.round(pathLen), zoneDeath });
  }
  return out;
}

let totDeaths = 0, entrapDeaths = 0, lossesWithEntrap = 0, lossCount = 0, entrapZone = 0;
const examples = [];
for (const m of reps) {
  if (m.won !== false) continue; lossCount++;
  // count our deaths
  const F = m.frames; const ids = [...m.ourIds];
  const diedTicks = {};
  let prev = null;
  for (const fr of F) { const by = {}; for (const b of fr.bots) by[b.id] = b;
    if (prev) for (const id of ids) { if (prev[id] && by[id] && prev[id].alive && !by[id].alive) diedTicks[id] = fr.tick; }
    prev = by; }
  totDeaths += Object.keys(diedTicks).length;
  const ent = analyzeDeaths(m);
  if (ent.length) { lossesWithEntrap++; entrapDeaths += ent.length; entrapZone += ent.filter(e => e.zoneDeath).length;
    if (examples.length < 6) examples.push({ match: m.matchId, opp: m.opponentName, ent }); }
}
console.log(`\nLOSS REPLAYS (sunken_reef): ${lossCount}`);
console.log(`our deaths total: ${totDeaths}`);
console.log(`TERRAIN-ENTRAPMENT deaths (oscillating + obstacle-adjacent + not-melee): ${entrapDeaths} (${(100*entrapDeaths/(totDeaths||1)).toFixed(0)}% of our deaths)`);
console.log(`  ...of which died to ZONE while stuck: ${entrapZone}`);
console.log(`losses with >=1 entrapment death: ${lossesWithEntrap}/${lossCount} (${(100*lossesWithEntrap/(lossCount||1)).toFixed(0)}% of losses)`);
console.log('\nexamples:'); for (const e of examples) console.log(`  ${e.opp} ${e.match?.slice(0,8)}: ${e.ent.map(x=>`t${x.tick} net${x.netDisp}/path${x.pathLen}${x.zoneDeath?' ZONE':''}`).join('; ')}`);
