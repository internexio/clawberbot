# Clawber Opponent Scouting & Online Adaptation

Third companion doc. Leverages targeted matchmaking (`opponentId`) for: (1) a controlled
regression harness, (2) offline opponent fingerprinting, (3) a live in-bot classifier that
picks a counter-strategy from the opening. Online and offline feature defs are kept
identical so archetypes align.

---

## 0. What targeted matchmaking gives you

| Capability | How | Caveat |
|---|---|---|
| **Controlled regression** | queue with fixed house-bot `opponentId`, measure win-rate per config | house bots have no ELO but stable behavior — ideal control |
| **Scouting** | queue N matches vs a target, capture those replays | you can only reliably capture matches you're IN, not their games vs others |
| **Live adaptation** | classify opponent in opening ~100 ticks, swap strategy overlay | bot can't see opponent name at runtime — must fingerprint behavior |

Fingerprints decay: valid only until the opponent resubmits. Re-scout periodically.

---

## 1. Pick the control opponent (house bots)

```javascript
// find stable house bots to use as fixed regression opponents
async function houseBots(api) {
  const { leaderboard } = await api("/api/v1/leaderboard?limit=100&houseBots=true");
  return leaderboard.filter(a => a.isHouseBot).map(a => ({ id: a.agentId, name: a.name }));
}

// find your nemesis from your own match history (highest loss rate)
async function nemeses(api, matchesJsonl) {
  const rows = matchesJsonl.split("\n").filter(Boolean).map(JSON.parse);
  const byOpp = {};
  for (const m of rows) {
    const o = m.opponent_id; if (!o) continue;
    (byOpp[o] ||= { n: 0, losses: 0, name: m.opponent_name })[`${m.won ? "n" : "losses"}`]++;
    byOpp[o].n++;
  }
  return Object.entries(byOpp)
    .map(([id, v]) => ({ id, name: v.name, n: v.n, lossRate: v.losses / v.n }))
    .filter(x => x.n >= 5).sort((a, b) => b.lossRate - a.lossRate);
}
```

---

## 2. Scouting driver — capture matches vs a target

```javascript
async function scout(api, opponentId, n, sleep) {
  const replays = [];
  for (let i = 0; i < n; i++) {
    let m;
    try { m = await api("/api/v1/match/queue", { method: "POST", body: JSON.stringify({ opponentId }) }); }
    catch (e) { console.error("queue failed", e.message); await sleep(13000); continue; }
    // poll to completion
    let res, tries = 0;
    do { res = await api(`/api/v1/match/${m.matchId}`); if (res.status !== "completed") await sleep(5000); }
    while (res.status !== "completed" && ++tries < 30);
    if (res.status === "completed" && res.replayUrl) {
      const raw = await (await fetch(res.replayUrl)).json();
      replays.push({ matchId: m.matchId, raw, result: res });
    }
    await sleep(13000); // respect 5/min queue limit
  }
  return replays;
}
```

---

## 3. Behavioral fingerprint (SHARED feature defs — used offline AND online)

These five features are computed the same way in the offline miner and the live classifier.
That alignment is what makes the archetypes transferable.

