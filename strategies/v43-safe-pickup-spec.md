# v43 Safe-Pickup — Spec (DRAFT, queued behind v42 validation)

## Status
- **Hold until v42 (sv95) validates** in a real 1v1 over ~1 day of auto-ladder (confound avoidance — don't stack pickup changes).
- Origin: operator wants the bot to grab resources when needed, with two criteria: (1) available room to pick up, (2) doesn't put the bot in line of fire. Reviewed by kf-expert (2026-05-29).

## Core reframing (from kf-expert)
This is NOT "grab more pickups." Match data says pickups are not decisive with 5 ammo (CC wins with 0-1) and pack-phase changes regress WR. The honest design is: **grab safe, close health when wounded; never walk into fire for a pickup.** v43 = two conservative SAFETY FILTERS + a tightened trigger that makes pickup pursuit *rarer and safer*, firing mostly in mid/late attrition and small-pack remnants, ~never in the early full-HP pack phase.

**Asymmetry principle (drives every threshold):** a skipped pickup costs ≈0; a bot walking into AoE for a pickup = lost bot = first-death cascade = how we lose. Bias every gate toward NOT grabbing.

## Integration
Modify the EXISTING general pickup branch in place (do not add a competing branch — avoids double-divert, keeps diff isolated). The v42 1v1 branch (`allies==0 && enemies<=1`) runs above, untouched. v43 only affects `allies>=1` cases.

## WHEN (trigger — tighten from current loose HP<65/ammo<=2)
```
needHealth = self.health < 55
needAmmo   = ammo <= 1
doorstep   = pickup within 120u (200u if timeoutMeta) AND (self.health < 70 || ammo <= 2)
fire branch IF: needHealth || needAmmo || doorstep || timeoutMeta
```
Health weighted above ammo (health matters more). Drop "near pickup alone triggers regardless of need."

## HOW (per-pickup candidate filter)
```
// enemyCentroid = mean of living enemy positions; selfToEnemies = dist(self, enemyCentroid)
for each pickup p:
    if claimed by another ally: continue                          // existing
    if tick + dist(self,p)/SPEED + 6 > p.expiresAtTick: continue  // Gate A: reachable before expiry
    if dist(p, center) > zr - 80: continue                        // Gate A: in-zone w/ shrink margin (was zr-30)
    if obstDist(p) < 2: continue                                  // Gate A: clearance (not cornered)
    if min_e dist(enemy, p) < 300: continue                       // Gate B: blast-safe (2x blast radius)
    if dist(p, enemyCentroid) < selfToEnemies * 0.85: continue    // Gate B: no-advance toward enemy mass
    if (allies.length >= 1 && !timeoutMeta && dist(self,p) > 300): continue  // pack leash: cheap grabs only
    // most-wounded cap (anti double-divert):
    metric = (p.type=='health') ? self.health : ammo
    if any ally within 250u of p has lower metric than me: continue
    score:  health(need): 100 - d*0.3 (+50 if HP<35)
            ammo(need):    60 - d*0.3 (+60 if ammo==0)
            health(timeout): 150 - d*0.2
            -= dist(p,center)*0.1
move to best p via safeMove; free ability en route only if ammo>=2 && nearestDist<=ABL_RANGE && alliesInBlast(lead)<=1
```

## Gate definitions
- **Gate A "room":** reachable before expiry; inside `zr - 80` (zone shrinks ~1u/tick — must not arrive as the edge passes us, being caught outside negates the heal at 3HP/tick); `obstDist(p) >= 2` tiles clearance (not wedged in a corner with no retreat).
- **Gate B "line of fire":** `min enemy dist to pickup >= 300` (2x the 150u blast radius — 150u = guaranteed hit, 150-300u = step-and-cast catchable); pickup not deeper into enemy territory than we are (`>= selfToEnemies * 0.85`) — this single check defeats bait pickups and prevents walking into the pack.
- NOT modeling enemy lead/velocity explicitly — 300u buffer absorbs it; a velocity model is a misfire surface.

## Deliberately does NOT
- Fire in early full-HP pack phase (no bot meets need thresholds).
- Move toward enemy mass for a pickup (no-advance gate).
- Traverse the map mid-pack (300u leash).
- Redirect ability aim (stays nearestEnemy) or add zone-center movement pull (proven dead end).
- Let >1 bot per cluster divert (most-wounded cap + existing claims).
- Touch the v42 1v1 branch.

## Biggest regression risk + containment
Diverting bot gets isolated → focus-fired → first-death cascade (our #1 loss mode). Contained by: short diverts (300u leash ≤25 ticks), away-from-threat only (no-advance + 300u blast-safe), one bot max (most-wounded cap), conservative thresholds from the skip-is-free/bad-grab-is-fatal asymmetry. Inert >90% of ticks.

## Rollout protocol
1. Build only after v42 (sv95) confirms (≥95% non-CC, CC h2h ≥ v41, validated in a real 1v1 replay).
2. kf-critic pre-submit (focus: most-wounded cap + no-advance gate — the two least-trivial computations).
3. Gate: 10 matches abort<6W, then 20 more, ≥95% non-CC, verify via check-results.py.
4. **Instrument divert events:** count branch fires + whether any divert preceded a death. If diverts correlate with deaths, gates are too loose — tighten 300u/leash before abandoning the concept.

## Fallbacks
v42 sv95 → v41 sv94 → v40 sv93.
