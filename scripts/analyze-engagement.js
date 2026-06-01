const data = JSON.parse(require('fs').readFileSync('match-history/v11-loss-hbfreed.json'));

const hbBots = ['66af2b8d-610e-4b23-94a7-42b527f2cf89:0','66af2b8d-610e-4b23-94a7-42b527f2cf89:1','66af2b8d-610e-4b23-94a7-42b527f2cf89:2','66af2b8d-610e-4b23-94a7-42b527f2cf89:3','66af2b8d-610e-4b23-94a7-42b527f2cf89:4'];
const ourBots = ['9442f543-ddf7-4de2-b5aa-f80d29a974d5:0','9442f543-ddf7-4de2-b5aa-f80d29a974d5:1','9442f543-ddf7-4de2-b5aa-f80d29a974d5:2','9442f543-ddf7-4de2-b5aa-f80d29a974d5:3','9442f543-ddf7-4de2-b5aa-f80d29a974d5:4'];
const hbSet = new Set(hbBots);
const ourSet = new Set(ourBots);

function sL(id) {
  if (hbSet.has(id)) return 'HB#' + (hbBots.indexOf(id) + 1);
  if (ourSet.has(id)) return 'US#' + (ourBots.indexOf(id) + 1);
  return id;
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// === ENGAGEMENT PAIRING: Who fought whom? ===
console.log('=== ENGAGEMENT PAIRING ANALYSIS ===\n');
console.log('Which HB bot engaged which of our bots, and the outcome:\n');

// Track 1v1 engagements based on proximity
// For each frame, find closest enemy for each bot
const engagements = {};  // hbBot -> { ourBot -> ticks_engaged }

for (const frame of data.frames) {
  if (frame.tick % 5 !== 0) continue; // sample every 5 ticks

  for (const hbBot of frame.bots.filter(b => hbSet.has(b.id) && b.alive)) {
    const closest = frame.bots
      .filter(b => ourSet.has(b.id) && b.alive)
      .map(b => ({ id: b.id, dist: dist(b.position, hbBot.position) }))
      .sort((a, b) => a.dist - b.dist)[0];

    if (closest && closest.dist < 250) {
      if (!engagements[hbBot.id]) engagements[hbBot.id] = {};
      if (!engagements[hbBot.id][closest.id]) engagements[hbBot.id][closest.id] = 0;
      engagements[hbBot.id][closest.id]++;
    }
  }
}

for (const [hb, targets] of Object.entries(engagements)) {
  const sorted = Object.entries(targets).sort((a, b) => b[1] - a[1]);
  console.log(sL(hb) + ': ' + sorted.map(([t, c]) => sL(t) + '(' + (c * 5) + ' ticks)').join(', '));
}

// === INITIAL ENGAGEMENTS (first 10 ticks) ===
console.log('\n=== INITIAL POSITIONS & ENGAGEMENTS ===\n');

const tick0 = data.frames[0];
console.log('Starting positions:');
for (const bot of tick0.bots) {
  console.log('  ' + sL(bot.id) + ': (' + bot.position.x.toFixed(0) + ', ' + bot.position.y.toFixed(0) + ')');
}

// Find initial pairings (closest enemy at tick 0)
console.log('\nClosest enemy at tick 0:');
for (const bot of tick0.bots.filter(b => hbSet.has(b.id))) {
  const closest = tick0.bots
    .filter(b => ourSet.has(b.id))
    .map(b => ({ id: b.id, dist: dist(b.position, bot.position) }))
    .sort((a, b) => a.dist - b.dist)[0];
  console.log('  ' + sL(bot.id) + ' -> ' + sL(closest.id) + ' (' + closest.dist.toFixed(0) + 'u)');
}

// === HB OPENING STRATEGY ===
console.log('\n=== HB OPENING STRATEGY (first 10 ticks) ===\n');
console.log('How quickly does HB engage? Do they rush or wait?\n');

for (const hb of hbBots) {
  let firstDmgTick = null;
  let firstTarget = null;
  for (const f of data.frames) {
    for (const e of f.events) {
      if (e.type === 'damage' && e.attackerId === hb && firstDmgTick === null) {
        firstDmgTick = e.tick;
        firstTarget = e.targetId;
      }
    }
  }
  console.log(sL(hb) + ': First damage at tick ' + firstDmgTick + ' on ' + sL(firstTarget));
}

// === DISTANCE BETWEEN ABILITY TARGET AND ACTUAL POSITION ===
console.log('\n=== HB ABILITY LEAD ANALYSIS ===\n');
console.log('Do they fire at current position or lead the target?\n');

for (const f of data.frames) {
  for (const e of f.events) {
    if (e.type === 'ability' && hbSet.has(e.botId)) {
      // Find nearest enemy
      let nearest = null;
      let nearestDist = Infinity;
      for (const bot of f.bots) {
        if (ourSet.has(bot.id) && bot.alive) {
          const d = dist(bot.position, e.targetPosition);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = bot;
          }
        }
      }

      if (nearest) {
        // Check previous frame for velocity estimation
        const prevFrame = data.frames.find(pf => pf.tick === f.tick - 1);
        if (prevFrame) {
          const prevBot = prevFrame.bots.find(b => b.id === nearest.id);
          if (prevBot && prevBot.alive) {
            const vx = nearest.position.x - prevBot.position.x;
            const vy = nearest.position.y - prevBot.position.y;
            const speed = Math.sqrt(vx * vx + vy * vy);

            // Where did they aim vs where enemy is vs where enemy was going?
            const aimOffsetX = e.targetPosition.x - nearest.position.x;
            const aimOffsetY = e.targetPosition.y - nearest.position.y;
            const aimDist = Math.sqrt(aimOffsetX * aimOffsetX + aimOffsetY * aimOffsetY);

            // Dot product of aim offset and velocity (are they leading?)
            const dot = (speed > 0) ? (aimOffsetX * vx + aimOffsetY * vy) / (aimDist * speed + 0.001) : 0;

            console.log('Tick ' + f.tick + ': ' + sL(e.botId) + ' aimed at ' + sL(nearest.id));
            console.log('  Aim offset: ' + aimDist.toFixed(1) + 'u from target current pos');
            console.log('  Target speed: ' + speed.toFixed(1) + 'u/tick, Direction alignment: ' + dot.toFixed(2));
            if (aimDist > 5) {
              console.log('  LEADING: ' + (dot > 0.5 ? 'YES (aiming ahead)' : dot < -0.5 ? 'REVERSE (aiming behind)' : 'SIDEWAYS/MINOR'));
            } else {
              console.log('  PRECISE: Aimed directly at target position');
            }
          }
        }
      }
    }
  }
}

