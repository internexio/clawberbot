#!/usr/bin/env python3
"""
KF-Debugger: Verify root causes of zone-stuck bot episodes.
Tests H1-H5 against actual replay data.
"""
import json, glob, math, os, sys
from collections import defaultdict

AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
REPLAY_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "match-history")

def load_replay(path):
    with open(path) as f:
        return json.load(f)

def get_our_bot_ids(data):
    """Get our bot IDs from top-level bots array using agentId."""
    our_ids = set()
    for b in data.get("bots", []):
        if b.get("agentId") == AGENT_ID:
            our_ids.add(b["id"])
    return our_ids

def dist(x1, y1, x2, y2):
    return math.hypot(x2 - x1, y2 - y1)

def angle_between(dx1, dy1, dx2, dy2):
    """Angle between two direction vectors in radians (0 = aligned, pi = opposite)"""
    mag1 = math.hypot(dx1, dy1)
    mag2 = math.hypot(dx2, dy2)
    if mag1 < 0.01 or mag2 < 0.01:
        return None
    dot = (dx1 * dx2 + dy1 * dy2) / (mag1 * mag2)
    dot = max(-1, min(1, dot))
    return math.acos(dot)

def find_stuck_episodes(frames, our_bots, min_ticks=10):
    """Find episodes where our bots are outside zone for min_ticks+ consecutive ticks."""
    episodes = []

    if not our_bots:
        return []

    # Track per-bot outside-zone streaks
    streaks = {bid: [] for bid in our_bots}

    for t, frame in enumerate(frames):
        zone = frame.get("zone", {})
        zx = zone.get("centerX", 1024)
        zy = zone.get("centerY", 1024)
        zr = zone.get("radius", 1024)

        bot_map = {b["id"]: b for b in frame.get("bots", []) if b.get("alive", False)}

        for bid in our_bots:
            bot = bot_map.get(bid)
            if not bot:
                # Dead — end any streak
                if streaks[bid] and len(streaks[bid]) >= min_ticks:
                    episodes.append(streaks[bid][:])
                streaks[bid] = []
                continue

            bx = bot["position"]["x"]
            by = bot["position"]["y"]
            d2c = dist(bx, by, zx, zy)
            ammo = bot.get("ammo", -1)

            if d2c > zr:
                streaks[bid].append({
                    "tick": t,
                    "bot_id": bid,
                    "x": bx, "y": by,
                    "zx": zx, "zy": zy, "zr": zr,
                    "dist_to_center": d2c,
                    "outside_by": d2c - zr,
                    "ammo": ammo,
                    "health": bot.get("health", 0),
                })
            else:
                if len(streaks[bid]) >= min_ticks:
                    episodes.append(streaks[bid][:])
                streaks[bid] = []

    # End-of-match streaks
    for bid in our_bots:
        if len(streaks[bid]) >= min_ticks:
            episodes.append(streaks[bid][:])

    return episodes

def analyze_episode(ep):
    """Per-tick analysis of a stuck episode."""
    ticks_data = []

    for i, tick_info in enumerate(ep):
        entry = {
            "tick": tick_info["tick"],
            "x": tick_info["x"],
            "y": tick_info["y"],
            "outside_by": tick_info["outside_by"],
            "ammo": tick_info["ammo"],
            "health": tick_info["health"],
            "zr": tick_info["zr"],
        }

        if i > 0:
            prev = ep[i - 1]
            dx = tick_info["x"] - prev["x"]
            dy = tick_info["y"] - prev["y"]
            entry["displacement"] = math.hypot(dx, dy)
            entry["move_dx"] = dx
            entry["move_dy"] = dy

            # Direction to zone center
            to_zone_dx = tick_info["zx"] - tick_info["x"]
            to_zone_dy = tick_info["zy"] - tick_info["y"]

            # Alignment: angle between movement and zone-center direction
            angle = angle_between(dx, dy, to_zone_dx, to_zone_dy)
            entry["zone_alignment"] = angle  # 0 = toward zone, pi = away

            # Is this move "toward zone"? (alignment < pi/3 = 60 degrees)
            entry["toward_zone"] = angle is not None and angle < math.pi / 3
            # Is this move "away from zone"? (alignment > 2*pi/3 = 120 degrees)
            entry["away_from_zone"] = angle is not None and angle > 2 * math.pi / 3
        else:
            entry["displacement"] = 0
            entry["move_dx"] = 0
            entry["move_dy"] = 0
            entry["zone_alignment"] = None
            entry["toward_zone"] = False
            entry["away_from_zone"] = False

        # Net displacement from episode start
        entry["net_disp"] = dist(tick_info["x"], tick_info["y"], ep[0]["x"], ep[0]["y"])

        ticks_data.append(entry)

    return ticks_data

