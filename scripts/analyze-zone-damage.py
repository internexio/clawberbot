#!/usr/bin/env python3
"""
Analyze zone damage patterns in Clawber.ai replays — wins vs losses.
"""

import json
import sys
import urllib.request
import os
import math

OUR_AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

LOSS_IDS = [
    # True losses only (API-verified: winnerId != our bot prefix)
    "43698907-3a4e-4fc1-8590-3699f79eb4a2",  # CFJBot--Opus46F-Velocity-Comet
    "d2c53990-76b4-4271-ae3e-7f7ecacec3dd",  # SpaceDust
    "a1eb4b5d-3e9b-4177-a563-a2bd6858c929",  # ClaudeOpus
    "5446d17f-328c-4b5d-8963-9ef93e905689",  # Steve
    "7ee4df3f-d498-4534-b1a1-56bd25acb82e",  # CFJBot--Opus45-Symphony-Nova
    "bdd1fc8a-2239-4be7-b06b-bf0b39cb5792",  # AhYan_Bird
    "6169da0c-758e-43b1-bff1-77eb7dde3e03",  # CFJBot--GPT52-Core-Spark
    "14cf17c0-c799-4683-aebc-e96fad36deaa",  # ClawMaster
    "edf3806f-3504-4e62-9d21-645da503fd35",  # CraigClaw_20260221_204714
]

WIN_IDS = [
    "d31d37c1-8b19-4e9d-b82c-0eeda0629156",
    "5c03fa08-af4e-44fd-80d8-9ebbc6e5816b",
    "09bbab7d-904f-4e3e-8dea-b0fd1c198b92",
    "b502f0d2-117b-4657-80ef-916a27a7cb14",
    "381eea13-a750-49c2-89f8-4514f37e3129",
    "8800b18c-a98c-485c-8fde-1343b70982e7",
    "420a88be-a635-4ffa-b68a-3c5926a3c6b9",
    "8621908d-606f-4fe1-8fed-b2b8c103b08e",
    "76c09d60-8491-4a6f-b96a-5489c22d9803",
    "2581b5b7-a8ba-496a-8334-cfa2dbdf3e31",
]

API_BASE = "https://clawber.ai/api/v1"


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def get_replay_url(match_id):
    d = fetch_json(f"{API_BASE}/match/{match_id}")
    return d.get("replayUrl"), d.get("status")


