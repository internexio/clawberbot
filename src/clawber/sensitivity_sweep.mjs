// sensitivity_sweep.mjs — perturb each tunable constant in v60 and measure, over the CC corpus,
// how much the bot's DECISIONS change (counterfactual divergence vs unmodified v60). A knob with
// ~0% divergence is DEAD (tuning it can't help anything). A live knob is a candidate — but per this
// session the behavior dims it controls are CC non-discriminators, so live != CC-useful (needs a
// live gate test). Also splits divergence by our W/L to hint whether the knob even acts differently
// in games we win vs lose. Game-rule constants (ATK/ABL ranges, SPEED) are excluded — must match engine.
import fs from 'fs';
const OUR = '8f1e1fcf-7e3d-4a9c-90ee-1f0296746628';
const CC = 'ef7e1954-e275-4882-933b-a423946442f5';
const SRC = fs.readFileSync('bots/v60-last-ammo.js', 'utf8');
const load = s => new Function(s + '\n; return update;')();
const base = load(SRC);

// [label, exact source substring, perturbed substring]
const KNOBS = [
  ['HARD_SPREAD 200->150',  'const HARD_SPREAD = 200;', 'const HARD_SPREAD = 150;'],
  ['HARD_SPREAD 200->260',  'const HARD_SPREAD = 200;', 'const HARD_SPREAD = 260;'],
  ['SOFT_SPREAD 260->210',  'const SOFT_SPREAD = 260;', 'const SOFT_SPREAD = 210;'],
  ['SOFT_SPREAD 260->320',  'const SOFT_SPREAD = 260;', 'const SOFT_SPREAD = 320;'],
  ['CONVERGE_RADIUS 200->150','const CONVERGE_RADIUS = 200;','const CONVERGE_RADIUS = 150;'],
  ['CONVERGE_RADIUS 200->280','const CONVERGE_RADIUS = 200;','const CONVERGE_RADIUS = 280;'],
  ['RING_RADIUS 350->280',   'const RING_RADIUS = 350;', 'const RING_RADIUS = 280;'],
  ['RING_RADIUS 350->420',   'const RING_RADIUS = 350;', 'const RING_RADIUS = 420;'],
  ['ZONE_BUFFER_ENTER 180->120','const ZONE_BUFFER_ENTER = 180;','const ZONE_BUFFER_ENTER = 120;'],
  ['ZONE_BUFFER_ENTER 180->240','const ZONE_BUFFER_ENTER = 180;','const ZONE_BUFFER_ENTER = 240;'],
  ['ZONE_BUFFER_EXIT 100->60','const ZONE_BUFFER_EXIT = 100;','const ZONE_BUFFER_EXIT = 60;'],
  ['ZONE_BUFFER_EXIT 100->150','const ZONE_BUFFER_EXIT = 100;','const ZONE_BUFFER_EXIT = 150;'],
];

// gather CC matches with W/L (recursive — most CC replays live in subdirs)
import path from 'path';
function walk(d){const o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())o.push(...walk(p));else if(e.name.endsWith('.json'))o.push(p);}return o;}
const files = walk('match-history');
const seen = new Set();
const matchesW = [], matchesL = [];
for (const fp of files) {
  if (matchesW.length >= 60 && matchesL.length >= 60) break;
  let m; try { m = JSON.parse(fs.readFileSync(fp)); } catch { continue; }
  if (!m.frames || !m.bots || !m.winner) continue;
  const ag = {}; for (const b of m.bots) ag[b.id] = b.agentId;
  const set = new Set(Object.values(ag));
  if (!set.has(OUR) || !set.has(CC) || set.size !== 2) continue;
  if (m.matchId) { if (seen.has(m.matchId)) continue; seen.add(m.matchId); }
  const weWon = ag[m.winner] === OUR;
  const rec = { m, ours: m.bots.filter(b => b.agentId === OUR).map(b => b.id), weWon };
  if (weWon && matchesW.length < 60) matchesW.push(rec);
  else if (!weWon && matchesL.length < 60) matchesL.push(rec);
}
const matches = [...matchesW, ...matchesL];

function compare(variantFn) {
  let ticks = 0, div = 0, flip = 0, divWin = 0, divLose = 0, tWin = 0, tLose = 0;
  for (const { m, ours, weWon } of matches) {
    const ub = load(SRC), uv = variantFn();   // fresh state per match for both
    for (const fr of m.frames) for (const id of ours) {
      const self = fr.bots.find(b => b.id === id); if (!self || !self.alive) continue;
      const input = { selfId: id, teamBotIds: ours, botNumber: +(String(id).split(':')[1] || 0), tick: fr.tick, bots: fr.bots, zone: fr.zone, powerups: fr.powerups || [] };
      let a, b; try { a = ub(input); b = uv(input); } catch { continue; }
      ticks++; if (weWon) tWin++; else tLose++;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      div++; if (weWon) divWin++; else divLose++;
      if ((a && a.type) !== (b && b.type)) flip++;
    }
  }
  return { ticks, div, flip, divWin, divLose, tWin, tLose };
}

console.log(`\nsensitivity sweep over ${matches.length} CC matches (${matches.filter(x=>x.weWon).length}W/${matches.filter(x=>!x.weWon).length}L)\n`);
console.log('knob                          | divergent | type-flips | div-in-wins | div-in-losses | verdict');
console.log('-'.repeat(110));
for (const [label, from, to] of KNOBS) {
  if (!SRC.includes(from)) { console.log(`${label.padEnd(29)} | (source string not found - skip)`); continue; }
  const r = compare(() => load(SRC.split(from).join(to)));
  const dp = (100 * r.div / r.ticks);
  const fp = (100 * r.flip / r.ticks);
  const wp = (100 * r.divWin / r.tWin);
  const lp = (100 * r.divLose / r.tLose);
  const verdict = dp < 0.05 ? 'DEAD (inert)' : dp < 1 ? 'barely live' : 'LIVE';
  console.log(`${label.padEnd(29)} | ${dp.toFixed(3).padStart(8)}% | ${fp.toFixed(3).padStart(8)}% | ${wp.toFixed(3).padStart(9)}% | ${lp.toFixed(3).padStart(11)}% | ${verdict}`);
}
console.log('\nNote: divergence = behavior changed; it does NOT prove WR impact (CC responses not re-simulated).');
console.log('A knob acting ~equally in wins and losses has no W/L gradient to tune toward.');
