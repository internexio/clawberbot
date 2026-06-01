#!/usr/bin/env python3
"""Analyze today's loss JSON files from match-history directory.

Extracts key data per loss: opponent name, match duration, damage, kills,
winnerId, placement anomalies, and pattern analysis.

Our agent ID: 8f1e1fcf-7e3d-4a9c-90ee-1f0296746628
"""

import json
import os
import glob
from datetime import datetime
from collections import defaultdict

MATCH_DIR = "/Users/davidpedersen/Mini/clawberbot/match-history"
OUR_AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

# Elite opponents to flag
ELITE_PATTERNS = ["hbfreed", "ozten", "ClaudeOpus", "Velocity-Comet", "Forge-Blitz"]

def is_elite(name):
    for pat in ELITE_PATTERNS:
        if pat.lower() in name.lower():
            return True
    return False

def main():
    # Collect all loss files from today (Mar 4, 2026)
    loss_files = glob.glob(os.path.join(MATCH_DIR, "loss-*.json"))
    today_losses = []

    for fpath in loss_files:
        # Check file modification date
        mtime = os.path.getmtime(fpath)
        fdate = datetime.fromtimestamp(mtime)
        if fdate.strftime("%Y-%m-%d") != "2026-03-04":
            continue

        try:
            with open(fpath) as f:
                data = json.load(f)
        except Exception:
            continue

        # Also verify createdAt is today
        created = data.get("createdAt", "")
        if not created.startswith("2026-03-04"):
            continue

        parts = data.get("participants", [])
        us = next((p for p in parts if p.get("agentId") == OUR_AGENT_ID), None)
        them = next((p for p in parts if p.get("agentId") != OUR_AGENT_ID), None)

        if not us or not them:
            continue

        # Verify this is indeed a loss (winnerId != our botId)
        winner_id = data.get("winnerId", "")
        our_bot_id = us.get("botId", "")
        is_loss = winner_id != our_bot_id

        opp_name = them.get("agentName", "???")
        our_kills = us.get("stats", {}).get("kills", 0)
        our_dmg = us.get("stats", {}).get("damageDealt", 0)
        our_survival = us.get("stats", {}).get("survivalTicks", 0)
        their_kills = them.get("stats", {}).get("kills", 0)
        their_dmg = them.get("stats", {}).get("damageDealt", 0)
        their_survival = them.get("stats", {}).get("survivalTicks", 0)
        our_placement = us.get("placement", "?")
        their_placement = them.get("placement", "?")
        our_version = us.get("botVersion", "?")
        their_version = them.get("botVersion", "?")
        match_id = data.get("matchId", "???")
        share_url = data.get("shareUrl", "")
        created_time = created[11:19] if len(created) > 19 else created

        # Match duration
        match_ticks = max(our_survival, their_survival)

        # Timeout detection: both survived to 1201
        is_timeout = our_survival >= 1200 and their_survival >= 1200

        # Outcome type
        if is_timeout:
            outcome_type = "TIMEOUT (HP/dmg decision)"
        elif our_survival < their_survival:
            outcome_type = "ELIMINATION (died tick {})".format(our_survival)
        else:
            outcome_type = "UNKNOWN"

        today_losses.append({
            "match_id": match_id,
            "time": created_time,
            "opponent": opp_name,
            "opp_version": their_version,
            "is_elite": is_elite(opp_name),
            "is_loss": is_loss,
            "our_kills": our_kills,
            "our_dmg": our_dmg,
            "our_survival": our_survival,
            "our_placement": our_placement,
            "their_kills": their_kills,
            "their_dmg": their_dmg,
            "their_survival": their_survival,
            "their_placement": their_placement,
            "match_ticks": match_ticks,
            "is_timeout": is_timeout,
            "outcome_type": outcome_type,
            "our_version": our_version,
            "share_url": share_url,
            "dmg_diff": our_dmg - their_dmg,
        })

    # Sort by time
    today_losses.sort(key=lambda x: x["time"])

    if not today_losses:
        print("No loss files found from today (2026-03-04).")
        return

    print("=" * 120)
    print(" TODAY'S LOSSES (2026-03-04) -- SEMalytics v{}".format(today_losses[0]["our_version"]))
    print(" Total losses today: {}".format(len(today_losses)))
    elite_losses = [l for l in today_losses if l["is_elite"]]
    print(" Elite opponent losses: {}".format(len(elite_losses)))
    non_elite_losses = [l for l in today_losses if not l["is_elite"]]
    print(" Non-elite losses: {}".format(len(non_elite_losses)))
    timeout_losses = [l for l in today_losses if l["is_timeout"]]
    elimination_losses = [l for l in today_losses if not l["is_timeout"]]
    print(" Timeout losses: {} | Elimination losses: {}".format(len(timeout_losses), len(elimination_losses)))
    print("=" * 120)

    # -- SUMMARY TABLE --
    print()
    print("DETAILED LOSS TABLE")
    print("-" * 120)
    header = "{:<9} {:<35} {:<10} {:<10} {:>8} {:>6} {:<30} {:>5}".format(
        "Time", "Opponent", "Us K/D", "Them K/D", "DmgDiff", "Ticks", "Outcome", "Elite")
    print(header)
    print("-" * 120)

    for l in today_losses:
        elite_flag = " ***" if l["is_elite"] else ""
        us_kd = "{}K/{}d".format(l["our_kills"], l["our_dmg"])
        them_kd = "{}K/{}d".format(l["their_kills"], l["their_dmg"])
        dmg_sign = "+" if l["dmg_diff"] >= 0 else ""
        outcome_short = l["outcome_type"][:30]

        print("{:<9} {:<35} {:<10} {:<10} {}{:>7} {:>6} {:<30}{}".format(
            l["time"], l["opponent"], us_kd, them_kd,
            dmg_sign, l["dmg_diff"], l["match_ticks"], outcome_short, elite_flag))

    # -- PER-OPPONENT BREAKDOWN --
    print()
    print("=" * 100)
    print("PER-OPPONENT BREAKDOWN")
    print("=" * 100)

    opp_stats = defaultdict(lambda: {
        "count": 0, "our_dmg": 0, "their_dmg": 0,
        "our_kills": 0, "their_kills": 0,
        "timeouts": 0, "eliminations": 0,
        "is_elite": False, "matches": []
    })

    for l in today_losses:
        opp = l["opponent"]
        s = opp_stats[opp]
        s["count"] += 1
        s["our_dmg"] += l["our_dmg"]
        s["their_dmg"] += l["their_dmg"]
        s["our_kills"] += l["our_kills"]
        s["their_kills"] += l["their_kills"]
        s["is_elite"] = l["is_elite"]
        if l["is_timeout"]:
            s["timeouts"] += 1
        else:
            s["eliminations"] += 1
        s["matches"].append(l)

    sorted_opps = sorted(opp_stats.items(), key=lambda x: (-x[1]["is_elite"], -x[1]["count"]))

    print()
    print("{:<35} {:>6} {:>8} {:>5} {:>10} {:>12} {:>11} {:>6}".format(
        "Opponent", "Losses", "Timeouts", "Elim", "AvgOurDmg", "AvgTheirDmg", "AvgDmgDiff", "Elite"))
    print("-" * 100)

    for opp, s in sorted_opps:
        avg_our = s["our_dmg"] / s["count"]
        avg_their = s["their_dmg"] / s["count"]
        avg_diff = avg_our - avg_their
        elite_mark = "***" if s["is_elite"] else ""
        diff_sign = "+" if avg_diff >= 0 else ""
        print("{:<35} {:>6} {:>8} {:>5} {:>10.0f} {:>12.0f} {}{:>10.0f} {:>6}".format(
            opp, s["count"], s["timeouts"], s["eliminations"],
            avg_our, avg_their, diff_sign, avg_diff, elite_mark))

    # -- ELITE OPPONENT DEEP DIVE --
    print()
    print("=" * 100)
    print("ELITE OPPONENT DEEP DIVE")
    print("=" * 100)

    has_elite = False
    for opp, s in sorted_opps:
        if not s["is_elite"]:
            continue
        has_elite = True
        print()
        print("  {} -- {} losses".format(opp, s["count"]))
        print("  {}".format("-" * 70))
        for m in s["matches"]:
            dmg_sign = "+" if m["dmg_diff"] >= 0 else ""
            print("    {} | Us {}K/{}d (P{}) vs Them {}K/{}d (P{}) | {}{}d | {}".format(
                m["time"], m["our_kills"], m["our_dmg"], m["our_placement"],
                m["their_kills"], m["their_dmg"], m["their_placement"],
                dmg_sign, m["dmg_diff"], m["outcome_type"]))
            print("             Replay: {}".format(m["share_url"]))

    if not has_elite:
        print("  No elite opponent losses today.")

    # -- PATTERN ANALYSIS --
    print()
    print("=" * 100)
    print("PATTERN ANALYSIS")
    print("=" * 100)

    our_total_dmg = sum(l["our_dmg"] for l in today_losses)
    their_total_dmg = sum(l["their_dmg"] for l in today_losses)
    avg_our_dmg = our_total_dmg / len(today_losses)
    avg_their_dmg = their_total_dmg / len(today_losses)

    print()
    print("  Avg damage per match -- Us: {:.0f}  |  Them: {:.0f}  |  Gap: {:+.0f}".format(
        avg_our_dmg, avg_their_dmg, avg_our_dmg - avg_their_dmg))
    print("  Total damage -- Us: {}  |  Them: {}".format(our_total_dmg, their_total_dmg))

    our_total_kills = sum(l["our_kills"] for l in today_losses)
    their_total_kills = sum(l["their_kills"] for l in today_losses)
    print("  Total kills -- Us: {}  |  Them: {}".format(our_total_kills, their_total_kills))

    # Damage-positive losses
    dmg_positive_losses = [l for l in today_losses if l["dmg_diff"] > 0]
    print()
    print("  Damage-POSITIVE losses (we out-damaged but lost): {}/{}".format(
        len(dmg_positive_losses), len(today_losses)))
    for l in dmg_positive_losses:
        print("    vs {}: +{}d, {}".format(l["opponent"], l["dmg_diff"], l["outcome_type"]))
        print("      {}".format(l["share_url"]))

    # Zero-kill matches
    zero_kill_losses = [l for l in today_losses if l["our_kills"] == 0]
    print()
    print("  Zero-kill losses: {}/{}".format(len(zero_kill_losses), len(today_losses)))

    # Close losses (damage diff < 50)
    close_losses = [l for l in today_losses if abs(l["dmg_diff"]) < 50]
    print("  Close losses (|dmg diff| < 50): {}/{}".format(len(close_losses), len(today_losses)))
    for l in close_losses:
        dmg_sign = "+" if l["dmg_diff"] >= 0 else ""
        print("    vs {}: {}{}d | {}".format(l["opponent"], dmg_sign, l["dmg_diff"], l["outcome_type"]))

    # Blowout losses
    blowout_losses = [l for l in today_losses if l["dmg_diff"] < -200]
    print()
    print("  Blowout losses (they out-damaged by 200+): {}/{}".format(
        len(blowout_losses), len(today_losses)))
    for l in blowout_losses:
        print("    vs {}: {}d | Us {}K/{}d vs {}K/{}d".format(
            l["opponent"], l["dmg_diff"], l["our_kills"], l["our_dmg"],
            l["their_kills"], l["their_dmg"]))

    # Placement anomalies
    placement_disagree = [l for l in today_losses if l["is_timeout"] and l["our_placement"] == 1]
    print()
    print("  Placement anomalies (we got P1 but lost by winnerId): {}/{}".format(
        len(placement_disagree), len(today_losses)))
    for l in placement_disagree:
        print("    vs {}: Our P{} Their P{} | {:+}d | {}".format(
            l["opponent"], l["our_placement"], l["their_placement"],
            l["dmg_diff"], l["share_url"]))

    # Early elimination losses
    early_deaths = [l for l in today_losses if l["our_survival"] < 1000]
    print()
    print("  Early elimination (survived <1000 ticks): {}/{}".format(
        len(early_deaths), len(today_losses)))
    for l in early_deaths:
        print("    vs {}: died at tick {} | {}K/{}d".format(
            l["opponent"], l["our_survival"], l["our_kills"], l["our_dmg"]))

    # -- TIMING DISTRIBUTION --
    print()
    print("=" * 100)
    print("LOSS TIMING DISTRIBUTION (UTC)")
    print("=" * 100)

    hours = defaultdict(int)
    for l in today_losses:
        h = l["time"][:2]
        hours[h] += 1

    print()
    for h in sorted(hours.keys()):
        bar = "#" * hours[h]
        print("  {}:00 UTC | {} ({})".format(h, bar, hours[h]))

    # -- ALL REPLAY LINKS --
    print()
    print("=" * 100)
    print("ALL LOSS REPLAY LINKS")
    print("=" * 100)
    print()
    for l in today_losses:
        elite_mark = " [ELITE]" if l["is_elite"] else ""
        print("  {} vs {}{}".format(l["time"], l["opponent"], elite_mark))
        print("    {}".format(l["share_url"]))

    print()

if __name__ == "__main__":
    main()
