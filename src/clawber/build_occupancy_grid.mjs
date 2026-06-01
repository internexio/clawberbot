// build_occupancy_grid.mjs — derive the obstacle map from NEGATIVE SPACE of bot motion.
// Across all sunken_reef replays, accumulate every alive bot's position (BOTH teams) into
// a grid. A cell no bot ever occupies = obstacle (bots can't enter reefs). Fully
// deterministic (bot positions are exact world coords) — no vision, no calibration.
// Caveat: a passable-but-never-visited cell (arena corners/edges the zone keeps bots out
// of) is a false obstacle; flagged at the periphery. Run: node src/clawber/build_occupancy_grid.mjs
import fs from 'fs';
import { parseReplay, walkJson } from './parse.mjs';

const G = 64, WORLD = 2048, CW = WORLD / G;
const visit = Array.from({ length: G }, () => new Array(G).fill(0));
let files = [], samples = 0, matches = 0;
walkJson('match-history', files);
for (const f of files) {
  let d; try { d = JSON.parse(fs.readFileSync(f)); } catch { continue; }
  if (!d.frames || d.mapId !== 'sunken_reef') continue;
  const m = parseReplay(d); if (!m) continue; matches++;
  for (const fr of m.frames) for (const b of fr.bots) {
    if (!b.alive) continue;
    const c = Math.min(G - 1, Math.max(0, Math.floor(b.x / CW)));
    const r = Math.min(G - 1, Math.max(0, Math.floor(b.y / CW)));
    visit[r][c]++; samples++;
  }
}
// obstacle = never visited. (threshold 0; bump to <=N if you want to tolerate noise)
const obstacle = visit.map(row => row.map(v => v === 0 ? 1 : 0));
let ob = 0, periphery = 0;
for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) if (obstacle[r][c]) {
  ob++; if (r <= 1 || c <= 1 || r >= G - 2 || c >= G - 2) periphery++;
}
console.log(`occupancy grid ${G}x${G} from ${matches} sunken_reef matches, ${samples.toLocaleString()} position samples (~${Math.round(samples/(G*G))}/cell avg)`);
console.log(`obstacle (never-visited) cells: ${ob}/${G*G} (${(100*ob/(G*G)).toFixed(0)}%); of which at arena periphery (likely undersampled, not real reef): ${periphery}`);

// compare to the vision grid if present
try {
  const V = JSON.parse(fs.readFileSync('scouting/sunken_reef-grid.json'));
  if (V.grid === G) {
    let agree = 0, bothObs = 0, onlyVis = 0, onlyOcc = 0;
    for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) {
      const o = obstacle[r][c], v = V.obstacle[r][c];
      if (o === v) agree++; if (o && v) bothObs++; if (v && !o) onlyVis++; if (o && !v) onlyOcc++;
    }
    console.log(`vs VISION grid: agree ${(100*agree/(G*G)).toFixed(0)}%; both-obstacle ${bothObs}; vision-only ${onlyVis}; occupancy-only ${onlyOcc}`);
  }
} catch {}

console.log('\nASCII (# = obstacle / never-visited):');
for (const row of obstacle) console.log(row.map(c => c ? '#' : '.').join(''));
fs.writeFileSync('scouting/sunken_reef-occupancy.json', JSON.stringify({
  map: 'sunken_reef', grid: G, world: WORLD, cellWorld: CW, source: 'bot-occupancy negative-space',
  matches, samples, obstacle, visit,
}));
console.log('\nsaved scouting/sunken_reef-occupancy.json');
