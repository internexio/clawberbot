/**
 * v2 Ability Spam — Aggressive AoE + focus fire + never idle
 *
 * Key improvements over v1:
 *   - Fire AoE ability on cooldown (biggest damage boost — v1 cast 2/game, top bots cast 14-17)
 *   - Track both ability (30-tick) and melee (5-tick) cooldowns to avoid wasted ticks
 *   - All bots play the same — no role differentiation
 *   - Anti-friendly-fire: skip AoE if low-HP ally in blast zone
 *   - Immediate target switching when focus target dies
 *   - Never idle: always move toward target or team center
 *   - Cohesion pull: movement blends toward target + team center to prevent isolation
 */

if (typeof _s === 'undefined') {
  var _s = {
    target: null,
    targetTick: 0,
    abCd: {},    // { selfId: lastAbilityTick }
    atkCd: {},   // { selfId: lastAttackTick }
  };
}

function update(input) {
  const self = input.bots.find(b => b.id === input.selfId);
  if (!self || !self.alive) return { type: 'idle' };

  const tick = input.tick;
  const zone = input.zone;
  const teamIds = new Set(input.teamBotIds);
  const allies = input.bots.filter(b => b.alive && teamIds.has(b.id) && b.id !== input.selfId);
  const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));

  if (enemies.length === 0) return { type: 'idle' };

  // ── Helpers ──────────────────────────────────────────
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const dir = (from, to) => ({ x: to.x - from.x, y: to.y - from.y });

  const allTeam = input.bots.filter(b => b.alive && teamIds.has(b.id));
  const center = {
    x: allTeam.reduce((s, b) => s + b.position.x, 0) / allTeam.length,
    y: allTeam.reduce((s, b) => s + b.position.y, 0) / allTeam.length,
  };

  // ── Zone safety (highest priority) ──────────────────
  const dZone = d(self.position, { x: zone.centerX, y: zone.centerY });
  if (dZone > zone.radius - 120) {
    return { type: 'move', direction: dir(self.position, { x: zone.centerX, y: zone.centerY }) };
  }

  // ── Target selection (shared focus fire) ─────────────
  let target = _s.target ? enemies.find(e => e.id === _s.target) : null;

  if (!target || tick - _s.targetTick > 15) {
    // Lowest HP, tiebreak by closest to team center
    const sorted = enemies.slice().sort((a, b) => {
      if (a.health !== b.health) return a.health - b.health;
      return d(a.position, center) - d(b.position, center);
    });
    target = sorted[0];
    _s.target = target.id;
    _s.targetTick = tick;
  }

  const tDist = d(self.position, target.position);

  // ── Ability (priority 1: highest DPS action) ─────────
  const lastAb = _s.abCd[input.selfId] || -999;
  if (tick - lastAb >= 30 && tDist <= 500) {
    // Check for low-HP allies in blast zone (only skip if ally < 30 HP would die)
    const fragileAllyInBlast = allies.some(a =>
      a.health < 30 && d(a.position, target.position) < 150
    );

    if (!fragileAllyInBlast) {
      _s.abCd[input.selfId] = tick;
      return { type: 'ability', targetPosition: { x: target.position.x, y: target.position.y } };
    }

    // Try alternate target: enemy not near fragile allies
    for (const e of enemies) {
      if (d(self.position, e.position) > 500) continue;
      const fragileNear = allies.some(a => a.health < 30 && d(a.position, e.position) < 150);
      if (!fragileNear) {
        _s.abCd[input.selfId] = tick;
        return { type: 'ability', targetPosition: { x: e.position.x, y: e.position.y } };
      }
    }
  }

  // ── Melee attack (priority 2) ────────────────────────
  const lastAtk = _s.atkCd[input.selfId] || -999;
  if (tick - lastAtk >= 5) {
    // Attack focus target if in range
    if (tDist <= 200) {
      _s.atkCd[input.selfId] = tick;
      return { type: 'attack', targetId: target.id };
    }
    // Opportunistic: attack any enemy in melee range
    const nearby = enemies.find(e => d(self.position, e.position) <= 200);
    if (nearby) {
      _s.atkCd[input.selfId] = tick;
      return { type: 'attack', targetId: nearby.id };
    }
  }

  // ── Movement ─────────────────────────────────────────
  // Low HP retreat toward nearest ally
  if (self.health < 25 && allies.length > 0) {
    const nearEnemies = enemies.filter(e => d(self.position, e.position) < 300).length;
    const nearAllies = allies.filter(a => d(self.position, a.position) < 300).length;
    if (nearEnemies > nearAllies) {
      const closest = allies.reduce((a, b) =>
        d(self.position, a.position) < d(self.position, b.position) ? a : b
      );
      return { type: 'move', direction: dir(self.position, closest.position) };
    }
  }

  // Move toward target, with cohesion pull toward team center
  const toTarget = dir(self.position, target.position);
  const toCenter = dir(self.position, center);
  const distToCenter = d(self.position, center);

  // Stronger pull toward center when far from team
  const cohesion = distToCenter > 400 ? 0.5 : distToCenter > 250 ? 0.2 : 0.1;
  const pursuit = 1.0 - cohesion;

  return {
    type: 'move',
    direction: {
      x: toTarget.x * pursuit + toCenter.x * cohesion,
      y: toTarget.y * pursuit + toCenter.y * cohesion,
    },
  };
}