def simulate_terrain_trapped(ticks_data):
    """
    Simulate the terrainTrapped flag using the same logic as v21 code.
    Returns per-tick: whether terrainTrapped would be TRUE or FALSE.
    """
    SPEED = 12
    disp_ring = []
    pos_ring = []
    results = []

    for i, td in enumerate(ticks_data):
        disp = td["displacement"]
        disp_ring.append(disp)
        if len(disp_ring) > 10:
            disp_ring.pop(0)

        pos_ring.append((td["x"], td["y"]))
        if len(pos_ring) > 25:
            pos_ring.pop(0)

        short_avg = sum(disp_ring[-5:]) / min(len(disp_ring), 5) if len(disp_ring) >= 5 else SPEED

        med_net = 999
        if len(pos_ring) >= 8:
            p8 = pos_ring[-8]
            med_net = dist(td["x"], td["y"], p8[0], p8[1])

        long_net = 999
        if len(pos_ring) >= 20:
            p20 = pos_ring[-20]
            long_net = dist(td["x"], td["y"], p20[0], p20[1])

        trapped = (
            (len(disp_ring) >= 5 and short_avg < 3) or
            (len(pos_ring) >= 8 and med_net < 24) or
            (len(pos_ring) >= 20 and long_net < 80 and short_avg > 5)
        )

        results.append({
            "tick": td["tick"],
            "trapped": trapped,
            "short_avg": short_avg,
            "med_net": med_net,
            "long_net": long_net,
            "which_condition": (
                "shortAvg<3" if (len(disp_ring) >= 5 and short_avg < 3) else
                "medNet<24" if (len(pos_ring) >= 8 and med_net < 24) else
                "longNet<80" if (len(pos_ring) >= 20 and long_net < 80 and short_avg > 5) else
                "none"
            )
        })

    return results

def detect_handler_oscillation(trap_results):
    """
    Detect H2: alternating TRUE/FALSE in terrainTrapped flag.
    Count transitions and measure run lengths.
    """
    transitions = 0
    run_lengths = []
    current_val = None
    current_run = 0

    for r in trap_results:
        if r["trapped"] != current_val:
            if current_val is not None:
                run_lengths.append((current_val, current_run))
                transitions += 1
            current_val = r["trapped"]
            current_run = 1
        else:
            current_run += 1

    if current_val is not None:
        run_lengths.append((current_val, current_run))

    return transitions, run_lengths

def check_pickup_preceding(frames, episode):
    """
    H5: Check if bot was moving toward a pickup in the 30 ticks before getting stuck.
    """
    start_tick = episode[0]["tick"]
    bot_id = episode[0]["bot_id"]

    # Look at 30 ticks before episode start
    pre_start = max(0, start_tick - 30)

    for t in range(pre_start, start_tick):
        if t >= len(frames):
            break
        frame = frames[t]
        powerups = frame.get("powerups", [])
        if not powerups:
            continue

        bot = None
        for b in frame.get("bots", []):
            if b["id"] == bot_id and b.get("alive", False):
                bot = b
                break
        if not bot:
            continue

        bx, by = bot["position"]["x"], bot["position"]["y"]

        for p in powerups:
            px, py = p["position"]["x"], p["position"]["y"]
            d = dist(bx, by, px, py)
            if d < 200:
                zone = frame.get("zone", {})
                zx = zone.get("centerX", 1024)
                zy = zone.get("centerY", 1024)
                zr = zone.get("radius", 1024)
                p_dist_zone = dist(px, py, zx, zy)
                return {
                    "found": True,
                    "tick": t,
                    "pickup_type": p.get("type", "?"),
                    "dist_to_pickup": d,
                    "pickup_dist_from_zone_center": p_dist_zone,
                    "pickup_outside_zone": p_dist_zone > zr,
                    "pickup_near_edge": p_dist_zone > zr - 60,
                }

    return {"found": False}


