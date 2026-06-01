#!/usr/bin/env node
// Deep analysis of ability usage in hbfreed-opus match replay

const fs = require('fs');
const data = JSON.parse(fs.readFileSync('/Users/davidpedersen/Mini/clawberbot/match-history/v11-loss-hbfreed.json', 'utf8'));

const OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const HBFREED_AGENT = 'dfe4a24a-3230-4142-b555-1df19bab19cc';

// Map bot IDs to teams
const hbBots = data.bots.filter(b => b.agentId === HBFREED_AGENT).map(b => b.id);
const ourBots = data.bots.filter(b => b.agentId === OUR_AGENT).map(b => b.id);

const hbSet = new Set(hbBots);
const ourSet = new Set(ourBots);

function botLabel(id) {
  const bot = data.bots.find(b => b.id === id);
  if (!bot) return id;
  return bot.name;
}

function shortLabel(id) {
  if (hbSet.has(id)) return 'HB#' + (hbBots.indexOf(id) + 1);
  if (ourSet.has(id)) return 'US#' + (ourBots.indexOf(id) + 1);
  return id;
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ============================================================
// SECTION 1: Extract ALL ability events with full context
// ============================================================

const abilityEvents = [];
const damageEvents = [];
const attackEvents = [];
const killEvents = [];

for (const frame of data.frames) {
  for (const evt of frame.events) {
    if (evt.type === 'ability') {
      abilityEvents.push({ ...evt, frame });
    }
    if (evt.type === 'damage') {
      damageEvents.push({ ...evt, frame });
    }
    if (evt.type === 'attack') {
      attackEvents.push({ ...evt, frame });
    }
    if (evt.type === 'kill') {
      killEvents.push({ ...evt, frame });
    }
  }
}

// Group damage by tick to associate with abilities
const dmgByTick = {};
for (const d of damageEvents) {
  if (!dmgByTick[d.tick]) dmgByTick[d.tick] = [];
  dmgByTick[d.tick].push(d);
}

// Group attacks by tick
const atkByTick = {};
for (const a of attackEvents) {
  if (!atkByTick[a.tick]) atkByTick[a.tick] = [];
  atkByTick[a.tick].push(a);
}

// ============================================================
// SECTION 1A: Detailed Ability Timeline
// ============================================================
console.log('='.repeat(100));
console.log('SECTION 1: COMPLETE ABILITY TIMELINE');
console.log('='.repeat(100));

const hbAbilities = abilityEvents.filter(e => hbSet.has(e.botId));
const ourAbilities = abilityEvents.filter(e => ourSet.has(e.botId));

// Track last ability tick per bot for cooldown analysis
const lastAbilityTick = {};

console.log('\n--- HBFREED-OPUS ABILITIES ---\n');
console.log(`Total abilities fired: ${hbAbilities.length}\n`);

for (const ab of hbAbilities) {
  const tick = ab.tick;
  const botId = ab.botId;
  const targetPos = ab.targetPosition;

  // Cooldown gap
  const prevTick = lastAbilityTick[botId];
  const cooldownGap = prevTick !== undefined ? tick - prevTick : 'FIRST';
  lastAbilityTick[botId] = tick;

  // Find bot positions at this tick
  const botPositions = {};
  for (const bot of ab.frame.bots) {
    botPositions[bot.id] = bot;
  }

  // Find which bots got hit (damage events at same tick from this attacker with 15 dmg)
  const tickDamages = dmgByTick[tick] || [];
  const abilityDamages = tickDamages.filter(d => d.attackerId === botId && d.damage === 15);

  // Check distance of each bot from target position
  const ourBotDistances = ourBots.map(id => {
    const bot = botPositions[id];
    if (!bot || !bot.alive) return { id, label: shortLabel(id), dist: Infinity, alive: false, health: 0 };
    const d = dist(bot.position, targetPos);
    return { id, label: shortLabel(id), dist: d, alive: true, health: bot.health, position: bot.position };
  }).filter(b => b.alive).sort((a, b) => a.dist - b.dist);

  // Check if any hbfreed bots in blast radius (friendly fire risk)
  const hbBotDistances = hbBots.map(id => {
    const bot = botPositions[id];
    if (!bot || !bot.alive) return { id, label: shortLabel(id), dist: Infinity, alive: false };
    const d = dist(bot.position, targetPos);
    return { id, label: shortLabel(id), dist: d, alive: true, health: bot.health };
  }).filter(b => b.alive && b.dist <= 150);

  const hitsStr = abilityDamages.map(d => `${shortLabel(d.targetId)} (${d.damage}dmg)`).join(', ') || 'MISS';
  const nearbyEnemies = ourBotDistances.filter(b => b.dist <= 150);
  const nearbyFriendly = hbBotDistances.filter(b => b.id !== botId);

  console.log(`Tick ${String(tick).padStart(4)}: ${shortLabel(botId)} → pos(${targetPos.x.toFixed(0)}, ${targetPos.y.toFixed(0)}) | CD gap: ${cooldownGap} | Hit: ${hitsStr}`);
  console.log(`         Enemies in blast (≤150): ${nearbyEnemies.map(b => `${b.label}@${b.dist.toFixed(0)}u`).join(', ') || 'none'}`);
  console.log(`         Friendlies in blast: ${nearbyFriendly.map(b => `${b.label}@${b.dist.toFixed(0)}u`).join(', ') || 'none'}`);

  // Check if leading target (compare target pos to nearest enemy position)
  if (nearbyEnemies.length > 0) {
    const closest = nearbyEnemies[0];
    const offset = { x: targetPos.x - closest.position.x, y: targetPos.y - closest.position.y };
    const offsetDist = Math.sqrt(offset.x ** 2 + offset.y ** 2);
    if (offsetDist > 5) {
      console.log(`         Lead offset: ${offsetDist.toFixed(0)}u from ${closest.label} (dx=${offset.x.toFixed(0)}, dy=${offset.y.toFixed(0)})`);
    }
  }
  console.log();
}

// Reset for our abilities
const lastAbilityTickOurs = {};

console.log('\n--- OUR (SEMalytics) ABILITIES ---\n');
console.log(`Total abilities fired: ${ourAbilities.length}\n`);

for (const ab of ourAbilities) {
  const tick = ab.tick;
  const botId = ab.botId;
  const targetPos = ab.targetPosition;

  const prevTick = lastAbilityTickOurs[botId];
  const cooldownGap = prevTick !== undefined ? tick - prevTick : 'FIRST';
  lastAbilityTickOurs[botId] = tick;

  const botPositions = {};
  for (const bot of ab.frame.bots) {
    botPositions[bot.id] = bot;
  }

  const tickDamages = dmgByTick[tick] || [];
  const abilityDamages = tickDamages.filter(d => d.attackerId === botId && d.damage === 15);

  const hbBotDistances = hbBots.map(id => {
    const bot = botPositions[id];
    if (!bot || !bot.alive) return { id, label: shortLabel(id), dist: Infinity, alive: false };
    const d = dist(bot.position, targetPos);
    return { id, label: shortLabel(id), dist: d, alive: true, health: bot.health, position: bot.position };
  }).filter(b => b.alive).sort((a, b) => a.dist - b.dist);

  const hitsStr = abilityDamages.map(d => `${shortLabel(d.targetId)} (${d.damage}dmg)`).join(', ') || 'MISS';
  const nearbyEnemies = hbBotDistances.filter(b => b.dist <= 150);

  console.log(`Tick ${String(tick).padStart(4)}: ${shortLabel(botId)} → pos(${targetPos.x.toFixed(0)}, ${targetPos.y.toFixed(0)}) | CD gap: ${cooldownGap} | Hit: ${hitsStr}`);
  console.log(`         Enemies in blast (≤150): ${nearbyEnemies.map(b => `${b.label}@${b.dist.toFixed(0)}u`).join(', ') || 'none'}`);
  console.log();
}

// ============================================================
// SECTION 2: Ability Targeting Logic
// ============================================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 2: ABILITY TARGETING LOGIC');
console.log('='.repeat(100));

// For each hbfreed ability, check if the same bot also meleed at the same tick or nearby ticks
console.log('\n--- HBFREED: Ability vs Melee Target Comparison ---\n');

for (const ab of hbAbilities) {
  const tick = ab.tick;
  const botId = ab.botId;
  const targetPos = ab.targetPosition;

  // Find melee attacks by this bot within +/-2 ticks
  const nearbyMelee = [];
  for (let t = tick - 2; t <= tick + 2; t++) {
    const atks = atkByTick[t] || [];
    for (const a of atks) {
      if (a.botId === botId) nearbyMelee.push(a);
    }
  }

  // Find closest enemy to ability target
  const botPositions = {};
  for (const bot of ab.frame.bots) {
    botPositions[bot.id] = bot;
  }

  const closestEnemy = ourBots
    .map(id => {
      const bot = botPositions[id];
      if (!bot || !bot.alive) return null;
      return { id, dist: dist(bot.position, targetPos) };
    })
    .filter(b => b !== null)
    .sort((a, b) => a.dist - b.dist)[0];

  const abilityTarget = closestEnemy ? shortLabel(closestEnemy.id) : 'none';
  const meleeTargets = nearbyMelee.map(m => shortLabel(m.targetId || 'unknown'));

  console.log(`Tick ${tick}: ${shortLabel(botId)} ability aimed at → ${abilityTarget} (${closestEnemy ? closestEnemy.dist.toFixed(0) + 'u' : 'n/a'})`);
  if (nearbyMelee.length > 0) {
    console.log(`   Melee targets (ticks ${tick-2}-${tick+2}): ${meleeTargets.join(', ')}`);
    const sameTarget = meleeTargets.some(t => t === abilityTarget);
    console.log(`   Same target? ${sameTarget ? 'YES' : 'NO — DIFFERENT TARGETS'}`);
  } else {
    console.log(`   No melee attacks within ±2 ticks`);
  }
}

// Check for multi-hit abilities (aimed at midpoint between bots)
console.log('\n--- Multi-Hit Analysis ---\n');

for (const ab of hbAbilities) {
  const tick = ab.tick;
  const botId = ab.botId;
  const targetPos = ab.targetPosition;

  const botPositions = {};
  for (const bot of ab.frame.bots) {
    botPositions[bot.id] = bot;
  }

  const enemiesInBlast = ourBots
    .map(id => {
      const bot = botPositions[id];
      if (!bot || !bot.alive) return null;
      const d = dist(bot.position, targetPos);
      return { id, label: shortLabel(id), dist: d, position: bot.position };
    })
    .filter(b => b !== null && b.dist <= 150);

  if (enemiesInBlast.length >= 2) {
    // Check if target is at midpoint
    const midX = enemiesInBlast.reduce((s, b) => s + b.position.x, 0) / enemiesInBlast.length;
    const midY = enemiesInBlast.reduce((s, b) => s + b.position.y, 0) / enemiesInBlast.length;
    const midDist = dist(targetPos, { x: midX, y: midY });
    console.log(`Tick ${tick}: ${shortLabel(botId)} MULTI-HIT! Hit ${enemiesInBlast.length} enemies: ${enemiesInBlast.map(b => b.label).join(', ')}`);
    console.log(`   Target vs midpoint offset: ${midDist.toFixed(0)}u`);
  }
}

// ============================================================
// SECTION 3: Ability Timing Pattern
// ============================================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 3: ABILITY TIMING PATTERN');
console.log('='.repeat(100));

// First ability per bot
console.log('\n--- First Ability Timing ---\n');
const firstAbility = {};
for (const ab of hbAbilities) {
  if (!firstAbility[ab.botId]) firstAbility[ab.botId] = ab.tick;
}
for (const id of hbBots) {
  console.log(`${shortLabel(id)}: First ability at tick ${firstAbility[id] || 'NEVER'}`);
}

const firstAbilityOurs = {};
for (const ab of ourAbilities) {
  if (!firstAbilityOurs[ab.botId]) firstAbilityOurs[ab.botId] = ab.tick;
}
console.log();
for (const id of ourBots) {
  console.log(`${shortLabel(id)}: First ability at tick ${firstAbilityOurs[id] || 'NEVER'}`);
}

// Cooldown analysis
console.log('\n--- Cooldown Analysis (hbfreed) ---\n');
const abilitiesByBot = {};
for (const ab of hbAbilities) {
  if (!abilitiesByBot[ab.botId]) abilitiesByBot[ab.botId] = [];
  abilitiesByBot[ab.botId].push(ab.tick);
}

for (const [botId, ticks] of Object.entries(abilitiesByBot)) {
  const gaps = [];
  for (let i = 1; i < ticks.length; i++) {
    gaps.push(ticks[i] - ticks[i - 1]);
  }
  console.log(`${shortLabel(botId)}: Fired at ticks [${ticks.join(', ')}]`);
  console.log(`   Gaps: [${gaps.join(', ')}] (min cooldown = 30)`);
  const onCooldown = gaps.filter(g => g === 30).length;
  const delayed = gaps.filter(g => g > 30).length;
  console.log(`   On cooldown: ${onCooldown}/${gaps.length}, Delayed: ${delayed}/${gaps.length}`);
}

// Coordinated timing
console.log('\n--- Coordinated Firing (same tick) ---\n');
const abByTick = {};
for (const ab of hbAbilities) {
  if (!abByTick[ab.tick]) abByTick[ab.tick] = [];
  abByTick[ab.tick].push(ab);
}
for (const [tick, abs] of Object.entries(abByTick)) {
  if (abs.length >= 2) {
    console.log(`Tick ${tick}: ${abs.length} abilities fired simultaneously by ${abs.map(a => shortLabel(a.botId)).join(', ')}`);
  }
}

// ============================================================
// SECTION 4: Our Ability Usage (same analysis)
// ============================================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 4: OUR ABILITY USAGE');
console.log('='.repeat(100));

const ourAbilitiesByBot = {};
for (const ab of ourAbilities) {
  if (!ourAbilitiesByBot[ab.botId]) ourAbilitiesByBot[ab.botId] = [];
  ourAbilitiesByBot[ab.botId].push(ab.tick);
}

console.log('\n--- Our Cooldown Analysis ---\n');
for (const [botId, ticks] of Object.entries(ourAbilitiesByBot)) {
  const gaps = [];
  for (let i = 1; i < ticks.length; i++) {
    gaps.push(ticks[i] - ticks[i - 1]);
  }
  console.log(`${shortLabel(botId)}: Fired at ticks [${ticks.join(', ')}]`);
  console.log(`   Gaps: [${gaps.join(', ')}] (min cooldown = 30)`);
}

// Bots that NEVER fired abilities
console.log('\n--- Bots That Never Fired Abilities ---');
for (const id of ourBots) {
  if (!ourAbilitiesByBot[id]) {
    // Find when this bot died
    let deathTick = null;
    for (const frame of data.frames) {
      const bot = frame.bots.find(b => b.id === id);
      if (bot && !bot.alive && deathTick === null) {
        deathTick = frame.tick;
      }
    }
    console.log(`${shortLabel(id)}: NEVER fired ability (died at tick ${deathTick || 'unknown'})`);
  }
}

// ============================================================
// SECTION 5: The DPS Gap
// ============================================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 5: THE DPS GAP');
console.log('='.repeat(100));

// Total damage by type per team
let hbAbilityDmg = 0, hbMeleeDmg = 0, hbZoneDmg = 0;
let ourAbilityDmg = 0, ourMeleeDmg = 0, ourZoneDmg = 0;
let hbAbilityHits = 0, ourAbilityHits = 0;
let hbMeleeHits = 0, ourMeleeHits = 0;

for (const d of damageEvents) {
  const isHb = hbSet.has(d.attackerId);
  const isOurs = ourSet.has(d.attackerId);
  const isZone = d.attackerId === 'zone' || d.type === 'zone_damage';

  if (d.damage === 15 && (isHb || isOurs)) {
    if (isHb) { hbAbilityDmg += d.damage; hbAbilityHits++; }
    if (isOurs) { ourAbilityDmg += d.damage; ourAbilityHits++; }
  } else if (d.damage === 10 && (isHb || isOurs)) {
    if (isHb) { hbMeleeDmg += d.damage; hbMeleeHits++; }
    if (isOurs) { ourMeleeDmg += d.damage; ourMeleeHits++; }
  } else if (d.damage === 3) {
    // Zone damage - check who it hit
    if (ourSet.has(d.targetId)) ourZoneDmg += d.damage;
    if (hbSet.has(d.targetId)) hbZoneDmg += d.damage;
  }
}

console.log('\n--- Damage Totals ---\n');
console.log(`                    HBFREED-OPUS    SEMalytics`);
console.log(`Ability damage:     ${String(hbAbilityDmg).padStart(8)}        ${String(ourAbilityDmg).padStart(8)}`);
console.log(`Ability hits:       ${String(hbAbilityHits).padStart(8)}        ${String(ourAbilityHits).padStart(8)}`);
console.log(`Melee damage:       ${String(hbMeleeDmg).padStart(8)}        ${String(ourMeleeDmg).padStart(8)}`);
console.log(`Melee hits:         ${String(hbMeleeHits).padStart(8)}        ${String(ourMeleeHits).padStart(8)}`);
console.log(`Zone dmg taken:     ${String(hbZoneDmg).padStart(8)}        ${String(ourZoneDmg).padStart(8)}`);
console.log(`Total dmg dealt:    ${String(hbAbilityDmg + hbMeleeDmg).padStart(8)}        ${String(ourAbilityDmg + ourMeleeDmg).padStart(8)}`);
console.log(`Abilities fired:    ${String(hbAbilities.length).padStart(8)}        ${String(ourAbilities.length).padStart(8)}`);
console.log(`Dmg per ability:    ${hbAbilities.length ? String((hbAbilityDmg / hbAbilities.length).toFixed(1)).padStart(8) : '     N/A'}        ${ourAbilities.length ? String((ourAbilityDmg / ourAbilities.length).toFixed(1)).padStart(8) : '     N/A'}`);

// ============================================================
// SECTION 5B: Missed Ability Opportunities (us)
// ============================================================
console.log('\n--- Our Missed Ability Opportunities ---\n');
console.log('(Ticks where we had enemy in ability range, ability off cooldown, but did NOT fire)\n');

// Track ability cooldowns for our bots
const ourCooldowns = {};
for (const id of ourBots) ourCooldowns[id] = 0; // ready from tick 0

let missedOpportunities = 0;
const missedDetails = [];

for (const frame of data.frames) {
  const tick = frame.tick;

  // Check if any of our bots fired this tick
  const firedThisTick = new Set();
  for (const evt of frame.events) {
    if (evt.type === 'ability' && ourSet.has(evt.botId)) {
      firedThisTick.add(evt.botId);
      ourCooldowns[evt.botId] = tick + 30;
    }
  }

  // For each of our alive bots, check if they could have fired
  for (const ourBot of frame.bots) {
    if (!ourSet.has(ourBot.id) || !ourBot.alive) continue;
    if (firedThisTick.has(ourBot.id)) continue;
    if (tick < (ourCooldowns[ourBot.id] || 0)) continue; // on cooldown

    // Check if any enemy is within ability cast range (500)
    const enemiesInRange = frame.bots
      .filter(b => hbSet.has(b.id) && b.alive)
      .map(b => ({ id: b.id, dist: dist(b.position, ourBot.position) }))
      .filter(b => b.dist <= 500);

    if (enemiesInRange.length > 0) {
      missedOpportunities++;
      if (missedDetails.length < 30) { // Cap output
        const closest = enemiesInRange.sort((a, b) => a.dist - b.dist)[0];
        missedDetails.push({
          tick,
          bot: shortLabel(ourBot.id),
          enemiesInRange: enemiesInRange.length,
          closestEnemy: shortLabel(closest.id),
          closestDist: closest.dist.toFixed(0)
        });
      }
    }
  }
}

console.log(`Total missed opportunities: ${missedOpportunities} bot-ticks\n`);
console.log('First 30 examples:');
for (const m of missedDetails) {
  console.log(`  Tick ${String(m.tick).padStart(4)}: ${m.bot} had ${m.enemiesInRange} enemies in range (closest: ${m.closestEnemy} at ${m.closestDist}u) — DID NOT FIRE`);
}

// ============================================================
// SECTION 6: Kill Timeline
// ============================================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 6: KILL TIMELINE');
console.log('='.repeat(100));
console.log();

for (const k of killEvents) {
  console.log(`Tick ${String(k.tick).padStart(4)}: ${shortLabel(k.attackerId || 'zone')} killed ${shortLabel(k.targetId || k.botId)}`);
}

// ============================================================
// SECTION 7: Health over time
// ============================================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 7: HEALTH SNAPSHOTS (every 50 ticks)');
console.log('='.repeat(100));
console.log();

for (const frame of data.frames) {
  if (frame.tick % 50 !== 0) continue;

  const hbHealth = frame.bots.filter(b => hbSet.has(b.id)).map(b => b.alive ? b.health : 0);
  const ourHealth = frame.bots.filter(b => ourSet.has(b.id)).map(b => b.alive ? b.health : 0);
  const hbTotal = hbHealth.reduce((s, h) => s + h, 0);
  const ourTotal = ourHealth.reduce((s, h) => s + h, 0);
  const hbAlive = hbHealth.filter(h => h > 0).length;
  const ourAlive = ourHealth.filter(h => h > 0).length;

  console.log(`Tick ${String(frame.tick).padStart(4)}: HB ${hbAlive} alive (${hbTotal} HP) [${hbHealth.join(',')}] | US ${ourAlive} alive (${ourTotal} HP) [${ourHealth.join(',')}]`);
}

// Final state
const lastFrame = data.frames[data.frames.length - 1];
console.log(`\nFinal tick: ${lastFrame.tick}`);
const hbFinal = lastFrame.bots.filter(b => hbSet.has(b.id));
const ourFinal = lastFrame.bots.filter(b => ourSet.has(b.id));
console.log(`HBfreed surviving: ${hbFinal.filter(b => b.alive).length} bots, total HP: ${hbFinal.reduce((s, b) => s + (b.alive ? b.health : 0), 0)}`);
console.log(`SEMalytics surviving: ${ourFinal.filter(b => b.alive).length} bots, total HP: ${ourFinal.reduce((s, b) => s + (b.alive ? b.health : 0), 0)}`);

// ============================================================
// SECTION 8: Damage breakdown per bot
// ============================================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 8: DAMAGE DEALT PER BOT');
console.log('='.repeat(100));
console.log();

const dmgDealtByBot = {};
const dmgTakenByBot = {};

for (const d of damageEvents) {
  if (d.attackerId && d.attackerId !== 'zone') {
    if (!dmgDealtByBot[d.attackerId]) dmgDealtByBot[d.attackerId] = { melee: 0, ability: 0 };
    if (d.damage === 15) dmgDealtByBot[d.attackerId].ability += d.damage;
    else if (d.damage === 10) dmgDealtByBot[d.attackerId].melee += d.damage;
  }
  if (d.targetId) {
    if (!dmgTakenByBot[d.targetId]) dmgTakenByBot[d.targetId] = { melee: 0, ability: 0, zone: 0 };
    if (d.damage === 3) dmgTakenByBot[d.targetId].zone += d.damage;
    else if (d.damage === 15) dmgTakenByBot[d.targetId].ability += d.damage;
    else if (d.damage === 10) dmgTakenByBot[d.targetId].melee += d.damage;
  }
}

console.log('HBFREED bots:');
for (const id of hbBots) {
  const dealt = dmgDealtByBot[id] || { melee: 0, ability: 0 };
  const taken = dmgTakenByBot[id] || { melee: 0, ability: 0, zone: 0 };
  console.log(`  ${shortLabel(id)}: Dealt ${dealt.melee + dealt.ability} (melee:${dealt.melee} ability:${dealt.ability}) | Taken ${taken.melee + taken.ability + taken.zone} (melee:${taken.melee} ability:${taken.ability} zone:${taken.zone})`);
}

console.log('\nSEMalytics bots:');
for (const id of ourBots) {
  const dealt = dmgDealtByBot[id] || { melee: 0, ability: 0 };
  const taken = dmgTakenByBot[id] || { melee: 0, ability: 0, zone: 0 };
  console.log(`  ${shortLabel(id)}: Dealt ${dealt.melee + dealt.ability} (melee:${dealt.melee} ability:${dealt.ability}) | Taken ${taken.melee + taken.ability + taken.zone} (melee:${taken.melee} ability:${taken.ability} zone:${taken.zone})`);
}

// ============================================================
// SECTION 9: hbfreed melee attack patterns (for comparison)
// ============================================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 9: MELEE ATTACK PATTERNS');
console.log('='.repeat(100));
console.log();

const hbMeleeTargets = {};
for (const atk of attackEvents) {
  if (hbSet.has(atk.botId)) {
    if (!hbMeleeTargets[atk.botId]) hbMeleeTargets[atk.botId] = {};
    const target = atk.targetId;
    if (!hbMeleeTargets[atk.botId][target]) hbMeleeTargets[atk.botId][target] = 0;
    hbMeleeTargets[atk.botId][target]++;
  }
}

console.log('HBFREED melee target distribution:');
for (const [botId, targets] of Object.entries(hbMeleeTargets)) {
  const sorted = Object.entries(targets).sort((a, b) => b[1] - a[1]);
  console.log(`  ${shortLabel(botId)}: ${sorted.map(([t, c]) => `${shortLabel(t)}(${c})`).join(', ')}`);
}

const ourMeleeTargets = {};
for (const atk of attackEvents) {
  if (ourSet.has(atk.botId)) {
    if (!ourMeleeTargets[atk.botId]) ourMeleeTargets[atk.botId] = {};
    const target = atk.targetId;
    if (!ourMeleeTargets[atk.botId][target]) ourMeleeTargets[atk.botId][target] = 0;
    ourMeleeTargets[atk.botId][target]++;
  }
}

console.log('\nSEMalytics melee target distribution:');
for (const [botId, targets] of Object.entries(ourMeleeTargets)) {
  const sorted = Object.entries(targets).sort((a, b) => b[1] - a[1]);
  console.log(`  ${shortLabel(botId)}: ${sorted.map(([t, c]) => `${shortLabel(t)}(${c})`).join(', ')}`);
}

// Focus fire analysis
console.log('\n--- Focus Fire Analysis ---\n');
const hbTargetsByTick = {};
for (const atk of attackEvents.filter(a => hbSet.has(a.botId))) {
  if (!hbTargetsByTick[atk.tick]) hbTargetsByTick[atk.tick] = [];
  hbTargetsByTick[atk.tick].push(atk.targetId);
}

let focusedTicks = 0, totalAttackTicks = 0;
for (const [tick, targets] of Object.entries(hbTargetsByTick)) {
  if (targets.length >= 2) {
    totalAttackTicks++;
    const unique = new Set(targets);
    if (unique.size === 1) focusedTicks++;
  }
}
console.log(`HBFREED focus fire: ${focusedTicks}/${totalAttackTicks} multi-attack ticks had all bots on same target (${totalAttackTicks ? (focusedTicks/totalAttackTicks*100).toFixed(0) : 0}%)`);

const ourTargetsByTick = {};
for (const atk of attackEvents.filter(a => ourSet.has(a.botId))) {
  if (!ourTargetsByTick[atk.tick]) ourTargetsByTick[atk.tick] = [];
  ourTargetsByTick[atk.tick].push(atk.targetId);
}

let ourFocusedTicks = 0, ourTotalAttackTicks = 0;
for (const [tick, targets] of Object.entries(ourTargetsByTick)) {
  if (targets.length >= 2) {
    ourTotalAttackTicks++;
    const unique = new Set(targets);
    if (unique.size === 1) ourFocusedTicks++;
  }
}
console.log(`SEMalytics focus fire: ${ourFocusedTicks}/${ourTotalAttackTicks} multi-attack ticks had all bots on same target (${ourTotalAttackTicks ? (ourFocusedTicks/ourTotalAttackTicks*100).toFixed(0) : 0}%)`);
