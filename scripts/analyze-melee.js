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

// === MELEE BREAKDOWN ===
const meleeByAttacker = {};
for (const f of data.frames) {
  for (const e of f.events) {
    if (e.type === 'damage' && e.damage === 10) {
      const key = e.attackerId;
      if (!meleeByAttacker[key]) meleeByAttacker[key] = {};
      const t = e.targetId;
      if (!meleeByAttacker[key][t]) meleeByAttacker[key][t] = [];
      meleeByAttacker[key][t].push(e.tick);
    }
  }
}

console.log('=== MELEE ATTACK BREAKDOWN ===\n');
console.log('HBFREED melee attacks:');
for (const id of hbBots) {
  const targets = meleeByAttacker[id] || {};
  const entries = Object.entries(targets);
  if (entries.length === 0) { console.log('  ' + sL(id) + ': no melee attacks'); continue; }
  for (const [tid, ticks] of entries) {
    console.log('  ' + sL(id) + ' -> ' + sL(tid) + ': ' + ticks.length + ' hits at ticks [' + ticks.join(',') + ']');
  }
}

console.log('\nSEMalytics melee attacks:');
for (const id of ourBots) {
  const targets = meleeByAttacker[id] || {};
  const entries = Object.entries(targets);
  if (entries.length === 0) { console.log('  ' + sL(id) + ': no melee attacks'); continue; }
  for (const [tid, ticks] of entries) {
    console.log('  ' + sL(id) + ' -> ' + sL(tid) + ': ' + ticks.length + ' hits at ticks [' + ticks.join(',') + ']');
  }
}

// === FOCUS FIRE PER TICK ===
console.log('\n=== HBFREED FOCUS FIRE PER TICK ===\n');
const hbMeleeByTick = {};
for (const f of data.frames) {
  for (const e of f.events) {
    if (e.type === 'damage' && e.damage === 10 && hbSet.has(e.attackerId)) {
      if (!hbMeleeByTick[e.tick]) hbMeleeByTick[e.tick] = [];
      hbMeleeByTick[e.tick].push({ attacker: e.attackerId, target: e.targetId });
    }
  }
}

let focusTicks = 0, multiTicks = 0;
for (const [tick, attacks] of Object.entries(hbMeleeByTick).sort((a,b) => a[0]-b[0])) {
  if (attacks.length >= 2) {
    multiTicks++;
    const targets = new Set(attacks.map(a => a.target));
    if (targets.size === 1) focusTicks++;
    console.log('Tick ' + tick + ': ' + attacks.map(a => sL(a.attacker) + '->' + sL(a.target)).join(', ') + (targets.size === 1 ? ' [FOCUSED]' : ''));
  }
}
console.log('\nFocus rate: ' + focusTicks + '/' + multiTicks + ' ticks (' + (multiTicks ? (focusTicks/multiTicks*100).toFixed(0) : 0) + '%)');

// === COMPLETE DAMAGE TIMELINE ===
console.log('\n=== COMPLETE DAMAGE TIMELINE ===\n');
for (const f of data.frames) {
  const dmgEvents = f.events.filter(e => e.type === 'damage');
  const abilityEvents = f.events.filter(e => e.type === 'ability');
  const killEvts = f.events.filter(e => e.type === 'kill');

  if (dmgEvents.length === 0 && abilityEvents.length === 0 && killEvts.length === 0) continue;

  let line = 'Tick ' + String(f.tick).padStart(4) + ': ';
  const parts = [];

  for (const ab of abilityEvents) {
    parts.push(sL(ab.botId) + ' ABILITY(' + ab.targetPosition.x.toFixed(0) + ',' + ab.targetPosition.y.toFixed(0) + ')');
  }
  for (const d of dmgEvents) {
    const type = d.damage === 15 ? 'AoE' : 'melee';
    parts.push(sL(d.attackerId) + '->' + sL(d.targetId) + ' ' + d.damage + 'dmg(' + type + ')');
  }
  for (const k of killEvts) {
    parts.push('*** ' + sL(k.killerId) + ' KILLS ' + sL(k.victimId) + ' ***');
  }

  console.log(line + parts.join(' | '));
}

// === HB ABILITY vs MELEE TARGET COMPARISON ===
console.log('\n=== ABILITY vs MELEE SAME-TARGET CHECK ===\n');
console.log('For each HB ability, what was that bot meleeing before/after?\n');

// Build per-bot melee timeline
const botMeleeTimeline = {};
for (const f of data.frames) {
  for (const e of f.events) {
    if (e.type === 'damage' && e.damage === 10 && hbSet.has(e.attackerId)) {
      if (!botMeleeTimeline[e.attackerId]) botMeleeTimeline[e.attackerId] = [];
      botMeleeTimeline[e.attackerId].push({ tick: e.tick, target: e.targetId });
    }
  }
}

// For each ability, find nearest melee
const abilityEvts = [];
for (const f of data.frames) {
  for (const e of f.events) {
    if (e.type === 'ability' && hbSet.has(e.botId)) {
      abilityEvts.push(e);
    }
  }
}

for (const ab of abilityEvts) {
  const melees = botMeleeTimeline[ab.botId] || [];
  const before = melees.filter(m => m.tick <= ab.tick).sort((a, b) => b.tick - a.tick)[0];
  const after = melees.filter(m => m.tick > ab.tick).sort((a, b) => a.tick - b.tick)[0];

  // Find ability target (nearest enemy)
  const frame = data.frames.find(f => f.tick === ab.tick);
  let nearestEnemy = null;
  let nearestDist = Infinity;
  if (frame) {
    for (const bot of frame.bots) {
      if (ourSet.has(bot.id) && bot.alive) {
        const dx = bot.position.x - ab.targetPosition.x;
        const dy = bot.position.y - ab.targetPosition.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) {
          nearestDist = d;
          nearestEnemy = bot.id;
        }
      }
    }
  }

  const abilityTarget = nearestEnemy ? sL(nearestEnemy) : '?';
  const meleeTargetBefore = before ? sL(before.target) + '@t' + before.tick : 'none';
  const meleeTargetAfter = after ? sL(after.target) + '@t' + after.tick : 'none';

  console.log('Tick ' + ab.tick + ': ' + sL(ab.botId) + ' ability aimed at ' + abilityTarget);
  console.log('  Melee before: ' + meleeTargetBefore + ' | Melee after: ' + meleeTargetAfter);

  const sameTarget = (before && sL(before.target) === abilityTarget) || (after && sL(after.target) === abilityTarget);
  console.log('  Same target as melee? ' + (sameTarget ? 'YES' : 'DIFFERENT'));
}

// === KILL DETAILS ===
console.log('\n=== KILL TIMELINE WITH CONTEXT ===\n');
for (const f of data.frames) {
  for (const e of f.events) {
    if (e.type === 'kill') {
      // Find victim health in previous frame
      const prevFrame = data.frames.find(pf => pf.tick === f.tick - 1);
      let prevHealth = '?';
      if (prevFrame) {
        const bot = prevFrame.bots.find(b => b.id === e.victimId);
        if (bot) prevHealth = bot.health;
      }

      // Find what killed them (damage event same tick)
      const dmg = f.events.filter(d => d.type === 'damage' && d.targetId === e.victimId);
      const killMethod = dmg.map(d => d.damage === 15 ? 'ability' : 'melee').join('+') || 'zone?';

      console.log('Tick ' + e.tick + ': ' + sL(e.killerId) + ' KILLS ' + sL(e.victimId) + ' (was at ' + prevHealth + ' HP, killed by ' + killMethod + ')');
    }
  }
}
