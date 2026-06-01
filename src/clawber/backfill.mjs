// backfill.mjs — EPIC-1 runner. Parse every replay in match-history, compute
// metrics + death features, emit the offload dataset. Deterministic; no API calls.
// Run: node src/clawber/backfill.mjs
import fs from 'fs';
import { walkJson, loadReplay } from './parse.mjs';
import { combatMetrics } from './metrics/combat.mjs';
import { spatialMetrics } from './metrics/spatial.mjs';
import { macroMetrics } from './metrics/macro.mjs';
import { opponentMetrics } from './metrics/opponent.mjs';
import { classifyDeaths } from './mining/deaths.mjs';
import { buildRegistry } from './registry.mjs';
import { jsonlWriter } from './offload.mjs';

const ROOT = 'match-history', OUT = 'data';
fs.mkdirSync(OUT, { recursive: true });

const reg = buildRegistry(ROOT);
const mW = jsonlWriter(`${OUT}/matches.jsonl`);
const xW = jsonlWriter(`${OUT}/metrics.jsonl`);
// NB: no per-tick store. The raw replays in match-history/ ARE the tick-level cold
// store (full fidelity); analyses recompute from them via parse.mjs. A derived
// ticks.jsonl was redundant + write-only (45MB, nothing read it). If a real
// tick-level SQL workload ever appears, generate parquet then — not JSONL here.

let n = 0, cc = 0, skipped = 0; const seen = new Set();
for (const f of walkJson(ROOT)) {
  const m = loadReplay(f);
  if (!m || m.won == null) { skipped++; continue; }
  if (m.matchId && seen.has(m.matchId)) continue;
  if (m.matchId) seen.add(m.matchId);
  n++; if (m.vsCC) cc++;

  const cm = combatMetrics(m), sm = spatialMetrics(m), mm = macroMetrics(m), om = opponentMetrics(m), dd = classifyDeaths(m);
  const meta = reg[m.matchId] || {};
  // opponent identity: prefer registry (match-result JSON), fall back to replay-derived
  const oppId = meta.opponent_agent_id ?? m.opponentAgentId ?? null;
  const oppName = meta.opponent_name ?? m.opponentName ?? null;
  mW.write({
    match_id: m.matchId, map_id: m.mapId, started_at: m.startedAt, won: m.won, vs_cc: m.vsCC,
    bot_version: meta.bot_version ?? null, opponent_agent_id: oppId, opponent_name: oppName,
    duration_ticks: m.durationTicks, deaths: dd.deaths, death_features: dd.features,
  });
  xW.write({ match_id: m.matchId, won: m.won, vs_cc: m.vsCC, started_at: m.startedAt,
    opponent_agent_id: oppId, opponent_name: oppName, bot_version: meta.bot_version ?? null,
    ...cm, ...sm, ...mm, ...om });
}
mW.close(); xW.close();
console.log(`backfill complete: ${n} matches (${cc} vs_cc), ${skipped} unparseable/skipped.`);
console.log(`  → data/matches.jsonl (${mW.count}), data/metrics.jsonl (${xW.count})`);
console.log(`  (tick-level data lives in the raw replays under match-history/ — recompute on demand.)`);
