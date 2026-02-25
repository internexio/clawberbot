/**
 * v1 Pack Tactics — Coordinated 5-bot team strategy
 *
 * Roles:
 *   Bot 0: Scout/Tank — leads the pack, finds enemies
 *   Bot 1-2: Flankers — approach from sides
 *   Bot 3-4: Support — stay near allies, use abilities
 *
 * Strategy:
 *   - All bots maintain zone awareness (never die to zone)
 *   - Focus fire on weakest enemy (coordinated via shared state)
 *   - Use AoE abilities when enemies cluster (>2 within 150 units)
 *   - Retreat when low HP (<30) to avoid feeding kills
 */

// Shared state across all 5 bots (persists within match)
if (typeof _state === 'undefined') {
  var _state = {
    focusTarget: null,
    lastTargetTick: 0,
  };
}

function update(input) {
  const ATTACK_RANGE = 200;
  const ABILITY_RANGE = 500;
  const ABILITY_RADIUS = 150;
  const ZONE_BUFFER = 200;  // Stay this far inside zone edge
  const LOW_HP = 30;
  const REGROUP_DIST = 300; // Max distance from team center

  const self = input.bots.find(b => b.id === input.selfId);
  if (!self || !self.alive) return { type: 'idle' };

  const teamIds = new Set(input.teamBotIds);
  const allies = input.bots.filter(b => b.alive && teamIds.has(b.id) && b.id !== input.selfId);
  const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));

  if (enemies.length === 0) return { type: 'idle' };

  // ── Zone awareness ──────────────────────────────────
  const zone = input.zone;
  const distToZoneCenter = Math.hypot(
    self.position.x - zone.centerX,
    self.position.y - zone.centerY
  );

  // If outside zone or near edge, move toward center immediately
  if (distToZoneCenter > zone.radius - ZONE_BUFFER) {
    return {
      type: 'move',
      direction: {
        x: zone.centerX - self.position.x,
        y: zone.centerY - self.position.y,
      }
    };
  }

  // ── Low HP retreat ──────────────────────────────────
  if (self.health < LOW_HP && allies.length > 0) {
    // Move toward nearest ally
    const nearestAlly = allies.reduce((a, b) => {
      const da = Math.hypot(a.position.x - self.position.x, a.position.y - self.position.y);
      const db = Math.hypot(b.position.x - self.position.x, b.position.y - self.position.y);
      return da < db ? a : b;
    });
    const allyDist = Math.hypot(
      nearestAlly.position.x - self.position.x,
      nearestAlly.position.y - self.position.y
    );
    if (allyDist > 100) {
      return {
        type: 'move',
        direction: {
          x: nearestAlly.position.x - self.position.x,
          y: nearestAlly.position.y - self.position.y,
        }
      };
    }
  }

  // ── Target selection (shared focus fire) ────────────
  // Refresh target every 30 ticks or if current target is dead
  let target = null;
  if (_state.focusTarget && input.tick - _state.lastTargetTick < 30) {
    target = enemies.find(e => e.id === _state.focusTarget);
  }

  if (!target) {
    // Priority: lowest HP enemy that's in range of at least 2 team members
    const scored = enemies.map(e => {
      const alliedInRange = allies.filter(a =>
        Math.hypot(a.position.x - e.position.x, a.position.y - e.position.y) < 400
      ).length;
      const myDist = Math.hypot(
        e.position.x - self.position.x,
        e.position.y - self.position.y
      );
      // Lower score = better target
      return {
        enemy: e,
        score: e.health - (alliedInRange * 20) + (myDist * 0.05),
      };
    });
    scored.sort((a, b) => a.score - b.score);
    target = scored[0].enemy;

    _state.focusTarget = target.id;
    _state.lastTargetTick = input.tick;
  }

  const targetDist = Math.hypot(
    target.position.x - self.position.x,
    target.position.y - self.position.y
  );

  // ── AoE ability check ──────────────────────────────
  // Use ability if 2+ enemies are clustered
  if (targetDist <= ABILITY_RANGE) {
    const nearTarget = enemies.filter(e =>
      Math.hypot(e.position.x - target.position.x, e.position.y - target.position.y) < ABILITY_RADIUS
    );
    if (nearTarget.length >= 2) {
      return {
        type: 'ability',
        targetPosition: { x: target.position.x, y: target.position.y },
      };
    }
  }

  // ── Role-based behavior ────────────────────────────
  if (input.botNumber === 0) {
    // TANK: Charge straight at focus target
    if (targetDist <= ATTACK_RANGE) {
      return { type: 'attack', targetId: target.id };
    }
    return {
      type: 'move',
      direction: {
        x: target.position.x - self.position.x,
        y: target.position.y - self.position.y,
      }
    };
  }

  if (input.botNumber <= 2) {
    // FLANKERS: Approach from offset angle
    const angle = Math.atan2(
      target.position.y - self.position.y,
      target.position.x - self.position.x
    );
    const flankAngle = input.botNumber === 1 ? angle + 0.6 : angle - 0.6;

    if (targetDist <= ATTACK_RANGE) {
      return { type: 'attack', targetId: target.id };
    }

    // If close enough, go direct; otherwise flank
    if (targetDist < 350) {
      return {
        type: 'move',
        direction: {
          x: target.position.x - self.position.x,
          y: target.position.y - self.position.y,
        }
      };
    }

    return {
      type: 'move',
      direction: {
        x: Math.cos(flankAngle),
        y: Math.sin(flankAngle),
      }
    };
  }

  // SUPPORT (bots 3-4): Stay mid-range, use abilities, attack when safe
  if (targetDist <= ABILITY_RANGE && targetDist > ATTACK_RANGE) {
    // Use ability from range
    return {
      type: 'ability',
      targetPosition: { x: target.position.x, y: target.position.y },
    };
  }

  if (targetDist <= ATTACK_RANGE) {
    return { type: 'attack', targetId: target.id };
  }

  // Move toward target but not too aggressively
  const teamCenter = {
    x: allies.reduce((s, a) => s + a.position.x, self.position.x) / (allies.length + 1),
    y: allies.reduce((s, a) => s + a.position.y, self.position.y) / (allies.length + 1),
  };

  // Blend: 70% toward target, 30% toward team center
  return {
    type: 'move',
    direction: {
      x: (target.position.x - self.position.x) * 0.7 +
         (teamCenter.x - self.position.x) * 0.3,
      y: (target.position.y - self.position.y) * 0.7 +
         (teamCenter.y - self.position.y) * 0.3,
    }
  };
}
