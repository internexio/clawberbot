// validate_v61_mirror.mjs — final critic gate for the gated CC-mirror.
// SAFETY-CRITICAL: vs NON-CC, v61 must be BYTE-IDENTICAL to v60 (the entire gate-safety claim).
// vs CC, v61 should DIVERGE (mirror active) and never throw. Also confirms the VS_CC branch fires.
import fs from 'fs';
import path from 'path';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC = 'ef7e1954-e275-4882-933b-a423946442f5';
const CCPFX = 'edae262d-b7e4-4dd0-a8d0-3f34cb7c0a90';
const load = f => new Function(fs.readFileSync(f, 'utf8') + '\n; return update;')();
function walk(d){const o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())o.push(...walk(p));else if(e.name.endsWith('.json'))o.push(p);}return o;}

const seen = new Set();
let ccM = 0, ncM = 0;
let ncTicks = 0, ncDiv = 0, ncThrow = 0;          // non-CC: div MUST be 0
let ccTicks = 0, ccDiv = 0, ccThrow = 0, ccMoveDiv = 0;  // CC: mirror active
const ncDivSamples = [];

for (const fp of walk('match-history')) {
  if (ccM >= 80 && ncM >= 150) break;
  let m; try { m = JSON.parse(fs.readFileSync(fp)); } catch { continue; }
  if (!m.frames || !m.bots) continue;
  const ag = {}; for (const b of m.bots) ag[b.id] = b.agentId;
  const ours = m.bots.filter(b => b.agentId === OUR).map(b => b.id);
  if (!ours.length) continue;
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  // is this a CC match? (CC bot-id prefix appears among enemies in any frame)
  const isCC = m.bots.some(b => typeof b.id === 'string' && b.id.indexOf(CCPFX) === 0);
  if (isCC && ccM >= 80) continue;
  if (!isCC && ncM >= 150) continue;
  if (isCC) ccM++; else ncM++;

  const u60 = load('bots/v60-last-ammo.js'), u61 = load('bots/v61-cc-mirror.js');
  for (const fr of m.frames) for (const id of ours) {
    const self = fr.bots.find(b => b.id === id); if (!self || !self.alive) continue;
    const input = { selfId: id, teamBotIds: ours, botNumber: +(String(id).split(':')[1] || 0), tick: fr.tick, bots: fr.bots, zone: fr.zone, powerups: fr.powerups || [] };
    let a, b, threw = false;
    try { a = u60(input); } catch { threw = true; }
    try { b = u61(input); } catch { threw = true; if (isCC) ccThrow++; else ncThrow++; }
    if (threw) continue;
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (isCC) { ccTicks++; if (!same) { ccDiv++; if (b && b.type === 'move') ccMoveDiv++; } }
    else { ncTicks++; if (!same) { ncDiv++; if (ncDivSamples.length < 5) ncDivSamples.push(`${fr.tick} ${a&&a.type}->${b&&b.type}`); } }
  }
}

console.log(`\n=== v61-mirror final validation ===`);
console.log(`scanned: ${ccM} CC matches, ${ncM} non-CC matches\n`);
console.log(`NON-CC (safety-critical — MUST be 0 divergence):`);
console.log(`  decisions ${ncTicks}, throws ${ncThrow}, DIVERGENT ${ncDiv}  ${ncDiv===0&&ncThrow===0?'✅ BYTE-IDENTICAL — gate safe':'❌ GATE LEAK'}`);
if (ncDivSamples.length) console.log('  leak samples:', ncDivSamples.join(' | '));
console.log(`\nCC (mirror should be active):`);
console.log(`  decisions ${ccTicks}, throws ${ccThrow}, divergent ${ccDiv} (${(100*ccDiv/ccTicks).toFixed(1)}%), of which moves ${ccMoveDiv}`);
console.log(`  ${ccThrow===0?'✅ no throws':'❌ THROWS'}  ${ccDiv>0?'✅ mirror engages':'❌ mirror inert'}`);