```javascript
// ---- canonical feature extractors. `frames` = parsed tick rows; `myIds`/`oppIds` = bot id sets ----
const FEAT = {
  // 1. aggression: how fast enemies close on us, early game (ticks 0-150)
  aggression(frames, myIds, oppIds) {
    const early = frames.filter(f => f.tick <= 150);
    let closing = 0, n = 0;
    for (const f of early) {
      const mine = f.bots.filter(b => myIds.has(b.id) && b.alive);
      const opp = f.bots.filter(b => oppIds.has(b.id) && b.alive);
      for (const e of opp) {
        const d = Math.min(...mine.map(m => Math.hypot(e.x - m.x, e.y - m.y)), Infinity);
        if (isFinite(d)) { closing += (1 / (1 + d / 256)); n++; } // closer = higher
      }
    }
    return n ? closing / n : 0; // ~0 distant, ~1 in-your-face
  },
  // 2. clustering: mean pairwise distance among enemy bots (tight = AoE-vulnerable)
  clustering(frames, myIds, oppIds) {
    const mid = frames.filter(f => f.tick > 150 && f.tick < 600);
    let sum = 0, n = 0;
    for (const f of mid) {
      const opp = f.bots.filter(b => oppIds.has(b.id) && b.alive);
      for (let i = 0; i < opp.length; i++) for (let j = i + 1; j < opp.length; j++) {
        sum += Math.hypot(opp[i].x - opp[j].x, opp[i].y - opp[j].y); n++;
      }
    }
    return n ? sum / n : 9999; // low = clustered
  },
  // 3. zone discipline: mean enemy distance-to-center / radius (low = center-camper)
  zoneDiscipline(frames, oppIds, zoneByTick) {
    let sum = 0, n = 0;
    for (const f of frames) {
      const z = zoneByTick[f.tick]; if (!z) continue;
      for (const e of f.bots.filter(b => oppIds.has(b.id) && b.alive)) {
        sum += Math.hypot(e.x - z.cx, e.y - z.cy) / z.radius; n++;
      }
    }
    return n ? sum / n : 1; // <0.5 center-camper, >0.9 edge-hugger
  },
  // 4. pickup greed: fraction of pickups enemies moved toward
  pickupGreed(frames, oppIds, pickups) {
    if (!pickups?.length) return 0;
    let chased = 0;
    for (const pu of pickups) {
      const win = frames.filter(f => f.tick >= pu.spawnTick && f.tick <= pu.expireTick);
      const moved = win.some((f, i) => i > 0 && f.bots.some(b => {
        const prev = win[i - 1].bots.find(p => p.id === b.id);
        return oppIds.has(b.id) && prev &&
          Math.hypot(b.x - pu.x, b.y - pu.y) < Math.hypot(prev.x - pu.x, prev.y - pu.y) - 5;
      }));
      if (moved) chased++;
    }
    return chased / pickups.length;
  },
  // 5. retreat: do they back off when low? (1 = never retreats, exploitable)
  noRetreat(frames, oppIds) {
    let lowAdvances = 0, lowTotal = 0;
    for (let i = 1; i < frames.length; i++) {
      for (const e of frames[i].bots.filter(b => oppIds.has(b.id) && b.alive && b.health < 30)) {
        const prev = frames[i - 1].bots.find(p => p.id === e.id); if (!prev) continue;
        lowTotal++;
        // advancing = got closer to nearest of my bots while low
        const mine = frames[i].bots.filter(b => !oppIds.has(b.id) && b.alive);
        const dNow = Math.min(...mine.map(m => Math.hypot(e.x - m.x, e.y - m.y)), Infinity);
        const dPrev = Math.min(...frames[i-1].bots.filter(b=>!oppIds.has(b.id)&&b.alive).map(m => Math.hypot(prev.x - m.x, prev.y - m.y)), Infinity);
        if (dNow < dPrev) lowAdvances++;
      }
    }
    return lowTotal ? lowAdvances / lowTotal : 0.5;
  },
};

function fingerprint(replays, myIds, oppIds) {
  const vecs = replays.map(r => {
    const frames = r.parsed; // parse first via parseReplay()
    return {
      aggression: FEAT.aggression(frames, myIds, oppIds),
      clustering: FEAT.clustering(frames, myIds, oppIds),
      zoneDiscipline: FEAT.zoneDiscipline(frames, oppIds, r.zoneByTick),
      pickupGreed: FEAT.pickupGreed(frames, oppIds, r.pickups),
      noRetreat: FEAT.noRetreat(frames, oppIds),
    };
  });
  // average across the N scouting matches
  const mean = (k) => vecs.reduce((s, v) => s + v[k], 0) / vecs.length;
  return { aggression: mean("aggression"), clustering: mean("clustering"),
    zoneDiscipline: mean("zoneDiscipline"), pickupGreed: mean("pickupGreed"),
    noRetreat: mean("noRetreat"), n: vecs.length, scouted_at: new Date().toISOString() };
}
```

---

## 4. Archetype classification (offline label + online detection)

