#!/usr/bin/env python3
"""
Replay Analyzer for Clawber.ai — Tactical breakdown of 4 losses
Downloads replay JSONs and produces detailed analysis.
"""

import json
import urllib.request
import math
import sys
from collections import defaultdict

# Our identifiers
OUR_BOT_ID = "9672bcf5-feba-4d7b-a360-828a9973c4fd"
OUR_AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

# Match data from match-history files
MATCHES = {
    "hbfreed-opus": {
        "match_id": "500ade90-556d-4430-b3be-6a9218cbb8d8",
        "replay_url": "https://clawber-replays-prod.s3.us-east-1.amazonaws.com/replays/match_1772063033346_94hs76.json",
        "enemy_bot_id": "66af2b8d-610e-4b23-94a7-42b527f2cf89",
        "enemy_agent": "dfe4a24a-3230-4142-b555-1df19bab19cc",
        "our_stats": {"kills": 0, "dmg": 95, "survival": 121},
        "enemy_stats": {"kills": 5, "dmg": 525, "survival": 122},
    },
    "ClaudeOpus": {
        "match_id": "02f74cb5-30b0-464e-88e1-56e11051a7e3",
        "replay_url": "https://clawber-replays-prod.s3.us-east-1.amazonaws.com/replays/match_1772062746512_3b3vnr.json",
        "enemy_bot_id": "83f79af2-3996-454f-ba57-6310283cbe1f",
        "enemy_agent": "578d226a-d392-416e-a331-ca88b1ba2ebb",
        "our_stats": {"kills": 1, "dmg": 235, "survival": 144},
        "enemy_stats": {"kills": 6, "dmg": 525, "survival": 145},
    },
    "CrabCrusher": {
        "match_id": "cf5ced50-a5c4-4cb7-ab8f-089ce2f03949",
        "replay_url": "https://clawber-replays-prod.s3.us-east-1.amazonaws.com/replays/match_1772062786486_8000p9.json",
        "enemy_bot_id": "932e7ecc-c28a-43ec-b7f8-bad9575abe37",
        "enemy_agent": "de7753af-bb5d-4971-afa3-c4ed3e115a9d",
        "our_stats": {"kills": 2, "dmg": 295, "survival": 206},
        "enemy_stats": {"kills": 5, "dmg": 545, "survival": 207},
    },
    "SpaceDust": {
        "match_id": "e77a78de-05e7-4fa7-bc35-b17f00d9a371",
        "replay_url": "https://clawber-replays-prod.s3.us-east-1.amazonaws.com/replays/match_1772062759823_1awxs5.json",
        "enemy_bot_id": "bf40fcc3-1a1b-4b9d-b6e2-eba0f4201e16",
        "enemy_agent": "0397744b-c9e9-4596-8756-32b07542192d",
        "our_stats": {"kills": 2, "dmg": 230, "survival": 229},
        "enemy_stats": {"kills": 5, "dmg": 585, "survival": 230},
    },
}


def dist(p1, p2):
    """Euclidean distance between two position dicts."""
    return math.hypot(p1["x"] - p2["x"], p1["y"] - p2["y"])


