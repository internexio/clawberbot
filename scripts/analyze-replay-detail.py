#!/usr/bin/env python3
"""Detailed replay analysis for CC-0308 match."""
import json
import sys
import math
from collections import defaultdict

REPLAY_PATH = sys.argv[1] if len(sys.argv) > 1 else "scouting/crabcrusher-0308/ladder-replays/L-vs-CrabCrusher-0308-0214-9YBX-d3e554ba.json"

with open(REPLAY_PATH) as f:
    data = json.load(f)

frames = data["frames"]
winner_prefix = data["winner"].split(":")[0]

# We lost, so identify us vs CC
prefixes = set()
for bot in frames[0]["bots"]:
    prefixes.add(bot["id"].split(":")[0])
prefixes = sorted(prefixes)

# Winner is CC (edae262d), we are the other
US = [p for p in prefixes if p != winner_prefix][0]
CC = winner_prefix
print(f"US: {US[:8]}...")
print(f"CC (winner): {CC[:8]}...")
print(f"Map: {data['mapId']}, Duration: {data['duration']} ticks")
print()

def is_ours(bot_id):
    return bot_id.split(":")[0] == US

def team_label(bot_id):
    return "US" if is_ours(bot_id) else "CC"

def dist(p1, p2):
    return math.sqrt((p1["x"]-p2["x"])**2 + (p1["y"]-p2["y"])**2)

def avg_pairwise(positions):
    if len(positions) < 2:
        return 0
    total = 0
    count = 0
    for i in range(len(positions)):
        for j in range(i+1, len(positions)):
            total += dist(positions[i], positions[j])
            count += 1
    return total / count

# ============================================================
# 1. Team HP every 20 ticks
# ============================================================
print("=" * 70)
print("1. TEAM HP EVERY 20 TICKS")
print("=" * 70)
print(f"{'Tick':>5} | {'US HP':>6} {'US Alive':>8} | {'CC HP':>6} {'CC Alive':>8} | {'Delta':>7} {'Leader':>7}")
print("-" * 70)

hp_history = []
for frame in frames:
    t = frame["tick"]
    if t % 20 != 0 and t != len(frames) - 1:
        continue
    us_hp = sum(b["health"] for b in frame["bots"] if is_ours(b["id"]))
    cc_hp = sum(b["health"] for b in frame["bots"] if not is_ours(b["id"]))
    us_alive = sum(1 for b in frame["bots"] if is_ours(b["id"]) and b["alive"])
    cc_alive = sum(1 for b in frame["bots"] if not is_ours(b["id"]) and b["alive"])
    delta = us_hp - cc_hp
    leader = "US" if delta > 0 else ("CC" if delta < 0 else "TIED")
    hp_history.append((t, us_hp, cc_hp, us_alive, cc_alive, delta))
    print(f"{t:>5} | {us_hp:>6} {us_alive:>8} | {cc_hp:>6} {cc_alive:>8} | {delta:>+7} {leader:>7}")

# ============================================================
# 2 & 3 & 4 & 5. Kills with context
# ============================================================
print()
print("=" * 70)
print("2-5. KILLS (with HP balance, zone radius, ammo)")
print("=" * 70)

# Collect all events by tick
events_by_tick = defaultdict(list)
for frame in frames:
    if frame.get("events"):
        for ev in frame["events"]:
            events_by_tick[frame["tick"]].append(ev)

# Track kills
kills = []
for frame in frames:
    if not frame.get("events"):
        continue
    for ev in frame["events"]:
        if ev["type"] == "kill":
            t = frame["tick"]
            killer = ev["killerId"]
            victim = ev["victimId"]

            # Find the damage event that caused this kill (same tick)
            action_type = "unknown"
            kill_dist = 0
            for ev2 in frame["events"]:
                if ev2["type"] == "damage" and ev2.get("attackerId") == killer and ev2.get("targetId") == victim:
                    # Check if there's an ability event for this attacker same tick
                    for ev3 in frame["events"]:
                        if ev3["type"] == "ability" and ev3["botId"] == killer:
                            action_type = "ability"
                            break
                    if action_type == "unknown":
                        action_type = "melee"

            # Get positions for distance
            killer_pos = None
            victim_pos = None
            for b in frame["bots"]:
                if b["id"] == killer:
                    killer_pos = b["position"]
                if b["id"] == victim:
                    victim_pos = b["position"]
            if killer_pos and victim_pos:
                kill_dist = dist(killer_pos, victim_pos)

            # Team HP at this tick
            us_hp = sum(b["health"] for b in frame["bots"] if is_ours(b["id"]))
            cc_hp = sum(b["health"] for b in frame["bots"] if not is_ours(b["id"]))
            us_alive = sum(1 for b in frame["bots"] if is_ours(b["id"]) and b["alive"])
            cc_alive = sum(1 for b in frame["bots"] if not is_ours(b["id"]) and b["alive"])

            # Zone radius
            zone_r = frame["zone"]["radius"]

            # Team ammo
            us_ammo = sum(b["ammo"] for b in frame["bots"] if is_ours(b["id"]))
            cc_ammo = sum(b["ammo"] for b in frame["bots"] if not is_ours(b["id"]))

            delta = us_hp - cc_hp
            leader = "US" if delta > 0 else "CC"

            kills.append({
                "tick": t,
                "killer": killer,
                "victim": victim,
                "killer_team": team_label(killer),
                "victim_team": team_label(victim),
                "action": action_type,
                "distance": kill_dist,
                "us_hp": us_hp, "cc_hp": cc_hp,
                "us_alive": us_alive, "cc_alive": cc_alive,
                "zone_r": zone_r,
                "us_ammo": us_ammo, "cc_ammo": cc_ammo,
                "delta": delta, "leader": leader
            })

