// parse.mjs — defensive replay parser → normalized per-match object.
// Deterministic. No LLM, no vision. Schema per docs/clawber/00_probe.md §4.
import fs from 'fs';

export const OUR_AGENT = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
export const CC_PREFIX = 'edae262d-b7e4-4dd0-a8d0-3f34cb7c0a90';

// Game constants (game-config.json, confirmed 2026-03-25)
export const C = { SPEED: 12, ATK_RANGE: 256, ABL_RANGE: 700, ABL_RADIUS: 150, ZONE_DPS: 3 };

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

// raw replay JSON → normalized match, or null if unusable.
export function parseReplay(raw) {
  const frames = raw.frames || raw.ticks || raw.states;
  const bots = raw.bots;
  if (!Array.isArray(frames) || !Array.isArray(bots) || !frames.length) return null;
  if (!frames[0].bots || !('position' in (frames[0].bots[0] || {}))) return null;

  const agentOf = {};
  for (const b of bots) agentOf[b.id] = b.agentId;
  const ourIds = new Set(bots.filter(b => b.agentId === OUR_AGENT).map(b => b.id));
  if (!ourIds.size) return null;
  const vsCC = bots.some(b => b.agentId !== OUR_AGENT &&
    typeof b.id === 'string' && b.id.indexOf(CC_PREFIX) === 0);
  // opponent identity (1v1 → one non-OUR agent) + readable name (strip " #N")
  const oppBot = bots.find(b => b.agentId !== OUR_AGENT);
  const opponentAgentId = oppBot ? oppBot.agentId : null;
  const opponentName = oppBot && oppBot.name ? String(oppBot.name).replace(/\s*#\d+\s*$/, '') : null;

  // winner is a botId string → won iff it is one of our bots.
  const w = raw.winner;
  const winnerBotId = typeof w === 'string' ? w : (w && (w.botId || w.id)) || null;
  const won = winnerBotId != null ? ourIds.has(winnerBotId)
    : (w && w.agentId ? w.agentId === OUR_AGENT : null);

  // ---- match-level event log (authoritative; supersedes health-delta inference) ----
  // Replay frames carry events[]: kill{killerId,victimId}, damage{attackerId,targetId,damage},
  // ability{botId,targetPosition}, powerup_collect{botId,powerupId}, zone_shrink.
  const EV = { kills: [], damage: [], abilities: [], collects: [] };
  const usOf = id => ourIds.has(id);

  const F = [];
  for (const fr of frames) {
    const z = fr.zone || {};
    const zcx = num(z.centerX, num(z.center && z.center.x, 1024));
    const zcy = num(z.centerY, num(z.center && z.center.y, 1024));
    const zr = num(z.radius, 1024);
    const fb = [];
    for (const b of (fr.bots || [])) {
      const pos = b.position || {};
      fb.push({
        id: b.id,
        x: num(pos.x, num(b.x)), y: num(pos.y, num(b.y)),
        health: num(b.health, num(b.hp)), ammo: (b.ammo == null ? null : num(b.ammo)),
        alive: b.alive !== false,
        us: ourIds.has(b.id),
      });
    }
    const pu = (fr.powerups || []).map(p => ({
      id: p.id, type: p.type,
      x: num(p.position && p.position.x, num(p.x)), y: num(p.position && p.position.y, num(p.y)),
      expiresAtTick: num(p.expiresAtTick, Infinity),
    }));
    const t = num(fr.tick, F.length);
    const fev = [];
    for (const e of (fr.events || [])) {
      if (e.type === 'kill') {
        const ev = { tick: t, killerId: e.killerId, victimId: e.victimId,
          killerUs: usOf(e.killerId), victimUs: usOf(e.victimId) };
        EV.kills.push(ev); fev.push({ type: 'kill', ...ev });
      } else if (e.type === 'damage') {
        const ev = { tick: t, attackerId: e.attackerId, targetId: e.targetId, damage: num(e.damage),
          attackerUs: usOf(e.attackerId), targetUs: usOf(e.targetId), zone: e.attackerId === 'zone' };
        EV.damage.push(ev); fev.push({ type: 'damage', ...ev });
      } else if (e.type === 'ability') {
        const ev = { tick: t, botId: e.botId, us: usOf(e.botId),
          tx: num(e.targetPosition && e.targetPosition.x), ty: num(e.targetPosition && e.targetPosition.y) };
        EV.abilities.push(ev); fev.push({ type: 'ability', ...ev });
      } else if (e.type === 'powerup_collect') {
        const who = e.botId || e.collectorId || e.collectedBy;
        const ev = { tick: t, botId: who, us: usOf(who), powerupId: e.powerupId || e.id, ptype: e.powerupType };
        EV.collects.push(ev); fev.push({ type: 'collect', ...ev });
      }
    }
    F.push({ tick: t, bots: fb, zone: { cx: zcx, cy: zcy, r: zr }, powerups: pu, events: fev });
  }
  F.sort((a, b) => a.tick - b.tick);
  const hasEvents = EV.kills.length + EV.damage.length + EV.abilities.length > 0;

  return {
    matchId: raw.matchId || null, mapId: raw.mapId || null,
    startedAt: raw.startedAt || null,
    durationTicks: F.length ? F[F.length - 1].tick : 0,
    won, vsCC, winnerBotId, opponentAgentId, opponentName, agentOf, ourIds,
    frames: F, events: EV, hasEvents,
  };
}

export function loadReplay(path) {
  try { return parseReplay(JSON.parse(fs.readFileSync(path))); }
  catch { return null; }
}

// walk a dir tree collecting *.json paths
export function walkJson(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) walkJson(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
