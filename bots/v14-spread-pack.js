/**
 * v14 Spread Pack — Phase 1: Bug fixes + AoE for all + cooldown tracking
 *
 * Fixes from replay analysis:
 *   1. Zone oscillation bug — hysteresis prevents edge oscillation
 *   2. AoE for all bots — not just support (50% more dmg than melee)
 *   3. Cooldown tracking — no wasted ticks on rejected abilities
 *   4. Improved focus-fire — tighter target selection, faster switching
 *
 * Strategy: Pack focus-fire with zone-gravity and universal AoE
 */

// Shared state across all 5 bots (persists within match)
if (typeof _state === 'undefined') {
  var _state = {
    focusTarget: null,
    lastTargetTick: 0,
    abilityCooldown: {},   // { botNumber: lastUseTick }
    attackCooldown: {},     // { botNumber: lastAttackTick }
    zoneRetreat: {},        // { botNumber: true/false } — hysteresis flag
  };
}

function update(input) {
  const ATTACK_RANGE = 200;
  const ATTACK_COOLDOWN = 5;
  const ABILITY_RANGE = 500;
  const ABILITY_RADIUS = 150;
  const ABILITY_COOLDOWN = 30;
  const ABILITY_DMG = 15;
  const MELEE_DMG = 10;
  const ZONE_BUFFER = 250;
  const ZONE_SAFE = 350;       // Must reach this far inside before clearing retreat flag
  const LOW_HP = 25;
  const BOT_SPEED = 12;

  const self = input.bots.find(b => b.id === input.selfId);
  if (!self || !self.alive) return { type: 'idle' };

  const bn = input.botNumber;
  const tick = input.tick;
  const teamIds = new Set(input.teamBotIds);
  const allies = input.bots.filter(b => b.alive && teamIds.has(b.id) && b.id !== input.selfId);
  const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));

  if (enemies.length === 0) return { type: 'idle' };

  const zone = input.zone;
  const distToZoneCenter = Math.hypot(
    self.position.x - zone.centerX,
    self.position.y - zone.centerY
  );

  // ── Helper functions ───────────────────────────────
  function dist(a, b) {
    return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  }

  function dirTo(from, to) {
    return { x: to.x - from.x, y: to.y - from.y };
  }

  function dirToBot(target) {
    return dirTo(self.position, target.position);
  }

  function canAbility() {
    const last = _state.abilityCooldown[bn] || -999;
    return tick - last >= ABILITY_COOLDOWN;
  }

  function canAttack() {
    const last = _state.attackCooldown[bn] || -999;
    return tick - last >= ATTACK_COOLDOWN;
  }

  function useAbility(pos) {
    _state.abilityCooldown[bn] = tick;
    return { type: 'ability', targetPosition: pos };
  }

  function useAttack(targetId) {
    _state.attackCooldown[bn] = tick;
    return { type: 'attack', targetId: targetId };
  }

  // ── Zone awareness with hysteresis ─────────────────
  // Once retreat triggers, don't stop until well inside zone
  if (distToZoneCenter > zone.radius - ZONE_BUFFER) {
    _state.zoneRetreat[bn] = true;
  }
  if (distToZoneCenter < zone.radius - ZONE_SAFE) {
    _state.zoneRetreat[bn] = false;
  }

  if (_state.zoneRetreat[bn]) {
    // Even while retreating to zone, fire ability if enemy is in range
    if (canAbility()) {
      const abilityTarget = enemies.find(e => dist(self, e) <= ABILITY_RANGE);
      if (abilityTarget) {
        return {
          ...useAbility({ x: abilityTarget.position.x, y: abilityTarget.position.y }),
          // Note: ability doesn't prevent movement, but we prioritize zone safety
        };
      }
    }

    return {
      type: 'move',
      direction: dirTo(self.position, { x: zone.centerX, y: zone.centerY }),
    };
  }

  // ── Zone gravity — constant mild pull toward center ─
  // Blend into all movement decisions later
  const zoneUrgency = Math.max(0, (distToZoneCenter / zone.radius) - 0.5) * 2;
  // 0 when near center, ramps to 1 near edge

  // ── Target selection (shared focus fire) ────────────
  let target = null;

  // Keep current target if alive and recently set
  if (_state.focusTarget && tick - _state.lastTargetTick < 20) {
    target = enemies.find(e => e.id === _state.focusTarget);
  }

  if (!target) {
    // Score enemies: lowest HP + most allies nearby + closest
    const scored = enemies.map(e => {
      const alliedInRange = allies.filter(a => dist(a, e) < 400).length + 1; // +1 for self
      const myDist = dist(self, e);
      // Lower score = better target
      // Heavily weight low HP (kill confirms), then ally pressure, then distance
      return {
        enemy: e,
        score: e.health * 2 - (alliedInRange * 30) + (myDist * 0.03),
      };
    });
    scored.sort((a, b) => a.score - b.score);
    target = scored[0].enemy;

    _state.focusTarget = target.id;
    _state.lastTargetTick = tick;
  }

  const targetDist = dist(self, target);

  // ── Low HP retreat ─────────────────────────────────
  if (self.health <= LOW_HP && allies.length > 0) {
    // Move toward nearest ally for protection
    const nearestAlly = allies.reduce((a, b) => dist(self, a) < dist(self, b) ? a : b);
    if (dist(self, nearestAlly) > 80) {
      // But still fire ability while retreating if possible
      if (canAbility() && targetDist <= ABILITY_RANGE) {
        return useAbility({ x: target.position.x, y: target.position.y });
      }
      return {
        type: 'move',
        direction: dirToBot(nearestAlly),
      };
    }
  }

  // ── Ability check (ALL bots, not just support) ─────
  // Priority: ability > melee when off cooldown and in range
  if (canAbility() && targetDist <= ABILITY_RANGE) {
    // Find best AoE position — center of enemy cluster near target
    let bestPos = { x: target.position.x, y: target.position.y };
    let bestHits = 1;

    // Check if any position near target hits more enemies
    const nearbyEnemies = enemies.filter(e =>
      Math.hypot(e.position.x - target.position.x, e.position.y - target.position.y) < ABILITY_RADIUS * 2
    );

    if (nearbyEnemies.length >= 2) {
      // Use centroid of nearby enemies as ability target for multi-hit
      const cx = nearbyEnemies.reduce((s, e) => s + e.position.x, 0) / nearbyEnemies.length;
      const cy = nearbyEnemies.reduce((s, e) => s + e.position.y, 0) / nearbyEnemies.length;

      // Count how many enemies the centroid would hit
      const centroidHits = nearbyEnemies.filter(e =>
        Math.hypot(e.position.x - cx, e.position.y - cy) <= ABILITY_RADIUS
      ).length;

      if (centroidHits >= bestHits) {
        bestPos = { x: cx, y: cy };
        bestHits = centroidHits;
      }
    }

    // Check if best position is within cast range
    const castDist = Math.hypot(bestPos.x - self.position.x, bestPos.y - self.position.y);
    if (castDist <= ABILITY_RANGE) {
      return useAbility(bestPos);
    }

    // Fallback: aim directly at focus target
    if (targetDist <= ABILITY_RANGE) {
      return useAbility({ x: target.position.x, y: target.position.y });
    }
  }

  // ── Melee attack if in range ───────────────────────
  if (targetDist <= ATTACK_RANGE && canAttack()) {
    return useAttack(target.id);
  }

  // ── Movement — approach target with zone gravity ───
  // Direction toward target
  const dx = target.position.x - self.position.x;
  const dy = target.position.y - self.position.y;

  // Zone gravity component
  const zx = zone.centerX - self.position.x;
  const zy = zone.centerY - self.position.y;

  // Blend: more zone pull as we get closer to edge
  const targetWeight = 1.0 - zoneUrgency * 0.6;
  const zoneWeight = zoneUrgency * 0.6;

  // Flanking offset for bots 1-2 (approach from angles)
  let fx = 0, fy = 0;
  if ((bn === 1 || bn === 2) && targetDist > 300) {
    const angle = Math.atan2(dy, dx);
    const flankAngle = bn === 1 ? angle + 0.7 : angle - 0.7;
    fx = Math.cos(flankAngle) - Math.cos(angle);
    fy = Math.sin(flankAngle) - Math.sin(angle);
  }

  return {
    type: 'move',
    direction: {
      x: dx * targetWeight + zx * zoneWeight + fx * 80,
      y: dy * targetWeight + zy * zoneWeight + fy * 80,
    }
  };
}
