import fs from 'fs';
const NF = JSON.parse(fs.readFileSync('scouting/sunken_reef-navfield.json'));
const M = {'0':'a','1':'b','2':'c','3':'d','4':'e','5':'f','6':'g','7':'h','X':'i','C':'j'};
let rle=''; { const f=NF.flow; let i=0; while(i<f.length){let j=i;while(j<f.length&&f[j]===f[i])j++; rle+=M[f[i]]+(j-i); i=j;} }
const v44 = fs.readFileSync('bots/v44-safe-pickup-v41base.js','utf8');
const base = v44.split('\n').filter(l=>{const t=l.trim();
  return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('*/');}).join('\n');

const navBlock = `
const NAV_G=${NF.G}, NAV_CW=${NF.CW}, NAV_HASH=${NF.hash};
const NAV_FLOW=(()=>{const e=${JSON.stringify(rle)};const I={a:'0',b:'1',c:'2',d:'3',e:'4',f:'5',g:'6',h:'7',i:'X',j:'C'};let s='',k=0;while(k<e.length){const c=I[e[k++]];let n='';while(k<e.length&&e[k]>='0'&&e[k]<='9')n+=e[k++];s+=c.repeat(+n);}return s;})();
const _NAV_DIRS=[[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1],[1,1]];
function flowDirAt(x,y){const c=Math.floor(x/NAV_CW),r=Math.floor(y/NAV_CW);if(r<0||r>=NAV_G||c<0||c>=NAV_G)return null;const ch=NAV_FLOW.charCodeAt(r*NAV_G+c)-48;if(ch<0||ch>7)return null;const d=_NAV_DIRS[ch];return{x:d[0],y:d[1]};}
function update(input) {`;
let out = base.replace('function update(input) {', navBlock);

// drift check
const driftAnchor = `  if (enemies.length === 0) return { type: 'idle' };`;
out = out.replace(driftAnchor, driftAnchor + `
  if (input.tick === 0 && _s.navDrift === undefined) {
    _s.navDrift = false; const _t = input.tiles;
    if (_t && _t.passable && _t.width) { let mis=0,nn=0;
      for (let r=8;r<NAV_G-8;r++) for (let c=8;c<NAV_G-8;c++){
        const baked = NAV_FLOW.charCodeAt(r*NAV_G+c)===88;
        const tx=Math.floor((c+0.5)*NAV_CW/_t.tileSize), ty=Math.floor((r+0.5)*NAV_CW/_t.tileSize);
        const live=(tx>=0&&tx<_t.width&&ty>=0&&ty<_t.height)? !_t.passable[ty*_t.width+tx] : true;
        nn++; if(baked!==live) mis++; }
      if (nn && mis/nn > 0.20) _s.navDrift = true; } }`);

// navCenter() helper — flow-routed center-ward direction (defined after distToCenter)
const dcAnchor = `  const distToCenter = Math.hypot(self.position.x - zx, self.position.y - zy);`;
out = out.replace(dcAnchor, dcAnchor + `
  const navCenter = () => { const st = { x: zx - self.position.x, y: zy - self.position.y }; if (_s.navDrift) return st; const fd = flowDirAt(self.position.x, self.position.y); if (!fd) return st; const sm = Math.hypot(st.x, st.y) || 1, fm = Math.hypot(fd.x, fd.y) || 1; return ((fd.x * st.x + fd.y * st.y) / (sm * fm)) < 0.7 ? fd : st; };`);

// route ALL pure center-ward retreats through the flow field
out = out.split('safeMove({ x: zx - self.position.x, y: zy - self.position.y })').join('safeMove(navCenter())');

// terrain-trapped backstop: flow escape before the local scan
const lockAnchor = `    const lock = _s.escLock[input.selfId];`;
out = out.replace(lockAnchor, `    if (!_s.navDrift) { const fd = flowDirAt(self.position.x, self.position.y); if (fd) return safeMove(fd); }
` + lockAnchor);

out = `/**
 * v51 Baked-Nav — v44 base (comments stripped to fit 50KB) + precomputed sunken_reef
 * center-ward flow field. ALL center-ward retreats (out-of-zone, zone-ceiling, hard-zone)
 * and the terrain-trapped escape route via the flow field, so bots path AROUND reefs to
 * the safe core instead of walking straight into them and oscillating to a zone death
 * (~36% of losses, opponent-independent). Field from occupancy map (build_nav_field.mjs);
 * all 2855 cells verified to reach the core. Tick-0 drift check falls back to v44 on a
 * changed/different map. Readable logic = v44. Spec: strategies/baked-nav-field-spec.md
 */
` + out;
fs.writeFileSync('bots/v51-baked-nav.js', out);
console.log('wrote v51', (out.length/1024).toFixed(1),'KB; navCenter replacements:', (v44.match(/safeMove\(\{ x: zx - self\.position\.x/g)||[]).length);