// === FRIENDLY FIRE SUMMARY ===
console.log('\n=== FRIENDLY FIRE DAMAGE ===\n');

let hbFriendlyDmg = 0;
let hbFriendlyEvents = [];
for (const f of data.frames) {
  for (const e of f.events) {
    if (e.type === 'damage' && hbSet.has(e.attackerId) && hbSet.has(e.targetId)) {
      hbFriendlyDmg += e.damage;
      hbFriendlyEvents.push({ tick: e.tick, attacker: sL(e.attackerId), target: sL(e.targetId), dmg: e.damage });
    }
  }
}

console.log('HB friendly fire total: ' + hbFriendlyDmg + ' damage in ' + hbFriendlyEvents.length + ' events');
for (const ev of hbFriendlyEvents) {
  console.log('  Tick ' + ev.tick + ': ' + ev.attacker + ' -> ' + ev.target + ' ' + ev.dmg + 'dmg');
}

// === OUR BOT #2 and #4 LATE ENGAGEMENT ===
console.log('\n=== LATE ENGAGERS: US#2 and US#4 ===\n');
console.log('These bots fired their first ability very late. Why?\n');

for (const botId of [ourBots[1], ourBots[3]]) {
  console.log(sL(botId) + ' position over time:');
  for (const f of data.frames) {
    if (f.tick % 10 !== 0 && f.tick !== 1 && f.tick !== 50 && f.tick !== 52 && f.tick !== 57) continue;
    const bot = f.bots.find(b => b.id === botId);
    if (!bot || !bot.alive) continue;

    // Find nearest enemy
    const nearest = f.bots
      .filter(b => hbSet.has(b.id) && b.alive)
      .map(b => ({ id: b.id, dist: dist(b.position, bot.position) }))
      .sort((a, b) => a.dist - b.dist)[0];

    console.log('  Tick ' + String(f.tick).padStart(3) + ': (' + bot.position.x.toFixed(0) + ', ' + bot.position.y.toFixed(0) + ') HP=' + bot.health + ' nearest=' + (nearest ? sL(nearest.id) + ' at ' + nearest.dist.toFixed(0) + 'u' : 'none'));
  }
}

// === SUMMARY STATS ===
console.log('\n=== MATCH SUMMARY ===\n');
console.log('Duration: ' + data.frames[data.frames.length - 1].tick + ' ticks (' + (data.frames[data.frames.length - 1].tick / 10).toFixed(1) + ' seconds)');
console.log('Score: HB kills 5, US kills 3');
console.log('HB remaining: 2 bots (HB#1 at 85HP, HB#3 at 20HP)');
console.log('');
console.log('ABILITY STATS:');
console.log('  HB fired 17 abilities, hit 20 times (some multi-hit), 300 total ability dmg');
console.log('  US fired 9 abilities, hit 11 times, 165 total ability dmg');
console.log('  HB ability advantage: +135 damage (+82%)');
console.log('');
console.log('MELEE STATS:');
console.log('  HB: 25 melee hits = 250 dmg');
console.log('  US: 21 melee hits = 210 dmg');
console.log('  HB melee advantage: +40 damage (+19%)');
console.log('');
console.log('TOTAL DAMAGE:');
console.log('  HB dealt: 550 total (but 60 was friendly fire = 490 effective)');
console.log('  US dealt: 375 total');
console.log('  Net advantage: +115 effective damage');
