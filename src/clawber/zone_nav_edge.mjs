// zone_nav_edge.mjs — Do we now SURVIVE THE ZONE better than CC? (the user's mirror thesis:
// mirror neutralizes CC's AoE edge -> ~50%, then our nav/zone advantage tips it >50%.)
// Measures, per agent, intrinsic zone-handling (independent of AoE exchange):
//   - ticks-outside-zone rate (zone-damage exposure)
//   - mean over-edge distance when outside (how badly they overstay the shrink)
//   - zone deaths (died while outside zone, no combat killer) as a share of deaths
// Recent era = post terrain-fix (v51+, our NAV_FLOW live). all = full history.
//   node src/clawber/zone_nav_edge.mjs   [ERA=recent]
import fs from 'fs';
import path from 'path';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC = 'ef7e1954-e275-4882-933b-a423946442f5';
const ERA = process.env.ERA || 'all';
const RECENT_SINCE = '2026-05-30T00:00:00Z';   // ~v51 terrain-fix era onward
const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function walk(d){const o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())o.push(...walk(p));else if(e.name.endsWith('.json'))o.push(p);}return o;}

const seen = new Set();
const S = { [OUR]: mk(), [CC]: mk() };
function mk(){ return { botTicks:0, outTicks:0, overSum:0, deaths:0, zoneDeaths:0 }; }
let matches = 0;

for (const fp of walk(path.resolve('match-history'))) {
  let m; try { m = JSON.parse(fs.readFileSync(fp)); } catch { continue; }
  if (!m.frames || !m.bots) continue;
  const ag = {}; for (const b of m.bots) ag[b.id] = b.agentId;
  const set = new Set(Object.values(ag));
  if (!set.has(OUR) || !set.has(CC) || set.size !== 2) continue;
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  if (ERA === 'recent' && (!m.startedAt || m.startedAt < RECENT_SINCE)) continue;
  matches++;

  // combat-killed victims (to separate zone deaths from combat deaths)
  const combatVictims = new Set();
  for (const fr of m.frames) for (const e of (fr.events || []))
    if (e.type === 'kill' && e.victimId && e.killerId && ag[e.killerId] !== ag[e.victimId]) combatVictims.add(e.victimId);

  // exposure: per alive bot per frame, is it outside the zone?
  const wasAlive = {}; const lastOutside = {};
  for (const fr of m.frames) {
    const z = fr.zone; if (!z) continue;
    const zc = { x: z.centerX, y: z.centerY };
    for (const b of fr.bots) {
      const a = ag[b.id]; if (a !== OUR && a !== CC) continue;
      if (b.alive) {
        S[a].botTicks++;
        const dd = D(b.position, zc);
        const over = dd - z.radius;
        if (over > 0) { S[a].outTicks++; S[a].overSum += over; lastOutside[b.id] = true; }
        else lastOutside[b.id] = false;
        wasAlive[b.id] = true;
      } else if (wasAlive[b.id]) {              // alive -> dead transition
        wasAlive[b.id] = false;
        S[a].deaths++;
        if (!combatVictims.has(b.id) && lastOutside[b.id]) S[a].zoneDeaths++;  // died outside zone, no combat killer
      }
    }
  }
}

function rep(label, s) {
  console.log(`${label}: bot-ticks ${s.botTicks}`);
  console.log(`   outside-zone rate: ${(100*s.outTicks/s.botTicks).toFixed(2)}%   mean over-edge dist when out: ${(s.outTicks?s.overSum/s.outTicks:0).toFixed(0)}u`);
  console.log(`   deaths ${s.deaths}, zone-deaths ${s.zoneDeaths} (${s.deaths?(100*s.zoneDeaths/s.deaths).toFixed(1):0}% of deaths)`);
}
console.log(`\n=== ERA=${ERA}  us-vs-CC matches=${matches} ===`);
console.log(`THESIS: if we navigate/survive the shrink better, OUR outside-zone rate & zone-death share < CC's.\n`);
rep('US ', S[OUR]);
console.log('');
rep('CC ', S[CC]);
const us = S[OUR], cc = S[CC];
console.log(`\nΔ outside-zone rate (CC - us): ${(100*cc.outTicks/cc.botTicks - 100*us.outTicks/us.botTicks).toFixed(2)} pp  (positive = CC overstays the zone more = our edge)`);
console.log(`Δ zone-death share (CC - us): ${((cc.deaths?100*cc.zoneDeaths/cc.deaths:0) - (us.deaths?100*us.zoneDeaths/us.deaths:0)).toFixed(1)} pp`);