def main():
    # Load loss replays
    loss_files = sorted(glob.glob(os.path.join(REPLAY_DIR, "replay-loss-*.json")))
    print(f"Found {len(loss_files)} loss replay files")

    all_episodes = []
    all_episode_files = []

    for fpath in loss_files:
        try:
            data = load_replay(fpath)
            frames = data.get("frames", [])
            if len(frames) < 1000:  # Only timeout games (1200+ ticks)
                continue

            our_bots = get_our_bot_ids(data)
            if not our_bots:
                continue

            eps = find_stuck_episodes(frames, our_bots, min_ticks=10)
            for ep in eps:
                all_episodes.append(ep)
                all_episode_files.append((fpath, frames))
        except Exception as e:
            continue

    print(f"Found {len(all_episodes)} stuck episodes (10+ ticks outside zone)")
    print()

    if not all_episodes:
        print("No episodes found!")
        return

    # ===== H1: Detection delay =====
    print("=" * 70)
    print("H1: DETECTION DELAY — terrainTrapped needs 8+ ticks to activate")
    print("=" * 70)

    h1_displacements = []  # per-tick displacement during episodes
    h1_first_trap_tick = []  # tick offset when terrainTrapped first becomes TRUE
    h1_pre_trap_hp_loss = []  # HP lost before trap detection

    for ep in all_episodes:
        ticks_data = analyze_episode(ep)
        trap_results = simulate_terrain_trapped(ticks_data)

        for td in ticks_data[1:]:
            h1_displacements.append(td["displacement"])

        first_trap = None
        for i, tr in enumerate(trap_results):
            if tr["trapped"]:
                first_trap = i
                break

        if first_trap is not None:
            h1_first_trap_tick.append(first_trap)
            # HP lost = ticks before detection * 3 HP/tick
            h1_pre_trap_hp_loss.append(first_trap * 3)
        else:
            h1_first_trap_tick.append(len(trap_results))  # never detected
            h1_pre_trap_hp_loss.append(len(trap_results) * 3)

    print(f"\nPer-tick displacement during stuck episodes:")
    if h1_displacements:
        avg_disp = sum(h1_displacements) / len(h1_displacements)
        zero_disp = sum(1 for d in h1_displacements if d < 1)
        small_disp = sum(1 for d in h1_displacements if d < 3)
        medium_disp = sum(1 for d in h1_displacements if 3 <= d < 8)
        full_disp = sum(1 for d in h1_displacements if d >= 8)
        print(f"  Average: {avg_disp:.1f}u/tick")
        print(f"  <1u (frozen):     {zero_disp}/{len(h1_displacements)} ({100*zero_disp/len(h1_displacements):.0f}%)")
        print(f"  <3u (near-frozen): {small_disp}/{len(h1_displacements)} ({100*small_disp/len(h1_displacements):.0f}%)")
        print(f"  3-8u (slow):      {medium_disp}/{len(h1_displacements)} ({100*medium_disp/len(h1_displacements):.0f}%)")
        print(f"  >=8u (moving):    {full_disp}/{len(h1_displacements)} ({100*full_disp/len(h1_displacements):.0f}%)")

    print(f"\nTicks until terrainTrapped first activates:")
    if h1_first_trap_tick:
        avg_first = sum(h1_first_trap_tick) / len(h1_first_trap_tick)
        never_detected = sum(1 for t in h1_first_trap_tick if t >= 50)
        print(f"  Average: {avg_first:.1f} ticks")
        print(f"  Median: {sorted(h1_first_trap_tick)[len(h1_first_trap_tick)//2]} ticks")
        print(f"  Min: {min(h1_first_trap_tick)}, Max: {max(h1_first_trap_tick)}")
        print(f"  Never detected (50+): {never_detected}/{len(h1_first_trap_tick)} ({100*never_detected/len(h1_first_trap_tick):.0f}%)")
        print(f"  <=3 ticks: {sum(1 for t in h1_first_trap_tick if t <= 3)}")
        print(f"  4-8 ticks: {sum(1 for t in h1_first_trap_tick if 4 <= t <= 8)}")
        print(f"  9-20 ticks: {sum(1 for t in h1_first_trap_tick if 9 <= t <= 20)}")
        print(f"  21+ ticks: {sum(1 for t in h1_first_trap_tick if t >= 21)}")

    if h1_pre_trap_hp_loss:
        avg_hp = sum(h1_pre_trap_hp_loss) / len(h1_pre_trap_hp_loss)
        print(f"\nHP lost before detection: avg {avg_hp:.0f} HP")

    # Distribution of which condition fires first
    condition_counts = defaultdict(int)
    for ep in all_episodes:
        ticks_data = analyze_episode(ep)
        trap_results = simulate_terrain_trapped(ticks_data)
        for tr in trap_results:
            if tr["trapped"]:
                condition_counts[tr["which_condition"]] += 1
                break
    print(f"\nWhich condition detects first:")
    for cond, cnt in sorted(condition_counts.items(), key=lambda x: -x[1]):
        print(f"  {cond}: {cnt} episodes")

    # ===== H2: Handler oscillation =====
    print()
    print("=" * 70)
    print("H2: HANDLER OSCILLATION — terrainTrapped flips TRUE/FALSE")
    print("=" * 70)

    h2_transitions_per_ep = []
    h2_run_lengths_true = []
    h2_run_lengths_false = []
    h2_oscillating_episodes = 0

    for ep in all_episodes:
        ticks_data = analyze_episode(ep)
        trap_results = simulate_terrain_trapped(ticks_data)

        transitions, runs = detect_handler_oscillation(trap_results)
        h2_transitions_per_ep.append(transitions)

        for val, length in runs:
            if val:
                h2_run_lengths_true.append(length)
            else:
                h2_run_lengths_false.append(length)

        # "Oscillating" = 3+ transitions in the episode
        if transitions >= 3:
            h2_oscillating_episodes += 1

    print(f"\nterrainTrapped transitions per episode:")
    if h2_transitions_per_ep:
        print(f"  Average: {sum(h2_transitions_per_ep)/len(h2_transitions_per_ep):.1f}")
        print(f"  0 transitions: {sum(1 for t in h2_transitions_per_ep if t == 0)}")
        print(f"  1 transition: {sum(1 for t in h2_transitions_per_ep if t == 1)}")
        print(f"  2 transitions: {sum(1 for t in h2_transitions_per_ep if t == 2)}")
        print(f"  3+ transitions: {sum(1 for t in h2_transitions_per_ep if t >= 3)}")
        print(f"  5+ transitions: {sum(1 for t in h2_transitions_per_ep if t >= 5)}")

    print(f"\n  Episodes with oscillating flag (3+ transitions): {h2_oscillating_episodes}/{len(all_episodes)} ({100*h2_oscillating_episodes/len(all_episodes):.0f}%)")

    if h2_run_lengths_true:
        print(f"\n  TRUE run lengths (escape handler active):")
        print(f"    Average: {sum(h2_run_lengths_true)/len(h2_run_lengths_true):.1f} ticks")
        print(f"    Median: {sorted(h2_run_lengths_true)[len(h2_run_lengths_true)//2]} ticks")
        print(f"    1-3 ticks: {sum(1 for r in h2_run_lengths_true if r <= 3)} ({100*sum(1 for r in h2_run_lengths_true if r <= 3)/len(h2_run_lengths_true):.0f}%)")
        print(f"    4-8 ticks: {sum(1 for r in h2_run_lengths_true if 4 <= r <= 8)}")
        print(f"    9+ ticks: {sum(1 for r in h2_run_lengths_true if r >= 9)}")

    if h2_run_lengths_false:
        print(f"\n  FALSE run lengths (HARD ZONE / safeMove active):")
        print(f"    Average: {sum(h2_run_lengths_false)/len(h2_run_lengths_false):.1f} ticks")
        print(f"    Median: {sorted(h2_run_lengths_false)[len(h2_run_lengths_false)//2]} ticks")

    # ===== H3: Movement alignment with zone center =====
    print()
    print("=" * 70)
    print("H3: HARD ZONE safeMove causes oscillation near obstacles")
    print("=" * 70)

    h3_toward = 0
    h3_away = 0
    h3_sideways = 0
    h3_total = 0
    h3_reversals = 0  # Direction reversal (sign flip) between consecutive ticks

    for ep in all_episodes:
        ticks_data = analyze_episode(ep)
        prev_dx, prev_dy = None, None

        for td in ticks_data[1:]:
            if td["displacement"] < 1:
                continue  # Skip frozen ticks
            h3_total += 1
            if td["toward_zone"]:
                h3_toward += 1
            elif td["away_from_zone"]:
                h3_away += 1
            else:
                h3_sideways += 1

            # Check for direction reversal (dot product with previous move < 0)
            if prev_dx is not None and td["displacement"] > 1:
                dot = td["move_dx"] * prev_dx + td["move_dy"] * prev_dy
                if dot < 0:
                    h3_reversals += 1

            prev_dx = td["move_dx"]
            prev_dy = td["move_dy"]

    if h3_total > 0:
        print(f"\nMovement direction vs zone center (ticks with displacement > 1u):")
        print(f"  Toward zone (<60°):  {h3_toward}/{h3_total} ({100*h3_toward/h3_total:.0f}%)")
        print(f"  Sideways (60-120°):  {h3_sideways}/{h3_total} ({100*h3_sideways/h3_total:.0f}%)")
        print(f"  Away from zone (>120°): {h3_away}/{h3_total} ({100*h3_away/h3_total:.0f}%)")
        print(f"\n  Direction reversals: {h3_reversals}/{h3_total} ({100*h3_reversals/h3_total:.0f}%)")
        print(f"  (Reversal = dot product with previous move < 0, indicates oscillation)")

    # ===== H4: Ammo = 0 during stuck episodes =====
    print()
    print("=" * 70)
    print("H4: ZONE CEILING UNREACHABLE — stuck bots have ammo=0")
    print("=" * 70)

    h4_ammo_values = []
    h4_ammo0_episodes = 0
    h4_ammo0_ticks = 0
    h4_total_ticks = 0

    for ep in all_episodes:
        ep_all_zero = True
        for tick_info in ep:
            ammo = tick_info["ammo"]
            if ammo >= 0:  # -1 means not available in replay
                h4_ammo_values.append(ammo)
                h4_total_ticks += 1
                if ammo == 0:
                    h4_ammo0_ticks += 1
                else:
                    ep_all_zero = False
            else:
                ep_all_zero = False  # unknown

        if ep_all_zero and len(ep) > 0 and ep[0]["ammo"] >= 0:
            h4_ammo0_episodes += 1

    if h4_ammo_values:
        avg_ammo = sum(h4_ammo_values) / len(h4_ammo_values)
        print(f"\nAmmo during stuck episodes:")
        print(f"  Average ammo: {avg_ammo:.2f}")
        print(f"  Ticks with ammo=0: {h4_ammo0_ticks}/{h4_total_ticks} ({100*h4_ammo0_ticks/h4_total_ticks:.0f}%)")
        print(f"  Episodes entirely at ammo=0: {h4_ammo0_episodes}/{len(all_episodes)} ({100*h4_ammo0_episodes/len(all_episodes):.0f}%)")

        ammo_dist = defaultdict(int)
        for a in h4_ammo_values:
            ammo_dist[a] += 1
        print(f"  Ammo distribution:")
        for a in sorted(ammo_dist.keys()):
            print(f"    ammo={a}: {ammo_dist[a]} ticks ({100*ammo_dist[a]/len(h4_ammo_values):.0f}%)")
    else:
        print("  No ammo data available in replays")

    # ===== H5: Pickup dispatch preceding stuck episodes =====
    print()
    print("=" * 70)
    print("H5: PICKUP DISPATCH sends bots to zone edge before stuck")
    print("=" * 70)

    h5_pickup_before = 0
    h5_no_pickup = 0
    h5_pickup_near_edge = 0
    h5_checked = 0

    for i, ep in enumerate(all_episodes):
        fpath, frames = all_episode_files[i]
        result = check_pickup_preceding(frames, ep)
        h5_checked += 1

        if result["found"]:
            h5_pickup_before += 1
            if result.get("pickup_near_edge", False):
                h5_pickup_near_edge += 1
        else:
            h5_no_pickup += 1

    print(f"\nPickup proximity in 30 ticks before stuck episode:")
    print(f"  Pickup nearby before stuck: {h5_pickup_before}/{h5_checked} ({100*h5_pickup_before/h5_checked:.0f}%)")
    print(f"  Pickup near zone edge: {h5_pickup_near_edge}/{h5_checked} ({100*h5_pickup_near_edge/h5_checked:.0f}%)")
    print(f"  No pickup nearby: {h5_no_pickup}/{h5_checked} ({100*h5_no_pickup/h5_checked:.0f}%)")

    # ===== DETAILED EPISODE EXAMPLES =====
    print()
    print("=" * 70)
    print("DETAILED EXAMPLES: First 5 episodes tick-by-tick")
    print("=" * 70)

    for ep_idx, ep in enumerate(all_episodes[:5]):
        ticks_data = analyze_episode(ep)
        trap_results = simulate_terrain_trapped(ticks_data)

        print(f"\n--- Episode {ep_idx+1}: bot {ep[0]['bot_id'][-8:]}, "
              f"ticks {ep[0]['tick']}-{ep[-1]['tick']} ({len(ep)} ticks), "
              f"zone_r={ep[0]['zr']:.0f}-{ep[-1]['zr']:.0f} ---")

        print(f"  {'Tick':>5} {'Disp':>5} {'NetD':>5} {'OutBy':>5} {'Ammo':>4} "
              f"{'Trapped':>7} {'Cond':>12} {'Dir':>6} {'HP':>4}")

        for i, (td, tr) in enumerate(zip(ticks_data, trap_results)):
            if i == 0:
                disp_s = "  -  "
                dir_s = "  -   "
            else:
                disp_s = f"{td['displacement']:5.1f}"
                if td['toward_zone']:
                    dir_s = " ->Z  "
                elif td['away_from_zone']:
                    dir_s = " <-Z  "
                elif td['displacement'] < 1:
                    dir_s = " FROZ "
                else:
                    dir_s = " SIDE "

            print(f"  {td['tick']:5d} {disp_s} {td['net_disp']:5.1f} "
                  f"{td['outside_by']:5.1f} {td['ammo']:4d} "
                  f"{'TRUE' if tr['trapped'] else 'false':>7} "
                  f"{tr['which_condition']:>12} {dir_s} {td['health']:4.0f}")

    # ===== SUMMARY =====
    print()
    print("=" * 70)
    print("HYPOTHESIS VERIFICATION SUMMARY")
    print("=" * 70)

    if h1_first_trap_tick:
        avg_delay = sum(h1_first_trap_tick) / len(h1_first_trap_tick)
        med_delay = sorted(h1_first_trap_tick)[len(h1_first_trap_tick) // 2]
        print(f"\nH1 (Detection delay): {'CONFIRMED' if med_delay >= 5 else 'REFUTED'}")
        print(f"    Median detection delay: {med_delay} ticks → {med_delay * 3} HP zone damage before escape handler")

    if h2_transitions_per_ep:
        osc_pct = 100 * h2_oscillating_episodes / len(all_episodes) if all_episodes else 0
        print(f"\nH2 (Handler oscillation): {'CONFIRMED' if osc_pct > 30 else 'PARTIALLY' if osc_pct > 10 else 'REFUTED'}")
        print(f"    {osc_pct:.0f}% of episodes show flag oscillation (3+ transitions)")

    if h3_total > 0:
        rev_pct = 100 * h3_reversals / h3_total
        print(f"\nH3 (safeMove oscillation): {'CONFIRMED' if rev_pct > 25 else 'PARTIALLY' if rev_pct > 10 else 'REFUTED'}")
        print(f"    {rev_pct:.0f}% direction reversals — {h3_toward}/{h3_total} moves toward zone but bouncing")

    if h4_ammo_values:
        a0_pct = 100 * h4_ammo0_ticks / h4_total_ticks if h4_total_ticks else 0
        print(f"\nH4 (Zone ceiling unreachable): {'CONFIRMED' if a0_pct > 70 else 'PARTIALLY' if a0_pct > 40 else 'REFUTED'}")
        print(f"    {a0_pct:.0f}% of stuck ticks at ammo=0 — zone ceiling code never runs for these bots")

    if h5_checked > 0:
        p_pct = 100 * h5_pickup_before / h5_checked
        print(f"\nH5 (Pickup dispatch): {'CONFIRMED' if p_pct > 30 else 'PARTIALLY' if p_pct > 10 else 'REFUTED'}")
        print(f"    {p_pct:.0f}% of episodes preceded by pickup proximity")


if __name__ == "__main__":
    main()