```javascript
// thresholds: integer/coarse first, refine after they prove out (your tuning rule)
function classify(fp) {
  if (fp.aggression > 0.6) return "RUSHER";          // closes fast, early pressure
  if (fp.clustering < 300) return "CLUSTERED";        // tight formation -> AoE bait
  if (fp.zoneDiscipline < 0.5 && fp.aggression < 0.3) return "CAMPER"; // passive center
  if (fp.pickupGreed > 0.5) return "GREEDY";          // pickup-focused
  return "BALANCED";
}

// counter-overlays: parameter deltas applied on top of your tuned CFG baseline
const COUNTER = {
  RUSHER:    { TARGET_SELECTION: "lowest_hp", aggression: "kite_to_allies", ZONE_EDGE_BUFFER: 250, note: "kite toward allies, let them overextend, focus on arrival" },
  CLUSTERED: { ABILITY_MIN_TARGETS: 2, FORMATION_SPACING: 200, note: "max ability ROI vs their clump; keep own spacing to avoid their AoE" },
  CAMPER:    { aggression: "control_pickups", PICKUP_CHASE_MAX_TICKS: 8, note: "own the pickup economy, group-push with ability late" },
  GREEDY:    { aggression: "ambush_pickups", note: "deny/contest pickups, ambush at spawn points" },
  BALANCED:  { note: "your tuned baseline, no overlay" },
};
```

---

## 5. In-bot online classifier + strategy switch

Accumulate opening features in shared memory, classify once at tick ~120, commit with
hysteresis (no flip-flopping). Same FEAT logic, computed live and incrementally.

```javascript
const A = (globalThis.__A ||= { obs: { closing: 0, n: 0, clusterSum: 0, clusterN: 0 }, archetype: null });

function observeOpponent(input, self) {
  const teamIds = new Set(input.teamBotIds);
  const enemies = input.bots.filter(b => b.alive && !teamIds.has(b.id));
  const mine = input.bots.filter(b => b.alive && teamIds.has(b.id));
  // aggression accumulation (ticks <= 150)
  if (input.tick <= 150) {
    for (const e of enemies) {
      const d = Math.min(...mine.map(m => Math.hypot(e.position.x - m.position.x, e.position.y - m.position.y)), Infinity);
      if (isFinite(d)) { A.obs.closing += 1 / (1 + d / 256); A.obs.n++; }
    }
  }
  // clustering accumulation
  for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++) {
    A.obs.clusterSum += Math.hypot(enemies[i].position.x - enemies[j].position.x, enemies[i].position.y - enemies[j].position.y);
    A.obs.clusterN++;
  }
}

function activeArchetype(input) {
  if (A.archetype) return A.archetype;            // committed — hysteresis, never re-flip
  if (input.tick < 120) return "BALANCED";        // still observing, play baseline
  const fp = {
    aggression: A.obs.n ? A.obs.closing / A.obs.n : 0,
    clustering: A.obs.clusterN ? A.obs.clusterSum / A.obs.clusterN : 9999,
    zoneDiscipline: 1, pickupGreed: 0, noRetreat: 0.5, // not yet observable live; default
  };
  A.archetype = classify(fp);
  return A.archetype;
}

// in update(): const arch = activeArchetype(input); apply COUNTER[arch] over CFG, then run §3 combat logic
```

---

## 6. Closing the loop

1. **Scout** the top 3–5 leaderboard bots and your worst nemesis (§1–2).
2. **Fingerprint + label** each (§3–4). Store profiles; note `scouted_at` for staleness.
3. **Validate counters offline** — set the labeled bot as fixed `opponentId`, A/B your
   counter-overlay vs baseline using the §1 regression harness. Confirm the overlay
   actually lifts win-rate vs that archetype before shipping.
4. **Ship the online classifier** (§5) so the ladder bot self-selects the counter.
5. **Measure on the ladder** — does overall win-rate rise? Cross-check with the loss-mining
   lift report: `bad_trade` and `focused` deaths should drop against RUSHER/CLUSTERED
   opponents specifically.

The online classifier currently detects aggression and clustering live; zone discipline,
pickup greed, and retreat behavior need a few more ticks of accumulation to be reliable
mid-match. Add them to `observeOpponent` once the two-feature version proves it lifts ELO —
don't build all five detectors before the first two earn it.