def analyze_replay(replay_data, match_id, outcome):
    """Analyze a replay JSON and return stats dict."""
    bots_meta = replay_data.get("bots", [])

    # Find our bot ID prefix
    our_prefix = None
    opp_prefix = None
    our_agent_name = None
    opp_agent_name = None

    our_agent_uuids = set()
    opp_agent_uuids = set()

    for bot in bots_meta:
        # bot["id"] is like "uuid:0" — extract the uuid part
        bot_full_id = bot["id"]  # e.g. "a313c1cd-...:0"
        if bot.get("agentId") == OUR_AGENT_ID:
            our_prefix = bot_full_id.rsplit(":", 1)[0]
            our_agent_name = bot.get("name", "SEMalytics").split(" #")[0]
        else:
            opp_prefix = bot_full_id.rsplit(":", 1)[0]
            opp_agent_name = bot.get("name", "opponent").split(" #")[0]

    if not our_prefix:
        print(f"  WARNING: could not find our agent in {match_id}")
        return None

    # Build set of our bot IDs (uuid:0 through uuid:4)
    our_ids = {f"{our_prefix}:{i}" for i in range(5)}
    opp_ids = {f"{opp_prefix}:{i}" for i in range(5)}

    frames = replay_data.get("frames", [])

    # Accumulators
    our_zone_dmg = 0
    opp_zone_dmg = 0
    our_combat_received = 0  # damage we received from opponent
    opp_combat_received = 0  # damage opponent received from us
    our_aoe_hits = 0         # AoE hits we dealt
    opp_aoe_hits = 0         # AoE hits they dealt
    aoe_multihits_vs_us = 0  # times one opponent AoE hit 2+ of our bots same tick
    aoe_multihits_by_us = 0  # times our AoE hit 2+ of their bots same tick

    kills_combat_us = 0      # we killed via combat
    kills_zone_us = 0        # we killed via zone (opponent bot died to zone)
    kills_combat_opp = 0
    kills_zone_opp = 0

    # Track abilities fired per tick to detect multi-hits
    # ability_events: tick -> list of (botId, targetPos)
    # damage_events per tick: attacker -> [targets]

    # For multi-hit detection, group damage by (tick, attackerId)
    tick_attacker_targets = {}  # (tick, attackerId) -> set of targetIds

    total_ticks = 0
    powerups_us = 0
    powerups_opp = 0

    for frame in frames:
        tick = frame.get("tick", 0)
        total_ticks = max(total_ticks, tick)
        events = frame.get("events", [])

        for ev in events:
            etype = ev.get("type")

            if etype == "damage":
                attacker = ev.get("attackerId", "")
                target = ev.get("targetId", "")
                dmg = ev.get("damage", 0)

                if attacker == "zone":
                    if target in our_ids:
                        our_zone_dmg += dmg
                    elif target in opp_ids:
                        opp_zone_dmg += dmg
                else:
                    # Combat damage
                    if target in our_ids and attacker in opp_ids:
                        our_combat_received += dmg
                        key = (tick, attacker)
                        if key not in tick_attacker_targets:
                            tick_attacker_targets[key] = set()
                        tick_attacker_targets[key].add(target)
                    elif target in opp_ids and attacker in our_ids:
                        opp_combat_received += dmg
                        key = (tick, attacker)
                        if key not in tick_attacker_targets:
                            tick_attacker_targets[key] = set()
                        tick_attacker_targets[key].add(target)

            elif etype == "kill":
                killer = ev.get("killerId", "")
                victim = ev.get("victimId", "")

                if victim in opp_ids:
                    if killer == "zone":
                        kills_zone_opp += 1
                    else:
                        kills_combat_us += 1
                elif victim in our_ids:
                    if killer == "zone":
                        kills_zone_us += 1
                    else:
                        kills_combat_opp += 1

            elif etype == "ability":
                bot_id = ev.get("botId", "")
                if bot_id in our_ids:
                    our_aoe_hits += 1
                elif bot_id in opp_ids:
                    opp_aoe_hits += 1

            elif etype == "powerup_collect":
                bot_id = ev.get("botId", "")
                if bot_id in our_ids:
                    powerups_us += 1
                elif bot_id in opp_ids:
                    powerups_opp += 1

    # Count multi-hits
    for (tick, attacker), targets in tick_attacker_targets.items():
        if len(targets) >= 2:
            if attacker in opp_ids:
                aoe_multihits_vs_us += 1
            elif attacker in our_ids:
                aoe_multihits_by_us += 1

    # Final HP totals from last frame
    our_final_hp = 0
    opp_final_hp = 0
    if frames:
        last_frame = frames[-1]
        for bot_state in last_frame.get("bots", []):
            bid = bot_state.get("id", "")
            hp = bot_state.get("health", 0)
            alive = bot_state.get("alive", False)
            if bid in our_ids and alive:
                our_final_hp += hp
            elif bid in opp_ids and alive:
                opp_final_hp += hp

    our_kills = kills_combat_us + kills_zone_opp
    opp_kills = kills_combat_opp + kills_zone_us

    # Determine how the match ended
    if total_ticks < 1190:
        if our_final_hp == 0 and opp_final_hp > 0:
            end_reason = "ELIM_LOSS"
        elif opp_final_hp == 0 and our_final_hp > 0:
            end_reason = "ELIM_WIN"
        else:
            end_reason = f"EARLY_END(t={total_ticks})"
    else:
        end_reason = "TIME_HP"

    return {
        "match_id": match_id[:8],
        "outcome": outcome,
        "opponent": opp_agent_name or "?",
        "ticks": total_ticks,
        "our_zone_dmg": our_zone_dmg,
        "opp_zone_dmg": opp_zone_dmg,
        "zone_dmg_diff": our_zone_dmg - opp_zone_dmg,
        "our_combat_rcvd": our_combat_received,
        "opp_combat_rcvd": opp_combat_received,
        "our_aoe_fired": our_aoe_hits,
        "opp_aoe_fired": opp_aoe_hits,
        "multihits_vs_us": aoe_multihits_vs_us,
        "multihits_by_us": aoe_multihits_by_us,
        "kills_we_got": our_kills,
        "kills_they_got": opp_kills,
        "kills_combat_us": kills_combat_us,
        "kills_zone_opp": kills_zone_opp,
        "kills_combat_opp": kills_combat_opp,
        "kills_zone_us": kills_zone_us,
        "our_final_hp": our_final_hp,
        "opp_final_hp": opp_final_hp,
        "powerups_us": powerups_us,
        "powerups_opp": powerups_opp,
        "end_reason": end_reason,
    }


def process_matches(match_ids, outcome_label):
    results = []
    for mid in match_ids:
        print(f"  Fetching {outcome_label} match {mid[:8]}...")
        try:
            replay_url, status = get_replay_url(mid)
            if not replay_url:
                print(f"    No replay URL (status={status})")
                continue
            print(f"    Downloading replay...")
            replay = fetch_json(replay_url)
            stats = analyze_replay(replay, mid, outcome_label)
            if stats:
                results.append(stats)
                print(f"    Done. Zone dmg us={stats['our_zone_dmg']} opp={stats['opp_zone_dmg']}, final HP us={stats['our_final_hp']} opp={stats['opp_final_hp']}")
        except Exception as e:
            print(f"    ERROR: {e}")
    return results


