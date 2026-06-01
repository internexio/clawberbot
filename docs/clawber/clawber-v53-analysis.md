# Clawber v53 — external-agent analysis (archived 2026-06-01) + reconciliation

Authoritative input for the v54+ iteration brief. Full original pasted into the session;
this archive keeps the actionable engineering content + this session's reconciliation.

## §0 ground-truth — RECONCILED (all confirmed; do NOT re-verify)
| Quantity | Confirmed value | source |
|---|---|---|
| zone center | (1024,1024) | frame.zone + brief |
| tileSize / NAV scale | ≈32 (NAV_CW=32 × 64 = 2048) | occupancy grid + brief |
| self.ammo | present, max 5, −1/shot | frame bots + brief |
| ability | blast 150, cast 700, 30cd | gameConfig + brief |
→ **AF-5 RESOLVED** (ammo live, don't strip). **AF-2 RESOLVED** (tileSize 32 → navDrift samples whole map; doc's 128 stale).

## §1 ERA — live adversarial findings (the ones still actionable)
- **AF-1 (Sev2): dual pickup systems, divergent gates.** `pickupGravity` (enemy-veto 220) and the scored detour block (veto 300) both read/write `_s.pickupClaims` with different contest + need thresholds → inconsistent commitment, wasted partial detours. **Fix = §2 unified valuation** (= brief B1).
- **AF-3 (Sev2): centralized targetLock ignores per-bot geometry.** One lock for 5 bots maximizes focus (good) but a far non-leader chases the locked target across open ground until the 17-tick lock expires. **Fix:** a non-leader may hit a *closer* enemy already within ATK_RANGE while still counting toward the locked target's focus (prefer locked; if it's >ATK_RANGE and another enemy is in melee range, hit the in-range one).
- AF-4 (Sev3): `pickupClaims` cleanup is one-shot per tick → order-dependent across the 5 instances; self-corrects next tick. Low impact; optionally make liveness-checked at read time.

## §2 unified pickup valuation (brief B1) — replaces both systems
Root cause of poor pickup pickup: **static-distance contest veto**. Collection is "closest bot within 48u wins" → the gate must be a **TIME RACE**, not a fixed buffer. One `evaluatePickup()` returns `{target, commit}` (0 ignore / 1 bend / 2 detour):
- benefit = capped recoverable HP × urgency `(1 + 1.4·(1−hp/100))` for health; ammo only if `<4`; skip health if recoverable `<6` (no 55 dead band).
- reachability cliffs: can't reach before expiry (+4 margin); would be outside `zr−60` after shrink.
- **contest = time race:** `enemyTicks ≤ myTicks + 2` → contested; if contested & `hp<40` skip; else `contestPenalty 0.5`.
- ally hand-off: cede to a needier ally within 220u.
- `val = benefit·contestPenalty − myTicks·1.5`; commit=2 if `myTicks<8 && needed` else 1.
Wire: commit2 → safeMove to pickup (zone-edge blend); commit1 → feed as the `withGravity` bend vector. **Delete the 220/300 vetoes.** A/B vs a fixed house bot; proxy = pickup-capture-rate (long sample).

## §3 combat findings
- **CF-1 (Sev2, brief A1): single-target ability fired inside melee range.** Fallback casts on nearest enemy whenever `nearestDist ≤ 700`, including `≤256` where attacking (15 dmg/30t) beats ability (10/30t). **Fix:** gate single-target fallback on `nearestDist > ATK_RANGE`; multi-hit (≥2) path unchanged at any range. Free DPS.
- **CF-2 (Sev2 novel, brief C1): no engage/retreat trade gate.** A 20–40 HP bot still chases a full-HP enemy (losing 1v1, ends at my_hp−their_hp). **Fix:** when no AoE multi-hit available and locally ~1v1, **engage iff `self.health > target.health`**, else retreat down the ally-rally vector; `finish` exception (target ≤10 HP in ATK_RANGE → take kill). Validate against `bad_trade` loss lift (highest variance).
- **CF-3 (brief A2): `abilityWorthIt(hits,dist) = hits≥2 OR dist>ATK_RANGE`** — CF-1 generalized into one predicate routing all ability gates.

## §4 innovation ranking (brief EPIC-D + extras)
1. **Online opponent adaptation** (highest edge — field is static bots): fingerprint opening ~120t (aggression=closing rate; clustering=mean pairwise enemy dist) → counter-overlay {RUSHER, CLUSTERED, CAMPER, BALANCED} w/ hysteresis. Offline-validate each overlay vs a fixed house bot first.
2. engage/retreat trade gate (CF-2). 3. contest-as-time-race pickups (§2). 4. predictive zone pre-positioning (camp the collapse point). 5. pickup denial when ahead. 6. kill-timing focus burst (2+ allies in ATK_RANGE → all-in). 7. last-stand high-health stall (`tick>1000 && killsUs≥killsThem` → hug center, bank timeout win).

## §5–6 (separate, non-blocking workstreams)
- **Branding:** set profile `model:"Claude Opus 4.8"`, `harness:"KnowledgeForge 7.2.1"` via `/claim` if unclaimed; if claimed, check `/api/openapi` for a profile-update route — do NOT re-register (forfeits ELO). Our profile is already claimed/locked → low priority, verify openapi first.
- **Sprite:** top-down north-facing shark, 1024×1024 8×8 grid, transparent (chroma-key from magenta), 6 states. Needs the VisionForge/FLUX pipeline (no image-gen in this session).

## Innovation/build priority (per brief)
0. §0 verify ✓done · 1. CF-1 (A1, ship first) · 2. §2 unified pickup (B1) · 3. CF-2 trade gate (C1) · 4. online adaptation (D1) · branding/sprite parallel. One change per botVersion.
