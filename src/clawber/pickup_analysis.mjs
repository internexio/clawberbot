// pickup_analysis.mjs — quantify "walked right past a pickup" misses.
// For each powerup, find the closest any of our ALIVE bots got during its lifetime, and its
// fate (we collected / enemy collected / expired). A pickup we got within a small detour of
// but didn't collect = a missed free grab. Run: node src/clawber/pickup_analysis.mjs
import fs from 'fs';
import { parseReplay, walkJson, dist } from './parse.mjs';

const COLLECT = 48;      // collection radius (game)
const NEAR = 130;        // "a slight detour" — bot speed 12/tick, ~7 extra ticks
const SINCE = process.env.SINCE || null;

let files = []; walkJson('match-history', files);
let matches = 0, puTotal = 0, gotUs = 0, gotEnemy = 0, expired = 0;
let missedNear = 0, missedNearAmmo = 0, missedNearHealth = 0;
let nearDistSum = 0;
const exMatches = [];
for (const f of files) {
  let d; try { d = JSON.parse(fs.readFileSync(f)); } catch { continue; }
  if (!d.frames || !d.bots || d.mapId !== 'sunken_reef') continue;
  const m = parseReplay(d); if (!m) continue;
  if (SINCE && (!m.startedAt || String(m.startedAt) <= SINCE)) continue;
  matches++;
  // track each powerup across frames
  const seen = {}; // id -> {type, minUs, minUsHealthy, lastNearUs, vanishedNearUs, vanishedNearEnemy, present}
  let prevPU = new Map(), prevBots = null;
  let matchMissed = 0;
  for (const fr of m.frames) {
    const ours = fr.bots.filter(b => b.us && b.alive);
    const ens = fr.bots.filter(b => !b.us && b.alive);
    const cur = new Map();
    for (const p of fr.powerups) {
      cur.set(p.id, p);
      const s = seen[p.id] || (seen[p.id] = { type: p.type, minUs: Infinity });
      // closest our-bot while that bot isn't in obvious danger (no enemy within 250u of the bot)
      for (const b of ours) {
        const dd = dist(b, p);
        if (dd < s.minUs) s.minUs = dd;
      }
    }
    // detect vanished pickups (collected or expired) -> attribute
    if (prevBots) for (const [id, p] of prevPU) if (!cur.has(id)) {
      const s = seen[id]; if (!s) continue;
      const ourNear = prevBots.some(b => b.us && b.alive && dist(b, p) <= COLLECT + 12);
      const enNear = prevBots.some(b => !b.us && b.alive && dist(b, p) <= COLLECT + 12);
      s.fate = ourNear ? 'us' : enNear ? 'enemy' : 'expired';
    }
    prevPU = cur; prevBots = fr.bots;
  }
  // any still-present at end = treat as expired/uncollected
  for (const id in seen) {
    const s = seen[id]; puTotal++;
    const fate = s.fate || 'expired';
    if (fate === 'us') gotUs++;
    else { if (fate === 'enemy') gotEnemy++; else expired++;
      // we did NOT collect it — did we walk right past it?
      if (s.minUs <= NEAR && s.minUs > COLLECT) {
        missedNear++; nearDistSum += s.minUs; matchMissed++;
        if (s.type === 'ammo') missedNearAmmo++; else missedNearHealth++;
      }
    }
  }
  if (matchMissed >= 2 && exMatches.length < 8) exMatches.push(`${m.opponentName} ${String(m.matchId).slice(0,8)}: ${matchMissed} walked-past`);
}
console.log(`sunken_reef matches: ${matches}${SINCE?` (SINCE ${SINCE})`:''}`);
console.log(`powerups seen: ${puTotal} | collected by us: ${gotUs} (${(100*gotUs/puTotal).toFixed(0)}%) | by enemy: ${gotEnemy} | expired: ${expired}`);
console.log(`WALKED PAST (came within ${COLLECT}-${NEAR}u, didn't collect): ${missedNear}  (ammo ${missedNearAmmo}, health ${missedNearHealth})  avg closest ${missedNear?Math.round(nearDistSum/missedNear):0}u`);
console.log(`  → ~${missedNear} free grabs left on the table across ${matches} matches (${(missedNear/matches).toFixed(2)}/match)`);
console.log('examples (>=2 walked-past in a match):'); exMatches.forEach(e => console.log('  ' + e));
