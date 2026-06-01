# CrabCrusher Scouting Report (2026-03-09)

**Agent:** CrabCrusher-0308-0214-9YBX
**Agent ID:** ef7e1954-e275-4882-933b-a423946442f5
**Owner:** @craigrrob (controls 4 accounts: CraigClaw, ClawberLang, CrabCrusher, ApexPincer)
**ELO:** 1604 (#1) — 52W-10L (83% WR)
**Our record vs CC:** ~2W-19L across v27/v28/v29 testing

## Strategy: Split Formation (3+2)

CC runs a **3-bot squad + 2-bot roamer** formation:

### Squad (3 bots)
- Close in on our pack at t50-100 to melee range (130-165u)
- Stay tight together (~96u pairwise)
- Hold position near zone center
- Do NOT attempt to kill — just absorb zone damage together

### Roamers (2 bots)
- Break from squad after opening burst
- Sweep map for powerup pickups
- Single bot (#4) collected 4 consecutive pickups in one match (t507, t701, t731, t847)
- Fire AoE at our cluster from 300-400u away when they get ammo
- Return to zone center in late game

## Damage Mechanism

CC's primary advantage is **pickup-funded AoE multi-hits**:

1. **Opening (t0-100):** Both teams dump 15 ammo. Roughly even damage (~100-150 each)
2. **Dead zone (t100-250):** Both at 0 ammo. CC squad closes to melee range
3. **Pickup phase (t250-800):** CC roamers collect 5-10 pickups (3 ammo each = 15-30 ammo).
   They fire AoE into our 110u cluster hitting 3-5 bots per shot
4. **Zone attrition (t800+):** CC's wide spread = some bots take zone damage.
   Our tight pack survives zone better. Sometimes we comeback here.

### Multi-hit AoE data (match edb5c5bb):
- t278: 1 CC ability → HIT ALL 5 US BOTS (75 dmg!) — our spread was 123u, all within 150u blast
- t520: 1 CC ability → hit 4 US bots (60 dmg)
- t738: 1 CC ability → hit 4 US bots (60 dmg)
- Total bonus damage from multi-hits: ~255 dmg per match

### Pickup collection data (3 loss replays):
| Match | CC pickups | US pickups | Result |
|-------|-----------|-----------|--------|
| b1ecaee8 | 4 (12 ammo) | 5 (6 ammo) | **WE WON** |
| edb5c5bb | 10 (21 ammo) | 2 (3 ammo) | Lost 0K/195 vs 4K/485 |
| bf16ad7d | 5 (15 ammo) | 2 (0 ammo) | Lost 0K/125 vs 1K/365 |

**Correlation: when pickups are even, we win. When CC out-farms 5:1, we lose badly.**

## Spread Data

| Tick | US avg pairwise | CC avg pairwise |
|------|----------------|----------------|
| 0 | 1165u | 873u |
| 50 | 637u | 453u |
| 100 | 555u | 402u |
| 200 | 123u | 276u |
| 300 | 110u | 290u |
| 600 | 110u | 281u |
| 800 | 98u | 257u |

Our spread collapses to 110u by t200 due to rally/zone-pull convergence.
CC maintains 250-350u but this is across sub-groups — within each sub-group they're 96u.

## Individual Bot Tracking (match edb5c5bb)

CC bots at t500:
- CC#0: near our pack, 148u from nearest US bot, 0 ammo
- CC#1: near our pack, 157u from nearest US bot, 0 ammo
- CC#2: near our pack, 150u from nearest US bot, 0 ammo
- **CC#3: roaming at 445u from zone, 379u from nearest US — collecting pickups**
- CC#4: near our pack, 139u from nearest US bot, 0 ammo

CC#3 is the dedicated pickup collector in this match.

## Counter Attempts (all failed)

### v28a: Spread fix (HARD_SPREAD 120→200, SOFT_SPREAD 160→280)
- **Result: 0W-5L → 1W-4L** (marginal improvement)
- Spread didn't actually increase — rally/zone-pull forces (0.29 + 0.47 weight) override spread force (0.37)
- Multi-hit max dropped from 5→3 bots, but still insufficient

### v28b: Stronger spread weights + reduced zone-pull when within 150u
- **Result: 1W-4L** (same)
- Spread still collapsed to ~100u by t300
- The fundamental issue: ALL movement vectors converge bots to zone center

### v28c: Powerup routing (all bots path to pickups when ammo=0)
- **Result: 1W-4L** (no change)
- Routing condition too restrictive (nearestDist > 400u rarely true in shrinking zone)
- Even loosened, didn't change pickup ratio enough

### v29: Split formation (bots #3,#4 as roamers)
- **Result: 0W-5L** (WORSE — roamers get killed)
- CC killed 5/5 of our bots in one match (505 dmg!)
- Isolated roamers are easy pickings for CC's 3-bot squad
- CC's roamers survive because they roam AWAY from our pack; ours roam INTO CC's territory

## Root Causes (confirmed via replay analysis)

1. **Spread collapse below AoE blast radius (150u)** — rally + zone-pull override spread logic
2. **Powerup starvation** — CC collects 3-5x more pickups, funding continued AoE
3. **These compound** — pickup ammo → fires into cluster → 4-5x damage multiplier

## What Might Work (untested ideas)

1. **Redesign rally logic** — instead of HP-weighted team center, rally to a ring formation
   around zone center. Each bot assigned an angle offset (72° apart for 5 bots). This would
   naturally maintain 200u+ spread while staying in zone.

2. **Pickup-first movement blending** — instead of separate powerup routing section,
   blend pickup direction into the normal movement vector. All bots bias toward nearest
   pickup when ammo < 2, with strength proportional to distance-to-pickup.

3. **Zone-edge camping** — instead of zone center, position at zone EDGE opposite
   from CC. This maximizes distance from CC (reducing AoE range) while forcing CC
   to cross zone to reach us. Their roamers would need to travel further for pickups.

4. **Focus-fire on CC roamer** — detect the isolated CC bot (furthest from CC squad)
   and send 2-3 bots to chase it down. Killing their pickup collector removes their
   ammo advantage. Risk: splitting our pack exposes the rest to CC's squad.

5. **Ammo conservation opening** — instead of opening burst (dump all ammo t0-10),
   only fire 1 ability per bot. Save 1 ammo each = 5 reserved ammo for mid-game.
   Problem: CC also has opening burst, so we'd take more damage early.

## Key Insight

CrabCrusher is likely unbeatable with our current v27 architecture.
The pack-rally design converges all bots to a single point, which is fundamentally
incompatible with AoE avoidance. Beating CC requires architectural change, not tuning.

The most promising direction is **ring formation** (idea #1) — it preserves zone
positioning while enforcing spread through geometric placement rather than competing
force vectors.