def print_table(all_results):
    wins = [r for r in all_results if r["outcome"] == "WIN"]
    losses = [r for r in all_results if r["outcome"] == "LOSS"]

    print("\n" + "="*100)
    print("ZONE DAMAGE ANALYSIS — WINS vs LOSSES")
    print("="*100)

    # Per-match detail table
    cols = ["Match", "Outcome", "Opponent", "Ticks", "OurZone", "OppZone", "ZoneDiff",
            "CombatRcvd", "CombatDealt", "MultiHitsVsUs", "MultiHitsByUs",
            "KillsUs", "KillsThem", "FinalHP_Us", "FinalHP_Opp", "Pickups_Us", "Pickups_Opp"]

    hdr = f"{'Match':<10} {'Out':<4} {'End':<12} {'Opponent':<28} {'Tks':>4} {'OurZn':>6} {'OppZn':>6} {'ZnDiff':>7} {'CbtRcv':>7} {'CbtDlt':>7} {'MH_vs':>6} {'MH_by':>6} {'KUs':>4} {'KTh':>4} {'HPUs':>6} {'HPOp':>6} {'PkUs':>5} {'PkOp':>5}"
    print(hdr)
    print("-"*len(hdr))

    for r in sorted(all_results, key=lambda x: x["outcome"]):
        print(f"{r['match_id']:<10} {r['outcome']:<4} {r['end_reason']:<12} {r['opponent'][:28]:<28} {r['ticks']:>4} "
              f"{r['our_zone_dmg']:>6} {r['opp_zone_dmg']:>6} {r['zone_dmg_diff']:>+7} "
              f"{r['our_combat_rcvd']:>7} {r['opp_combat_rcvd']:>7} "
              f"{r['multihits_vs_us']:>6} {r['multihits_by_us']:>6} "
              f"{r['kills_we_got']:>4} {r['kills_they_got']:>4} "
              f"{r['our_final_hp']:>6} {r['opp_final_hp']:>6} "
              f"{r['powerups_us']:>5} {r['powerups_opp']:>5}")

    # Averages
    def avg(lst, key):
        vals = [r[key] for r in lst]
        return sum(vals) / len(vals) if vals else 0

    print("\n" + "="*100)
    print("AVERAGES")
    print("="*100)

    metrics = [
        ("Zone dmg to US", "our_zone_dmg"),
        ("Zone dmg to OPPONENT", "opp_zone_dmg"),
        ("Zone dmg DIFFERENTIAL (us - opp)", "zone_dmg_diff"),
        ("Combat damage received by us", "our_combat_rcvd"),
        ("Combat damage dealt by us", "opp_combat_rcvd"),
        ("AoE fires by us", "our_aoe_fired"),
        ("AoE fires by opponent", "opp_aoe_fired"),
        ("AoE multi-hits AGAINST us", "multihits_vs_us"),
        ("AoE multi-hits BY us", "multihits_by_us"),
        ("Kills WE got", "kills_we_got"),
        ("Kills THEY got", "kills_they_got"),
        ("Final HP (ours)", "our_final_hp"),
        ("Final HP (opponent)", "opp_final_hp"),
        ("Powerups collected by us", "powerups_us"),
        ("Powerups collected by opponent", "powerups_opp"),
    ]

    print(f"{'Metric':<40} {'WINS avg':>12} {'LOSSES avg':>12} {'DIFF':>10}")
    print("-"*76)
    for label, key in metrics:
        w = avg(wins, key)
        l = avg(losses, key)
        print(f"{label:<40} {w:>12.1f} {l:>12.1f} {w-l:>+10.1f}")

    # Kill breakdown
    print("\n" + "="*100)
    print("KILL BREAKDOWN")
    print("="*100)
    print(f"{'Metric':<40} {'WINS avg':>12} {'LOSSES avg':>12}")
    print("-"*66)
    for label, key in [
        ("Combat kills by us", "kills_combat_us"),
        ("Zone kills vs opponent", "kills_zone_opp"),
        ("Combat kills by opponent", "kills_combat_opp"),
        ("Zone kills vs us", "kills_zone_us"),
    ]:
        w = avg(wins, key)
        l = avg(losses, key)
        print(f"{label:<40} {w:>12.1f} {l:>12.1f}")

    print("\n" + "="*100)
    print(f"Analyzed {len(wins)} wins, {len(losses)} losses")


if __name__ == "__main__":
    print("Processing LOSSES...")
    loss_results = process_matches(LOSS_IDS, "LOSS")
    print(f"\nProcessing WINS...")
    win_results = process_matches(WIN_IDS, "WIN")

    all_results = win_results + loss_results
    if all_results:
        print_table(all_results)
    else:
        print("No results to analyze")