print(f"\n{'#':>2} {'Tick':>4} | {'Killer':>12} {'Victim':>12} {'Action':>7} {'Dist':>6} | {'US HP':>6} {'CC HP':>6} {'Delta':>7} | {'Zone':>5} | {'US Ammo':>7} {'CC Ammo':>7}")
print("-" * 110)
for i, k in enumerate(kills):
    killer_short = f"{k['killer_team']}:{k['killer'].split(':')[1]}"
    victim_short = f"{k['victim_team']}:{k['victim'].split(':')[1]}"
    print(f"{i+1:>2} T{k['tick']:>3} | {killer_short:>12} {victim_short:>12} {k['action']:>7} {k['distance']:>6.0f} | {k['us_hp']:>6} {k['cc_hp']:>6} {k['delta']:>+7} | {k['zone_r']:>5.0f} | {k['us_ammo']:>7} {k['cc_ammo']:>7}")

# Kill summary
our_kills = sum(1 for k in kills if k["killer_team"] == "US")
cc_kills = sum(1 for k in kills if k["killer_team"] == "CC")
print(f"\nKill summary: US {our_kills}K, CC {cc_kills}K")

# ============================================================
# 6. Formation spread every 50 ticks
# ============================================================
print()
print("=" * 70)
print("6. FORMATION SPREAD (avg pairwise distance) EVERY 50 TICKS")
print("=" * 70)
print(f"{'Tick':>5} | {'US Spread':>10} {'US Alive':>8} | {'CC Spread':>10} {'CC Alive':>8}")
print("-" * 55)

for frame in frames:
    t = frame["tick"]
    if t % 50 != 0:
        continue
    us_pos = [b["position"] for b in frame["bots"] if is_ours(b["id"]) and b["alive"]
    ]
    cc_pos = [b["position"] for b in frame["bots"] if not is_ours(b["id"]) and b["alive"]]
    us_spread = avg_pairwise(us_pos)
    cc_spread = avg_pairwise(cc_pos)
    print(f"{t:>5} | {us_spread:>10.0f} {len(us_pos):>8} | {cc_spread:>10.0f} {len(cc_pos):>8}")

# ============================================================
# 7. Pickups
# ============================================================
print()
print("=" * 70)
print("7. PICKUPS COLLECTED")
print("=" * 70)

for frame in frames:
    if not frame.get("events"):
        continue
    for ev in frame["events"]:
        if ev["type"] == "powerup_collect":
            t = frame["tick"]
            bot = ev.get("botId", "?")
            ptype = ev.get("powerupType", ev.get("type", "?"))
            team = team_label(bot)
            print(f"  T{t}: {team}:{bot.split(':')[1]} collected {json.dumps(ev)}")

# Also count powerup spawns
spawns = 0
for frame in frames:
    if frame.get("events"):
        for ev in frame["events"]:
            if ev["type"] == "powerup_spawn":
                spawns += 1
print(f"\nTotal powerup spawns: {spawns}, collections: {sum(1 for f in frames for e in (f.get('events') or []) if e['type']=='powerup_collect')}")

# ============================================================
# 8. DAMAGE ANALYSIS - Spread vs Focus
# ============================================================
print()
print("=" * 70)
print("8. DAMAGE ANALYSIS - Spread vs Focus Fire")
print("=" * 70)

# Track damage dealt by each team to each target
us_dmg_to = defaultdict(int)  # victim_id -> total damage from us
cc_dmg_to = defaultdict(int)  # victim_id -> total damage from cc
us_total_dmg = 0
cc_total_dmg = 0
us_ability_count = 0
cc_ability_count = 0
us_melee_count = 0
cc_melee_count = 0

