// registry.mjs — join key. Match-result JSONs carry participants[].botVersion
// (absent from the frame-replays). Build {matchId → version/opponent} for enrichment.
import fs from 'fs';
import { walkJson, OUR_AGENT } from './parse.mjs';

export function buildRegistry(root = 'match-history') {
  const reg = {};
  for (const f of walkJson(root)) {
    let d; try { d = JSON.parse(fs.readFileSync(f)); } catch { continue; }
    if (!Array.isArray(d.participants) || !d.matchId) continue;
    const us = d.participants.find(p => p.agentId === OUR_AGENT);
    const them = d.participants.find(p => p.agentId !== OUR_AGENT);
    reg[d.matchId] = {
      bot_version: (us && us.botVersion) ?? null,
      opponent_agent_id: (them && them.agentId) ?? null,
      opponent_name: (them && them.agentName) ?? null,
    };
  }
  return reg;
}
