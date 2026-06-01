// build_terrain_tiers.mjs (B2) — recover terrain SPEED tiers from kinematics.
// Occupancy mapping sees only obstacle-vs-passable (bots traverse slow tiles, so they look like
// ground). But speed is capped at SPEED/movementCost, so the MAX observed single-tick step a bot
// takes while standing in a cell inverts to that cell's cost:  cost ~= SPEED / maxStep.
//   ground 12 (cost 1.0) | slow ~8 (1.5x) | very_slow ~6 (2.0x).
// Bin every consecutive-tick displacement into the START cell; max over the full corpus ~= the cap.
// Cross-reference occupancy for obstacles. Writes scouting/sunken_reef-terrain-tiers.json.
import fs from 'fs';
import path from 'path';

const GRID = 64, CW = 32, SPEED = 12;
const DIR = path.resolve('match-history');
const OCC = JSON.parse(fs.readFileSync(path.resolve('scouting/sunken_reef-occupancy.json')));

const maxStep = Array.from({ length: GRID }, () => new Float64Array(GRID));   // per cell
const samples = Array.from({ length: GRID }, () => new Int32Array(GRID));     // full-move samples (step>=10)
const allSamples = Array.from({ length: GRID }, () => new Int32Array(GRID));

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
let matches = 0, steps = 0;
for (const f of files) {
  let m; try { m = JSON.parse(fs.readFileSync(path.join(DIR, f))); } catch { continue; }
  if (!m.frames) continue;
  matches++;
  const fr = m.frames;
  for (let i = 1; i < fr.length; i++) {
    if (fr[i].tick !== fr[i - 1].tick + 1) continue;              // consecutive ticks only
    const prev = {}; for (const b of fr[i - 1].bots) prev[b.id] = b;
    for (const b of fr[i].bots) {
      if (!b.alive) continue;
      const p = prev[b.id]; if (!p || !p.alive) continue;
      const dx = b.position.x - p.position.x, dy = b.position.y - p.position.y;
      const d = Math.hypot(dx, dy);
      if (d > 12.6 || d <= 0) continue;                            // >cap = tick gap/noise; 0 = stationary (no speed info)
      // attribute to the START cell (terrain the bot was standing on)
      const c = Math.floor(p.position.x / CW), r = Math.floor(p.position.y / CW);
      if (r < 0 || r >= GRID || c < 0 || c >= GRID) continue;
      steps++;
      allSamples[r][c]++;
      if (d > maxStep[r][c]) maxStep[r][c] = d;
      if (d >= 10) samples[r][c]++;                                // a near-full-speed move = informative for the cap
    }
  }
}

// classify
const tier = Array.from({ length: GRID }, () => new Int8Array(GRID));         // -1 unknown, 0 ground,1 slow,2 very_slow,3 obstacle
const cost = Array.from({ length: GRID }, () => new Float64Array(GRID));
let counts = { obstacle: 0, ground: 0, slow: 0, very_slow: 0, unknown: 0 };
const MIN_SAMPLES = 20;
for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
  if (OCC.obstacle[r][c]) { tier[r][c] = 3; cost[r][c] = Infinity; counts.obstacle++; continue; }
  if (allSamples[r][c] < MIN_SAMPLES) { tier[r][c] = -1; cost[r][c] = 1.0; counts.unknown++; continue; }
  const ms = maxStep[r][c];
  const k = ms > 0 ? SPEED / ms : 99;     // cost estimate
  cost[r][c] = +k.toFixed(2);
  if (k <= 1.15) { tier[r][c] = 0; counts.ground++; }
  else if (k <= 1.7) { tier[r][c] = 1; counts.slow++; }
  else { tier[r][c] = 2; counts.very_slow++; }
}

const out = {
  map: 'sunken_reef', grid: GRID, cellWorld: CW, speed: SPEED, minSamples: MIN_SAMPLES,
  note: 'tier: 0 ground(cost<=1.15) 1 slow(<=1.7) 2 very_slow(>1.7) 3 obstacle -1 unknown(<minSamples, treat as ground). cost = SPEED/maxStep.',
  matches, steps, counts,
  tier: tier.map(row => Array.from(row)),
  cost: cost.map(row => Array.from(row).map(x => x === Infinity ? null : x)),
};
fs.writeFileSync(path.resolve('scouting/sunken_reef-terrain-tiers.json'), JSON.stringify(out));
console.log(`corpus: ${matches} matches, ${steps} consecutive-tick steps binned`);
console.log('cell tiers:', JSON.stringify(counts));
const passable = counts.ground + counts.slow + counts.very_slow;
console.log(`of ${passable} well-sampled passable cells: ground ${counts.ground} (${(100*counts.ground/passable).toFixed(0)}%) | slow ${counts.slow} (${(100*counts.slow/passable).toFixed(0)}%) | very_slow ${counts.very_slow} (${(100*counts.very_slow/passable).toFixed(0)}%)`);
// where are the slow tiers? show their adjacency to obstacles (reef fringes vs open water)
let slowNearReef = 0, slowOpen = 0;
for (let r = 1; r < GRID - 1; r++) for (let c = 1; c < GRID - 1; c++) {
  if (tier[r][c] !== 1 && tier[r][c] !== 2) continue;
  let adjObs = false;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (OCC.obstacle[r + dr][c + dc]) adjObs = true;
  if (adjObs) slowNearReef++; else slowOpen++;
}
console.log(`slow/very_slow cells adjacent to a reef: ${slowNearReef}  | in open water: ${slowOpen}  (reef-fringe shoals => kinematics found real terrain, not noise)`);
console.log('-> scouting/sunken_reef-terrain-tiers.json');