for frame in frames:
    if not frame.get("events"):
        continue
    ability_bots = set()
    for ev in frame["events"]:
        if ev["type"] == "ability":
            ability_bots.add(ev["botId"])
    for ev in frame["events"]:
        if ev["type"] == "damage":
            attacker = ev["attackerId"]
            target = ev["targetId"]
            dmg = ev["damage"]
            is_ability = attacker in ability_bots
            if is_ours(attacker):
                us_dmg_to[target] += dmg
                us_total_dmg += dmg
                if is_ability:
                    us_ability_count += 1
                else:
                    us_melee_count += 1
            else:
                cc_dmg_to[target] += dmg
                cc_total_dmg += dmg
                if is_ability:
                    cc_ability_count += 1
                else:
                    cc_melee_count += 1

print(f"\nTotal damage: US {us_total_dmg}, CC {cc_total_dmg}")
print(f"US hit count: {us_ability_count} ability, {us_melee_count} melee")
print(f"CC hit count: {cc_ability_count} ability, {cc_melee_count} melee")

print(f"\nUS damage distribution across CC bots:")
for target in sorted(us_dmg_to.keys()):
    if not is_ours(target):
        print(f"  CC:{target.split(':')[1]}: {us_dmg_to[target]} dmg")

print(f"\nCC damage distribution across US bots:")
for target in sorted(cc_dmg_to.keys()):
    if is_ours(target):
        print(f"  US:{target.split(':')[1]}: {cc_dmg_to[target]} dmg")

# ============================================================
# 9. AMMO WASTE ANALYSIS - unfired ammo while in range
# ============================================================
print()
print("=" * 70)
print("9. AMMO SUPPRESSION ANALYSIS")
print("=" * 70)

# For each tick, check if any of our alive bots had ammo>=2 and an enemy within 700u
# but did NOT fire ability
suppressed_ticks = 0
total_check_ticks = 0
suppressed_details = []

for frame in frames:
    t = frame["tick"]
    if not frame.get("events"):
        events = []
    else:
        events = frame["events"]

    # Who fired ability this tick?
    fired_ability = set()
    for ev in events:
        if ev["type"] == "ability":
            fired_ability.add(ev["botId"])

    our_alive = [b for b in frame["bots"] if is_ours(b["id"]) and b["alive"]]
    cc_alive = [b for b in frame["bots"] if not is_ours(b["id"]) and b["alive"]]

    if not cc_alive:
        continue

    for bot in our_alive:
        if bot["ammo"] >= 2 and bot["id"] not in fired_ability:
            # Check if any enemy within 700u
            min_enemy_dist = min(dist(bot["position"], e["position"]) for e in cc_alive)
            if min_enemy_dist <= 700:
                # Check cooldown - we can't tell from replay, but ability CD is 30 ticks
                # So just count opportunities
                total_check_ticks += 1
                suppressed_ticks += 1
                if t % 50 == 0:  # sample
                    suppressed_details.append((t, bot["id"], bot["ammo"], min_enemy_dist))

# How many abilities COULD have been fired (rough: every 30 ticks per bot)
print(f"Bot-ticks with ammo>=2 AND enemy within 700u but NO ability fired: {suppressed_ticks}")
print(f"(Note: many are on cooldown. Ability CD = 30 ticks)")

# Better metric: count ability fires per team
print(f"\nAbility fires: US {us_ability_count}, CC {cc_ability_count}")
print(f"Melee hits: US {us_melee_count}, CC {cc_melee_count}")

# Track ammo over time
print(f"\nAmmo remaining over time:")
print(f"{'Tick':>5} | {'US Ammo':>8} {'US Alive':>8} | {'CC Ammo':>8} {'CC Alive':>8}")
print("-" * 50)
for frame in frames:
    t = frame["tick"]
    if t % 50 != 0 and t != len(frames) - 1:
        continue
    us_ammo = sum(b["ammo"] for b in frame["bots"] if is_ours(b["id"]))
    cc_ammo = sum(b["ammo"] for b in frame["bots"] if not is_ours(b["id"]))
    us_alive = sum(1 for b in frame["bots"] if is_ours(b["id"]) and b["alive"])
    cc_alive = sum(1 for b in frame["bots"] if not is_ours(b["id"]) and b["alive"])
    print(f"{t:>5} | {us_ammo:>8} {us_alive:>8} | {cc_ammo:>8} {cc_alive:>8}")

# ============================================================
# 10. DAMAGE TIMELINE - who's hitting who each phase
# ============================================================
print()
print("=" * 70)
print("10. DAMAGE BY PHASE (every 50 ticks)")
print("=" * 70)