def download_replay(url, name):
    """Download and parse replay JSON."""
    print(f"  Downloading {name} replay...", end=" ", flush=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ClawberbotAnalyzer/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        print(f"OK ({len(data.get('ticks', data.get('frames', [])))} frames)")
        return data
    except Exception as e:
        print(f"FAILED: {e}")
        return None


def identify_teams(replay):
    """Figure out team assignments from replay data."""
    # Try different replay formats
    frames = replay.get("ticks", replay.get("frames", replay.get("states", [])))
    if not frames:
        return None, None, frames

    # Look at first frame to identify bots
    first_frame = frames[0]
    bots = first_frame.get("bots", first_frame.get("entities", []))

    our_bots = []
    enemy_bots = []

    for bot in bots:
        bot_id = bot.get("id", "")
        team = bot.get("team", bot.get("teamId", ""))
        agent_id = bot.get("agentId", bot.get("agent_id", ""))

        if agent_id == OUR_AGENT_ID or (hasattr(bot_id, 'startswith') and OUR_BOT_ID in str(bot.get("botId", ""))):
            our_bots.append(bot)
        else:
            enemy_bots.append(bot)

    # If agent ID matching didn't work, try team-based
    if not our_bots and not enemy_bots:
        teams = defaultdict(list)
        for bot in bots:
            teams[bot.get("team", bot.get("teamId", "unknown"))].append(bot)

        # Figure out which team is ours
        for team_id, team_bots in teams.items():
            for b in team_bots:
                if OUR_AGENT_ID in str(b) or OUR_BOT_ID in str(b):
                    our_bots = team_bots
                    break
            if our_bots:
                break

        for team_id, team_bots in teams.items():
            if team_bots != our_bots:
                enemy_bots = team_bots

    return our_bots, enemy_bots, frames


def analyze_replay(name, replay, match_info):
    """Comprehensive tactical analysis of a single replay."""
    result = {
        "name": name,
        "match_info": match_info,
    }

    if not replay:
        result["error"] = "Failed to download replay"
        return result

    # Dump keys for debugging structure
    result["replay_keys"] = list(replay.keys())

    frames = replay.get("ticks", replay.get("frames", replay.get("states", [])))
    if not frames:
        result["error"] = f"No frame data found. Keys: {list(replay.keys())}"
        return result

    result["total_frames"] = len(frames)

    # Identify teams from first frame
    first_frame = frames[0]
    bots_key = None
    for k in ["bots", "entities", "units"]:
        if k in first_frame:
            bots_key = k
            break

    if not bots_key:
        result["error"] = f"No bots key found. Frame keys: {list(first_frame.keys())}"
        # Try to understand the structure better
        result["first_frame_sample"] = {k: type(v).__name__ for k, v in first_frame.items()}
        if isinstance(first_frame, list):
            result["first_frame_sample"] = str(first_frame[0])[:500] if first_frame else "empty list"
        return result

    # Map bot IDs to teams
    all_bots_first = first_frame[bots_key]
    our_ids = set()
    enemy_ids = set()

    for bot in all_bots_first:
        bid = bot.get("id", "")
        agent = bot.get("agentId", bot.get("agent_id", bot.get("agent", "")))
        team = bot.get("team", bot.get("teamId", ""))

        if str(agent) == OUR_AGENT_ID:
            our_ids.add(bid)
        elif str(bot.get("botId", "")) == OUR_BOT_ID:
            our_ids.add(bid)

    # If we couldn't match by agent, try by team grouping
    if not our_ids:
        teams = defaultdict(set)
        for bot in all_bots_first:
            teams[bot.get("team", bot.get("teamId", 0))].add(bot["id"])

        # Try matching botId field
        for team_id, ids in teams.items():
            for bot in all_bots_first:
                if bot["id"] in ids and str(bot.get("botId", "")) == OUR_BOT_ID:
                    our_ids = ids
                    break
            if our_ids:
                break

    # All non-our bots are enemies
    all_ids = {bot["id"] for bot in all_bots_first}
    enemy_ids = all_ids - our_ids

    if not our_ids:
        result["error"] = f"Could not identify our team. Sample bot: {json.dumps(all_bots_first[0], indent=2)[:500]}"
        return result

    result["our_bot_ids"] = sorted(our_ids)
    result["enemy_bot_ids"] = sorted(enemy_ids)

    # ──────────────────────────────────────────────────
    # Per-frame analysis
    # ──────────────────────────────────────────────────

    # Track stats over time
    our_positions = defaultdict(list)       # bot_id -> [(tick, x, y)]
    enemy_positions = defaultdict(list)     # bot_id -> [(tick, x, y)]
    our_health = defaultdict(list)          # bot_id -> [(tick, hp)]
    enemy_health = defaultdict(list)        # bot_id -> [(tick, hp)]
    our_death_ticks = {}                    # bot_id -> tick
    enemy_death_ticks = {}                  # bot_id -> tick
    attack_events = []                      # (tick, attacker, target, type)
    ability_events = []                     # (tick, caster, x, y)

    # Track actions per frame
    our_actions = defaultdict(lambda: defaultdict(int))     # bot_id -> {action_type: count}
    enemy_actions = defaultdict(lambda: defaultdict(int))   # bot_id -> {action_type: count}

    # Movement tracking
    our_total_movement = defaultdict(float)
    enemy_total_movement = defaultdict(float)
    prev_positions = {}

    # Engagement tracking
    our_attack_targets = defaultdict(list)      # tick -> [target_ids attacked by our team]
    enemy_attack_targets = defaultdict(list)    # tick -> [target_ids attacked by enemy team]

    for frame_idx, frame in enumerate(frames):
        tick = frame.get("tick", frame.get("frame", frame_idx))
        bots = frame.get(bots_key, [])
        events = frame.get("events", frame.get("actions", []))

        # Bot positions and health
        for bot in bots:
            bid = bot["id"]
            pos = bot.get("position", bot.get("pos", {}))
            hp = bot.get("health", bot.get("hp", 0))
            alive = bot.get("alive", bot.get("isAlive", hp > 0))

            if not pos or ("x" not in pos and "y" not in pos):
                continue

            if bid in our_ids:
                our_positions[bid].append((tick, pos["x"], pos["y"]))
                our_health[bid].append((tick, hp))
                if not alive and bid not in our_death_ticks:
                    our_death_ticks[bid] = tick
            elif bid in enemy_ids:
                enemy_positions[bid].append((tick, pos["x"], pos["y"]))
                enemy_health[bid].append((tick, hp))
                if not alive and bid not in enemy_death_ticks:
                    enemy_death_ticks[bid] = tick

            # Track movement
            if bid in prev_positions:
                d = math.hypot(pos["x"] - prev_positions[bid]["x"],
                               pos["y"] - prev_positions[bid]["y"])
                if bid in our_ids:
                    our_total_movement[bid] += d
                else:
                    enemy_total_movement[bid] += d
            prev_positions[bid] = pos

        # Process actions/events
        if isinstance(events, list):
            for evt in events:
                if isinstance(evt, dict):
                    etype = evt.get("type", evt.get("action", ""))
                    actor = evt.get("botId", evt.get("actorId", evt.get("id", "")))
                    target = evt.get("targetId", evt.get("target", ""))

                    if actor in our_ids:
                        our_actions[actor][etype] += 1
                        if etype in ("attack", "melee"):
                            our_attack_targets[tick].append(target)
                    elif actor in enemy_ids:
                        enemy_actions[actor][etype] += 1
                        if etype in ("attack", "melee"):
                            enemy_attack_targets[tick].append(target)

                    if etype in ("attack", "melee"):
                        attack_events.append((tick, actor, target, "melee"))
                    elif etype in ("ability", "aoe"):
                        tp = evt.get("targetPosition", evt.get("position", {}))
                        ability_events.append((tick, actor, tp.get("x", 0), tp.get("y", 0)))

    # ──────────────────────────────────────────────────
    # Compute metrics
    # ──────────────────────────────────────────────────

    # 1. Kill sequence
    our_deaths_sorted = sorted(our_death_ticks.items(), key=lambda x: x[1])
    enemy_deaths_sorted = sorted(enemy_death_ticks.items(), key=lambda x: x[1])
    result["our_kill_sequence"] = [(bid[-8:], tick) for bid, tick in our_deaths_sorted]
    result["enemy_kill_sequence"] = [(bid[-8:], tick) for bid, tick in enemy_deaths_sorted]

    if our_deaths_sorted:
        result["first_blood_tick"] = min(
            our_deaths_sorted[0][1] if our_deaths_sorted else 9999,
            enemy_deaths_sorted[0][1] if enemy_deaths_sorted else 9999
        )
        result["our_first_death_tick"] = our_deaths_sorted[0][1]
        result["time_to_wipe"] = our_deaths_sorted[-1][1] - our_deaths_sorted[0][1] if len(our_deaths_sorted) > 1 else 0

    # 2. Focus fire analysis
    def compute_focus_fire(attack_targets_by_tick):
        """How concentrated are attacks on the same target per tick?"""
        focus_scores = []
        for tick, targets in attack_targets_by_tick.items():
            if len(targets) >= 2:
                from collections import Counter
                c = Counter(targets)
                most_common_count = c.most_common(1)[0][1]
                focus_scores.append(most_common_count / len(targets))
        return sum(focus_scores) / len(focus_scores) if focus_scores else 0

    result["our_focus_fire_score"] = round(compute_focus_fire(our_attack_targets), 3)
    result["enemy_focus_fire_score"] = round(compute_focus_fire(enemy_attack_targets), 3)

    # 3. Formation analysis (average inter-bot distance)
    def compute_avg_spread(positions_dict, death_ticks, all_ticks_range):
        """Average distance between alive team members over time."""
        spreads = []
        for tick in range(0, all_ticks_range, 5):  # Sample every 5 ticks
            alive_positions = []
            for bid, pos_list in positions_dict.items():
                if bid in death_ticks and death_ticks[bid] <= tick:
                    continue
                # Find position at this tick (nearest)
                closest = min(pos_list, key=lambda p: abs(p[0] - tick), default=None)
                if closest and abs(closest[0] - tick) < 3:
                    alive_positions.append((closest[1], closest[2]))

            if len(alive_positions) >= 2:
                dists = []
                for i in range(len(alive_positions)):
                    for j in range(i + 1, len(alive_positions)):
                        dists.append(math.hypot(
                            alive_positions[i][0] - alive_positions[j][0],
                            alive_positions[i][1] - alive_positions[j][1]
                        ))
                spreads.append(sum(dists) / len(dists))
        return sum(spreads) / len(spreads) if spreads else 0

    total_ticks = len(frames)
    result["our_avg_spread"] = round(compute_avg_spread(our_positions, our_death_ticks, total_ticks), 1)
    result["enemy_avg_spread"] = round(compute_avg_spread(enemy_positions, enemy_death_ticks, total_ticks), 1)

    # 4. Movement analysis
    our_avg_movement = sum(our_total_movement.values()) / max(len(our_total_movement), 1)
    enemy_avg_movement = sum(enemy_total_movement.values()) / max(len(enemy_total_movement), 1)
    result["our_avg_total_movement"] = round(our_avg_movement, 1)
    result["enemy_avg_total_movement"] = round(enemy_avg_movement, 1)

    # 5. Zone positioning
    def compute_zone_control(positions_dict, death_ticks, frames_data, bots_key_name):
        """Average distance from zone center over time."""
        zone_dists = []
        for frame in frames_data[::5]:  # Sample every 5 frames
            zone = frame.get("zone", {})
            if not zone:
                continue
            cx = zone.get("centerX", zone.get("center", {}).get("x", 1024))
            cy = zone.get("centerY", zone.get("center", {}).get("y", 1024))
            radius = zone.get("radius", 1024)
            tick = frame.get("tick", 0)

            bots = frame.get(bots_key_name, [])
            for bot in bots:
                bid = bot.get("id", "")
                if bid not in positions_dict:
                    continue
                if bid in death_ticks and death_ticks[bid] <= tick:
                    continue
                pos = bot.get("position", bot.get("pos", {}))
                if pos:
                    d = math.hypot(pos["x"] - cx, pos["y"] - cy)
                    zone_dists.append(d / max(radius, 1))  # Normalize by zone radius

        return sum(zone_dists) / len(zone_dists) if zone_dists else 0

    result["our_zone_distance_ratio"] = round(
        compute_zone_control(our_positions, our_death_ticks, frames, bots_key), 3)
    result["enemy_zone_distance_ratio"] = round(
        compute_zone_control(enemy_positions, enemy_death_ticks, frames, bots_key), 3)

    # 6. Ability usage
    our_abilities = sum(1 for _, actor, _, _ in ability_events if actor in our_ids)
    enemy_abilities = sum(1 for _, actor, _, _ in ability_events if actor in enemy_ids)
    our_melee = sum(1 for _, actor, _, _ in attack_events if actor in our_ids)
    enemy_melee = sum(1 for _, actor, _, _ in attack_events if actor in enemy_ids)
    result["our_ability_count"] = our_abilities
    result["enemy_ability_count"] = enemy_abilities
    result["our_melee_count"] = our_melee
    result["enemy_melee_count"] = enemy_melee

    # 7. Action breakdown by type
    our_action_totals = defaultdict(int)
    for bid, actions in our_actions.items():
        for act, count in actions.items():
            our_action_totals[act] += count

    enemy_action_totals = defaultdict(int)
    for bid, actions in enemy_actions.items():
        for act, count in actions.items():
            enemy_action_totals[act] += count

    result["our_action_breakdown"] = dict(our_action_totals)
    result["enemy_action_breakdown"] = dict(enemy_action_totals)

    # 8. Health over time (for damage rate analysis)
    def compute_damage_rate(health_dict, death_ticks):
        """How fast does this team lose health?"""
        total_damage_taken = 0
        last_tick = 0
        for bid, hp_list in health_dict.items():
            if len(hp_list) >= 2:
                initial_hp = hp_list[0][1]
                final_idx = -1
                # Find tick right before death or end
                final_hp = hp_list[final_idx][1]
                total_damage_taken += max(0, initial_hp - final_hp)
                last_tick = max(last_tick, hp_list[-1][0])
        return total_damage_taken, last_tick

    our_dmg_taken, our_last = compute_damage_rate(our_health, our_death_ticks)
    enemy_dmg_taken, enemy_last = compute_damage_rate(enemy_health, enemy_death_ticks)
    result["our_total_dmg_taken"] = our_dmg_taken
    result["enemy_total_dmg_taken"] = enemy_dmg_taken

    # 9. Kiting analysis: how often is enemy at edge of attack range vs in melee
    def kiting_analysis(attacker_positions, target_positions, attack_events_list, attacker_ids):
        """Analyze distances at which attacks happen."""
        attack_distances = []
        for tick, actor, target, atype in attack_events_list:
            if actor not in attacker_ids:
                continue
            if actor in attacker_positions and target in target_positions:
                actor_pos_list = attacker_positions[actor]
                target_pos_list = target_positions[target]

                actor_pos = min(actor_pos_list, key=lambda p: abs(p[0] - tick), default=None)
                target_pos = min(target_pos_list, key=lambda p: abs(p[0] - tick), default=None)

                if actor_pos and target_pos and abs(actor_pos[0] - tick) < 3 and abs(target_pos[0] - tick) < 3:
                    d = math.hypot(actor_pos[1] - target_pos[1], actor_pos[2] - target_pos[2])
                    attack_distances.append(d)

        if not attack_distances:
            return {"avg": 0, "min": 0, "max": 0, "count": 0}

        return {
            "avg": round(sum(attack_distances) / len(attack_distances), 1),
            "min": round(min(attack_distances), 1),
            "max": round(max(attack_distances), 1),
            "count": len(attack_distances),
        }

    all_positions = {**our_positions, **enemy_positions}
    result["enemy_attack_distances"] = kiting_analysis(
        enemy_positions, our_positions, attack_events, enemy_ids)
    result["our_attack_distances"] = kiting_analysis(
        our_positions, enemy_positions, attack_events, our_ids)

    # 10. Engagement timeline - when do teams first engage
    first_attack_tick = min((t for t, _, _, _ in attack_events), default=total_ticks)
    result["first_engagement_tick"] = first_attack_tick

    # 11. Chat messages (sometimes bots taunt)
    chat_messages = []
    for frame in frames:
        events = frame.get("events", frame.get("actions", []))
        if isinstance(events, list):
            for evt in events:
                if isinstance(evt, dict) and evt.get("type") == "chat":
                    chat_messages.append({
                        "tick": frame.get("tick", 0),
                        "bot": evt.get("botId", "")[-8:],
                        "msg": evt.get("message", evt.get("text", "")),
                        "team": "us" if evt.get("botId", "") in our_ids else "enemy"
                    })
    result["chat_messages"] = chat_messages[:20]  # Limit

    return result


def format_report(analyses):
    """Generate markdown report from analysis results."""
    lines = []
    lines.append("# Clawber.ai Replay Analysis — 4 Loss Breakdown")
    lines.append("")
    lines.append(f"**Analyzed:** {len(analyses)} matches")
    lines.append(f"**Our bot:** SEMalytics (v1-pack-tactics)")
    lines.append("")

    # ── Summary table ──
    lines.append("## Summary Overview")
    lines.append("")
    lines.append("| Opponent | Score | Our Kills | Our Dmg | Their Kills | Their Dmg | Duration |")
    lines.append("|----------|-------|-----------|---------|-------------|-----------|----------|")
    for a in analyses:
        mi = a["match_info"]
        duration = mi["our_stats"]["survival"]
        lines.append(f"| {a['name']} | 0-{mi['enemy_stats']['kills']} | {mi['our_stats']['kills']} | {mi['our_stats']['dmg']} | {mi['enemy_stats']['kills']} | {mi['enemy_stats']['dmg']} | {duration} ticks |")
    lines.append("")

    # ── Per-match deep dives ──
    for a in analyses:
        lines.append(f"---")
        lines.append(f"## {a['name']} (Match: {a['match_info']['match_id'][:12]}...)")
        lines.append("")

        if "error" in a:
            lines.append(f"**ERROR:** {a['error']}")
            if "first_frame_sample" in a:
                lines.append(f"**Frame structure:** `{a['first_frame_sample']}`")
            if "replay_keys" in a:
                lines.append(f"**Replay keys:** `{a['replay_keys']}`")
            lines.append("")
            continue

        lines.append(f"**Replay frames:** {a.get('total_frames', 'N/A')}")
        lines.append("")

        # Kill sequence
        lines.append("### Kill Sequence")
        if a.get("our_kill_sequence"):
            lines.append("**Our deaths (in order):**")
            for bid, tick in a["our_kill_sequence"]:
                lines.append(f"  - Bot `...{bid}` died at tick {tick}")
            if a.get("time_to_wipe"):
                lines.append(f"  - **Time from first to last death:** {a['time_to_wipe']} ticks ({a['time_to_wipe']/10:.1f}s)")
        else:
            lines.append("No death data found in events.")

        if a.get("enemy_kill_sequence"):
            lines.append("**Enemy deaths:**")
            for bid, tick in a["enemy_kill_sequence"]:
                lines.append(f"  - Bot `...{bid}` died at tick {tick}")
        else:
            lines.append("No enemy deaths.")
        lines.append("")

        # Focus fire
        lines.append("### Focus Fire Coordination")
        lines.append(f"- **Our focus fire score:** {a.get('our_focus_fire_score', 'N/A')} (1.0 = perfect focus)")
        lines.append(f"- **Enemy focus fire score:** {a.get('enemy_focus_fire_score', 'N/A')}")
        ff_diff = (a.get('enemy_focus_fire_score', 0) or 0) - (a.get('our_focus_fire_score', 0) or 0)
        if ff_diff > 0.1:
            lines.append(f"  - **Enemy has significantly better focus fire** (+{ff_diff:.2f})")
        lines.append("")

        # Formation / Spread
        lines.append("### Formation & Spread")
        lines.append(f"- **Our avg spread:** {a.get('our_avg_spread', 'N/A')} units")
        lines.append(f"- **Enemy avg spread:** {a.get('enemy_avg_spread', 'N/A')} units")
        our_s = a.get('our_avg_spread', 0) or 0
        enemy_s = a.get('enemy_avg_spread', 0) or 0
        if enemy_s > our_s * 1.3:
            lines.append(f"  - **Enemy plays more spread out** — may be baiting our pack")
        elif our_s > enemy_s * 1.3:
            lines.append(f"  - **We cluster more tightly** — vulnerable to AoE")
        lines.append("")

        # Movement
        lines.append("### Movement Patterns")
        lines.append(f"- **Our avg total movement:** {a.get('our_avg_total_movement', 'N/A')} units")
        lines.append(f"- **Enemy avg total movement:** {a.get('enemy_avg_total_movement', 'N/A')} units")
        our_m = a.get('our_avg_total_movement', 0) or 0
        enemy_m = a.get('enemy_avg_total_movement', 0) or 0
        if enemy_m > our_m * 1.2:
            lines.append(f"  - **Enemy moves significantly more** — likely kiting or repositioning")
        lines.append("")

        # Kiting
        lines.append("### Attack Distance Analysis (Kiting)")
        our_ad = a.get("our_attack_distances", {})
        enemy_ad = a.get("enemy_attack_distances", {})
        lines.append(f"- **Our attack distances:** avg={our_ad.get('avg', 0)}, range=[{our_ad.get('min', 0)}-{our_ad.get('max', 0)}], n={our_ad.get('count', 0)}")
        lines.append(f"- **Enemy attack distances:** avg={enemy_ad.get('avg', 0)}, range=[{enemy_ad.get('min', 0)}-{enemy_ad.get('max', 0)}], n={enemy_ad.get('count', 0)}")
        if enemy_ad.get('avg', 0) > 180:
            lines.append(f"  - **Enemy attacks from near max range** — evidence of kiting behavior")
        lines.append("")

        # Zone control
        lines.append("### Zone Positioning")
        lines.append(f"- **Our zone distance ratio:** {a.get('our_zone_distance_ratio', 'N/A')} (lower = closer to center)")
        lines.append(f"- **Enemy zone distance ratio:** {a.get('enemy_zone_distance_ratio', 'N/A')}")
        lines.append("")

        # Abilities
        lines.append("### Ability vs Melee Usage")
        lines.append(f"- **Our abilities:** {a.get('our_ability_count', 0)} | **Our melee:** {a.get('our_melee_count', 0)}")
        lines.append(f"- **Enemy abilities:** {a.get('enemy_ability_count', 0)} | **Enemy melee:** {a.get('enemy_melee_count', 0)}")
        if a.get('enemy_ability_count', 0) > a.get('our_ability_count', 0) * 2:
            lines.append(f"  - **Enemy uses abilities far more often** — AoE advantage")
        lines.append("")

        # Action breakdown
        lines.append("### Action Breakdown")
        lines.append(f"- **Our actions:** {dict(a.get('our_action_breakdown', {}))}")
        lines.append(f"- **Enemy actions:** {dict(a.get('enemy_action_breakdown', {}))}")
        lines.append("")

        # First engagement
        lines.append(f"### Engagement")
        lines.append(f"- **First engagement:** tick {a.get('first_engagement_tick', 'N/A')}")
        lines.append("")

        # Chat
        if a.get("chat_messages"):
            lines.append("### Chat Messages")
            for msg in a["chat_messages"]:
                lines.append(f"  - [{msg['team']}] tick {msg['tick']}: `{msg['msg']}`")
            lines.append("")

    # ── Cross-match patterns ──
    lines.append("---")
    lines.append("## Cross-Match Pattern Analysis")
    lines.append("")

    # Aggregate comparisons
    valid = [a for a in analyses if "error" not in a]

    if valid:
        avg_our_focus = sum(a.get("our_focus_fire_score", 0) or 0 for a in valid) / len(valid)
        avg_enemy_focus = sum(a.get("enemy_focus_fire_score", 0) or 0 for a in valid) / len(valid)
        avg_our_spread = sum(a.get("our_avg_spread", 0) or 0 for a in valid) / len(valid)
        avg_enemy_spread = sum(a.get("enemy_avg_spread", 0) or 0 for a in valid) / len(valid)
        avg_our_move = sum(a.get("our_avg_total_movement", 0) or 0 for a in valid) / len(valid)
        avg_enemy_move = sum(a.get("enemy_avg_total_movement", 0) or 0 for a in valid) / len(valid)

        lines.append("### Averaged Across All Losses")
        lines.append("")
        lines.append(f"| Metric | Us (SEMalytics) | Top Opponents | Verdict |")
        lines.append(f"|--------|-----------------|---------------|---------|")
        lines.append(f"| Focus Fire Score | {avg_our_focus:.3f} | {avg_enemy_focus:.3f} | {'ENEMY BETTER' if avg_enemy_focus > avg_our_focus + 0.05 else 'SIMILAR'} |")
        lines.append(f"| Avg Spread (units) | {avg_our_spread:.0f} | {avg_enemy_spread:.0f} | {'WE CLUSTER MORE' if avg_our_spread < avg_enemy_spread * 0.8 else 'SIMILAR'} |")
        lines.append(f"| Total Movement | {avg_our_move:.0f} | {avg_enemy_move:.0f} | {'ENEMY MOVES MORE' if avg_enemy_move > avg_our_move * 1.15 else 'SIMILAR'} |")
        lines.append("")

    # Key findings
    lines.append("### Key Tactical Findings")
    lines.append("")

    findings = []
    for a in valid:
        if (a.get("enemy_focus_fire_score", 0) or 0) > (a.get("our_focus_fire_score", 0) or 0) + 0.1:
            findings.append(f"- **{a['name']}** has better focus fire than us")
        if (a.get("enemy_avg_spread", 0) or 0) > (a.get("our_avg_spread", 0) or 0) * 1.3:
            findings.append(f"- **{a['name']}** plays more spread out (harder to AoE)")
        if (a.get("enemy_avg_total_movement", 0) or 0) > (a.get("our_avg_total_movement", 0) or 0) * 1.2:
            findings.append(f"- **{a['name']}** moves significantly more (possible kiting)")
        enemy_ad = a.get("enemy_attack_distances", {})
        if enemy_ad.get("avg", 0) > 175:
            findings.append(f"- **{a['name']}** attacks from near max range (avg {enemy_ad['avg']}u) — kiting confirmed")
        if (a.get("enemy_ability_count", 0) or 0) > (a.get("our_ability_count", 0) or 0) * 1.5:
            findings.append(f"- **{a['name']}** uses abilities much more effectively")

    if findings:
        for f in findings:
            lines.append(f)
    else:
        lines.append("- Analysis based on available event data; some replays may have limited action tracking")
    lines.append("")

    # Recommendations
    lines.append("### Strategic Recommendations for v2")
    lines.append("")
    lines.append("Based on replay analysis:")
    lines.append("")
    lines.append("1. **Implement kiting** — Attack from max range (190-200u), then back away. Top bots never stand still in melee.")
    lines.append("2. **Use abilities more aggressively** — Don't wait for 2+ enemies to cluster. Use AoE on single targets for 15 dmg vs 10 melee.")
    lines.append("3. **Better spread formation** — Our pack clusters too tight, making us vulnerable to AoE. Maintain 100-150u between bots.")
    lines.append("4. **Adaptive targeting** — Switch targets faster when focus target retreats or has allies nearby.")
    lines.append("5. **Terrain awareness** — Check if top bots use obstacles for cover during retreats.")
    lines.append("6. **Earlier ability usage** — Use abilities during approach phase, not just in melee range.")
    lines.append("7. **Retreat coordination** — When losing, retreat as a group toward zone center instead of fighting to the death.")
    lines.append("")

    return "\n".join(lines)


def main():
    print("=" * 60)
    print("Clawber.ai Replay Analyzer")
    print("=" * 60)
    print()

    # Download all replays
    replays = {}
    for name, info in MATCHES.items():
        replays[name] = download_replay(info["replay_url"], name)

    print()

    # First, let's dump the structure of the first replay to understand the format
    for name, replay in replays.items():
        if replay:
            print(f"--- {name} replay structure ---")
            print(f"  Top-level keys: {list(replay.keys())}")
            frames = replay.get("ticks", replay.get("frames", replay.get("states", [])))
            if frames:
                print(f"  Frame count: {len(frames)}")
                first = frames[0]
                print(f"  First frame keys: {list(first.keys())}")
                for k, v in first.items():
                    if isinstance(v, list) and len(v) > 0:
                        print(f"    {k}[0] keys: {list(v[0].keys()) if isinstance(v[0], dict) else type(v[0]).__name__}")
                        if isinstance(v[0], dict):
                            print(f"    {k}[0] sample: {json.dumps(v[0], indent=2)[:400]}")
                    elif isinstance(v, dict):
                        print(f"    {k}: {json.dumps(v, indent=2)[:200]}")
                    else:
                        print(f"    {k}: {v}")

                # Check for events
                if "events" in first:
                    print(f"  Events in first frame: {first['events']}")

                # Check a mid-game frame for events
                mid = frames[len(frames) // 2]
                if "events" in mid:
                    print(f"  Events in mid frame: {mid['events'][:3] if isinstance(mid['events'], list) else mid['events']}")
            else:
                print(f"  No frames found!")
            print()
            break  # Just check the first one

    # Analyze all replays
    print("Running analysis...")
    analyses = []
    for name, info in MATCHES.items():
        print(f"  Analyzing {name}...")
        result = analyze_replay(name, replays.get(name), info)
        analyses.append(result)

    # Generate report
    print()
    print("Generating report...")
    report = format_report(analyses)

    # Write report
    output_path = "/Users/dp/Scripts/clawberbot/strategies/replay-analysis-2026-02-25.md"
    with open(output_path, "w") as f:
        f.write(report)
    print(f"Report written to: {output_path}")

    # Also print to stdout
    print()
    print("=" * 60)
    print(report)


if __name__ == "__main__":
    main()
