// build_nav_field.mjs — precompute a center-ward flow field for Sunken Reef from the
// occupancy grid. For each passable cell, store the first-step direction along the
// shortest 8-connected path to the central safe core (most-visited cell). Bots read this
// in O(1) to route AROUND reefs toward safety — fixing the oscillate-against-reef death.
// Emits an encoded string + drift hash to bake into the bot. Run: node src/clawber/build_nav_field.mjs
import fs from 'fs';
const O = JSON.parse(fs.readFileSync('scouting/sunken_reef-occupancy.json'));
const G = O.grid, CW = O.cellWorld, obstacle = O.obstacle, visit = O.visit;
const passable = (r, c) => r >= 0 && r < G && c >= 0 && c < G && obstacle[r][c] === 0;

// goal = most-visited cell (central, definitely safe — bots converge there late game)
let gr = G >> 1, gc = G >> 1, best = -1;
for (let r = 0; r < G; r++) for (let c = 0; c < G; c++) if (visit[r][c] > best) { best = visit[r][c]; gr = r; gc = c; }
console.log(`goal cell (most-visited) = (row ${gr}, col ${gc}) ≈ world (${Math.round((gc+0.5)*CW)}, ${Math.round((gr+0.5)*CW)}); visits=${best}`);

// 8-connected BFS (uniform step) from goal over passable cells → distance field
const DIRS = [[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1],[1,1]]; // [dx,dy] (y+ = south); index 0..7
const dist = Array.from({length:G}, () => new Array(G).fill(Infinity));
dist[gr][gc] = 0; const q = [[gr,gc]]; let qi = 0;
while (qi < q.length) {
  const [r,c] = q[qi++];
  for (const [dx,dy] of DIRS) { const nr=r+dy, nc=c+dx;
    if (passable(nr,nc) && dist[nr][nc] === Infinity) { dist[nr][nc] = dist[r][c]+1; q.push([nr,nc]); } }
}
// flow char per cell: 'X' obstacle/unreachable, 'C' goal, '0'-'7' = direction to lowest-dist neighbor
let chars=[], reachable=0;
for (let r=0;r<G;r++) for (let c=0;c<G;c++) {
  if (!passable(r,c) || dist[r][c]===Infinity) { chars.push('X'); continue; }
  if (r===gr && c===gc) { chars.push('C'); reachable++; continue; }
  let bi=-1, bd=dist[r][c];
  for (let i=0;i<8;i++){ const nr=r+DIRS[i][1], nc=c+DIRS[i][0];
    if (passable(nr,nc) && dist[nr][nc] < bd) { bd=dist[nr][nc]; bi=i; } }
  chars.push(bi<0 ? 'X' : String(bi)); reachable++;
}
const flow = chars.join('');
// drift hash: FNV-1a over the obstacle bitmap (passable interior structure)
let h = 0x811c9dc5; for (let r=0;r<G;r++) for (let c=0;c<G;c++){ h ^= obstacle[r][c]; h = Math.imul(h, 0x01000193) >>> 0; }
console.log(`reachable passable cells: ${reachable}; flow string length: ${flow.length}; drift hash: ${h}`);

// sanity: flow at the canonical entrapment spot world (870,318)
const tr = Math.floor(318/CW), tc = Math.floor(870/CW);
console.log(`flow at entrapment (870,318) → cell(${tr},${tc}) = '${flow[tr*G+tc]}' (should be a digit pointing toward center, not 'X')`);

fs.writeFileSync('scouting/sunken_reef-navfield.json', JSON.stringify({map:'sunken_reef',G,CW,goal:[gr,gc],hash:h,flow}));
console.log('saved scouting/sunken_reef-navfield.json');