phase_dmg = defaultdict(lambda: {"us_dealt": 0, "cc_dealt": 0, "us_ability": 0, "cc_ability": 0})
for frame in frames:
    if not frame.get("events"):
        continue
    t = frame["tick"]
    phase = (t // 50) * 50
    ability_bots = set()
    for ev in frame["events"]:
        if ev["type"] == "ability":
            ability_bots.add(ev["botId"])
    for ev in frame["events"]:
        if ev["type"] == "damage":
            is_ab = ev["attackerId"] in ability_bots
            if is_ours(ev["attackerId"]):
                phase_dmg[phase]["us_dealt"] += ev["damage"]
                if is_ab:
                    phase_dmg[phase]["us_ability"] += 1
            else:
                phase_dmg[phase]["cc_dealt"] += ev["damage"]
                if is_ab:
                    phase_dmg[phase]["cc_ability"] += 1

print(f"{'Phase':>6} | {'US Dmg':>7} {'US Abl':>6} | {'CC Dmg':>7} {'CC Abl':>6} | {'Diff':>6}")
print("-" * 55)
for phase in sorted(phase_dmg.keys()):
    d = phase_dmg[phase]
    diff = d["us_dealt"] - d["cc_dealt"]
    print(f"T{phase:>4} | {d['us_dealt']:>7} {d['us_ability']:>6} | {d['cc_dealt']:>7} {d['cc_ability']:>6} | {diff:>+6}")

# ============================================================
# 11. ZONE DAMAGE ANALYSIS
# ============================================================
print()
print("=" * 70)
print("11. ZONE DAMAGE (bots outside zone)")
print("=" * 70)

us_zone_dmg = 0
cc_zone_dmg = 0
for frame in frames:
    t = frame["tick"]
    zx, zy, zr = frame["zone"]["centerX"], frame["zone"]["centerY"], frame["zone"]["radius"]
    for bot in frame["bots"]:
        if not bot["alive"]:
            continue
        d = math.sqrt((bot["position"]["x"] - zx)**2 + (bot["position"]["y"] - zy)**2)
        if d > zr:
            if is_ours(bot["id"]):
                us_zone_dmg += 3
            else:
                cc_zone_dmg += 3

print(f"Zone damage taken: US {us_zone_dmg}, CC {cc_zone_dmg}")

# ============================================================
# 12. MULTI-HIT ANALYSIS
# ============================================================
print()
print("=" * 70)
print("12. MULTI-HIT ABILITIES (AoE hitting 2+ targets)")
print("=" * 70)

us_multihit = 0
cc_multihit = 0
for frame in frames:
    if not frame.get("events"):
        continue
    # Group damage events by attacker this tick
    attacker_hits = defaultdict(list)
    ability_bots = set()
    for ev in frame["events"]:
        if ev["type"] == "ability":
            ability_bots.add(ev["botId"])
        if ev["type"] == "damage":
            attacker_hits[ev["attackerId"]].append(ev)

    for attacker, hits in attacker_hits.items():
        if attacker in ability_bots and len(hits) >= 2:
            if is_ours(attacker):
                us_multihit += 1
            else:
                cc_multihit += 1

print(f"Multi-hit abilities: US {us_multihit}, CC {cc_multihit}")

# ============================================================
# SUMMARY
# ============================================================
print()
print("=" * 70)
print("SUMMARY")
print("=" * 70)
print(f"Result: CC WINS at T{data['duration']}")
print(f"Total damage: US {us_total_dmg} vs CC {cc_total_dmg} (US {'MORE' if us_total_dmg > cc_total_dmg else 'LESS'})")
print(f"Kills: US {our_kills} vs CC {cc_kills}")
print(f"Ability fires: US {us_ability_count} vs CC {cc_ability_count}")
print(f"Melee hits: US {us_melee_count} vs CC {cc_melee_count}")
print(f"Multi-hit AoE: US {us_multihit} vs CC {cc_multihit}")
print(f"Zone damage: US {us_zone_dmg} vs CC {cc_zone_dmg}")

# Damage spread metric (coefficient of variation)
if us_dmg_to:
    cc_targets = [v for k, v in us_dmg_to.items() if not is_ours(k)]
    if cc_targets:
        mean_dmg = sum(cc_targets) / len(cc_targets)
        variance = sum((d - mean_dmg)**2 for d in cc_targets) / len(cc_targets)
        cv = math.sqrt(variance) / mean_dmg if mean_dmg > 0 else 0
        print(f"\nUS damage spread across CC bots: mean={mean_dmg:.0f}, stddev={math.sqrt(variance):.0f}, CV={cv:.2f}")
        print(f"  (Low CV = spread damage, High CV = focused fire)")

if cc_dmg_to:
    us_targets = [v for k, v in cc_dmg_to.items() if is_ours(k)]
    if us_targets:
        mean_dmg = sum(us_targets) / len(us_targets)
        variance = sum((d - mean_dmg)**2 for d in us_targets) / len(us_targets)
        cv = math.sqrt(variance) / mean_dmg if mean_dmg > 0 else 0
        print(f"CC damage spread across US bots: mean={mean_dmg:.0f}, stddev={math.sqrt(variance):.0f}, CV={cv:.2f}")
