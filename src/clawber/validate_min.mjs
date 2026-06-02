// validate_min.mjs — prove a minified bot is BEHAVIORALLY IDENTICAL to its readable source.
// Runs both over real frames (mixed CC + non-CC) and requires 0 divergence + 0 throws.
// Gate before ever submitting a .min.js.
//   node src/clawber/validate_min.mjs bots/v61-cc-mirror.js
import fs from 'fs';
import path from 'path';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const srcFile = process.argv[2];
const minFile = srcFile.replace(/\.js$/, '.min.js');
const load = f => new Function(fs.readFileSync(f, 'utf8') + '\n; return update;')();
function walk(d){const o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())o.push(...walk(p));else if(e.name.endsWith('.json'))o.push(p);}return o;}

const seen = new Set();
let scanned = 0, ticks = 0, div = 0, thrSrc = 0, thrMin = 0;
const samples = [];
for (const fp of walk('match-history')) {
  if (scanned >= 300) break;
  let m; try { m = JSON.parse(fs.readFileSync(fp)); } catch { continue; }
  if (!m.frames || !m.bots) continue;
  const ours = m.bots.filter(b => b.agentId === OUR).map(b => b.id);
  if (!ours.length) continue;
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  scanned++;
  const us = load(srcFile), um = load(minFile);
  for (const fr of m.frames) for (const id of ours) {
    const self = fr.bots.find(b => b.id === id); if (!self || !self.alive) continue;
    const input = { selfId: id, teamBotIds: ours, botNumber: +(String(id).split(':')[1] || 0), tick: fr.tick, bots: fr.bots, zone: fr.zone, powerups: fr.powerups || [] };
    let a, b; let t = false;
    try { a = us(input); } catch { thrSrc++; t = true; }
    try { b = um(input); } catch { thrMin++; t = true; }
    if (t) continue;
    ticks++;
    if (JSON.stringify(a) !== JSON.stringify(b)) { div++; if (samples.length < 5) samples.push(`${fr.tick}: ${JSON.stringify(a).slice(0,40)} vs ${JSON.stringify(b).slice(0,40)}`); }
  }
}
console.log(`\nminified-vs-source: ${scanned} matches, ${ticks} decisions`);
console.log(`  throws — source ${thrSrc}, min ${thrMin}`);
console.log(`  DIVERGENT ${div}  ${div === 0 && thrMin === 0 ? '✅ MINIFIED ≡ SOURCE — safe to submit' : '❌ MISMATCH — do NOT submit'}`);
if (samples.length) samples.forEach(s => console.log('   ' + s));
