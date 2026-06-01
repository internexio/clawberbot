#!/usr/bin/env python3
"""Scout — Download and analyze match history for any Clawber.ai player.

Usage:
    # Scout a player by name (looks up agent ID from leaderboard)
    ./scout.py hbfreed-opus

    # Scout by agent ID directly
    ./scout.py --id dfe4a24a-3230-4142-b555-1df19bab19cc

    # Limit number of matches to fetch
    ./scout.py hbfreed-opus --limit 20

    # Scout all top N players
    ./scout.py --top 5

    # Only show losses (to find beatable opponents)
    ./scout.py hbfreed-opus --losses

    # Download replays for losses
    ./scout.py hbfreed-opus --losses --download
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
SCOUT_DIR = PROJECT_DIR / "scouting"
API_BASE = "https://clawber.ai"
RATE_DELAY = 0.3  # seconds between API calls (be respectful)

OUR_AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"


def api_get(path):
    """GET request to Clawber API (no auth needed for public endpoints)."""
    url = f"{API_BASE}{path}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  API error: {e}", file=sys.stderr)
        return None


def fetch_leaderboard(limit=50):
    """Fetch leaderboard to map names -> agent IDs."""
    data = api_get(f"/api/v1/leaderboard?limit={limit}&houseBots=false")
    if not data:
        return {}
    return {e["name"].lower(): e for e in data.get("leaderboard", [])}


def scrape_match_ids(agent_id):
    """Scrape match IDs from an agent's profile page."""
    url = f"{API_BASE}/agent/{agent_id}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8")
    except Exception as e:
        print(f"  Error fetching profile: {e}", file=sys.stderr)
        return []

    # Match IDs appear in /arena?match=UUID links
    pattern = r'[?&]match=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
    match_ids = re.findall(pattern, html)
    # Deduplicate while preserving order (most recent first)
    seen = set()
    unique = []
    for mid in match_ids:
        if mid not in seen:
            seen.add(mid)
            unique.append(mid)
    return unique


def fetch_match_details(match_id):
    """Fetch full match details from the API."""
    return api_get(f"/api/v1/match/{match_id}")


def download_replay(replay_url, filepath):
    """Download a replay JSON file."""
    try:
        urllib.request.urlretrieve(replay_url, filepath)
        return True
    except Exception as e:
        print(f"  Download error: {e}", file=sys.stderr)
        return False


def format_match(match, target_agent_id):
    """Format a match result for display."""
    if not match or "participants" not in match:
        return None

    participants = match["participants"]
    target = None
    opponent = None
    for p in participants:
        if p["agentId"] == target_agent_id:
            target = p
        else:
            opponent = p

    if not target or not opponent:
        return None

    t_stats = target.get("stats", {})
    o_stats = opponent.get("stats", {})

    won_by_id = match.get("winnerId") == target.get("botId")
    won_by_place = target.get("placement", 99) < opponent.get("placement", 99)
    if won_by_id == won_by_place:
        won = won_by_id
    else:
        # Disagree — tiebreak by total damage dealt
        won = t_stats.get("damageDealt", 0) > o_stats.get("damageDealt", 0)
    result = "WIN" if won else "LOSS"

    return {
        "matchId": match["matchId"],
        "result": result,
        "won": won,
        "date": match.get("createdAt", "")[:16],
        "target_name": target["agentName"],
        "target_kills": t_stats.get("kills", 0),
        "target_damage": t_stats.get("damageDealt", 0),
        "target_survival": t_stats.get("survivalTicks", 0),
        "opponent_name": opponent["agentName"],
        "opponent_id": opponent["agentId"],
        "opponent_kills": o_stats.get("kills", 0),
        "opponent_damage": o_stats.get("damageDealt", 0),
        "opponent_survival": o_stats.get("survivalTicks", 0),
        "replayUrl": match.get("replayUrl", ""),
    }


def scout_player(agent_id, agent_name, limit=50, losses_only=False, do_download=False):
    """Scout a single player: fetch match IDs, get details, optionally download replays."""
    print(f"\nScouting {agent_name} ({agent_id})...")
    print(f"  Fetching match history from profile page...")

    match_ids = scrape_match_ids(agent_id)
    if not match_ids:
        print("  No matches found.")
        return []

    total = len(match_ids)
    fetch_count = min(limit, total)
    print(f"  Found {total} matches, fetching details for {fetch_count}...")

    matches = []
    for i, mid in enumerate(match_ids[:fetch_count]):
        detail = fetch_match_details(mid)
        if detail:
            formatted = format_match(detail, agent_id)
            if formatted:
                matches.append(formatted)
        if i < fetch_count - 1:
            time.sleep(RATE_DELAY)
        # Progress every 10
        if (i + 1) % 10 == 0:
            print(f"  [{i+1}/{fetch_count}] fetched...")

    print(f"  {len(matches)} matches processed.")

    # Filter
    display = [m for m in matches if not losses_only or not m["won"]]

    # Print results
    wins = sum(1 for m in matches if m["won"])
    losses = len(matches) - wins
    print(f"\n  Record (last {len(matches)}): {wins}W-{losses}L ({wins*100//max(len(matches),1)}%)")

    # Opponent breakdown
    opp_stats = {}
    for m in matches:
        oname = m["opponent_name"]
        if oname not in opp_stats:
            opp_stats[oname] = {"w": 0, "l": 0}
        if m["won"]:
            opp_stats[oname]["w"] += 1
        else:
            opp_stats[oname]["l"] += 1

    print(f"\n  Opponents faced:")
    for oname, stats in sorted(opp_stats.items(), key=lambda x: x[1]["w"] + x[1]["l"], reverse=True):
        total_vs = stats["w"] + stats["l"]
        print(f"    vs {oname:<30} {stats['w']}W-{stats['l']}L ({stats['w']*100//max(total_vs,1)}%)")

    # Display matches
    if display:
        label = "LOSSES" if losses_only else "MATCHES"
        print(f"\n  {label} ({len(display)}):")
        print(f"  {'Date':<17} {'Result':<5} {'Opponent':<25} {'K':<3} {'Dmg':<5} {'vs K':<4} {'vs Dmg':<6} {'Match ID'}")
        print(f"  {'-'*100}")
        for m in display:
            print(f"  {m['date']:<17} {m['result']:<5} {m['opponent_name']:<25} "
                  f"{m['target_kills']:<3} {m['target_damage']:<5} "
                  f"{m['opponent_kills']:<4} {m['opponent_damage']:<6} {m['matchId']}")

    # Download replays
    if do_download and display:
        dl_dir = SCOUT_DIR / agent_name.lower().replace(" ", "-")
        dl_dir.mkdir(parents=True, exist_ok=True)
        print(f"\n  Downloading {len(display)} replays to {dl_dir}/...")
        for m in display:
            if m["replayUrl"]:
                tag = "W" if m["won"] else "L"
                fname = f"{tag}-vs-{m['opponent_name']}-{m['matchId'][:8]}.json"
                fpath = dl_dir / fname
                if fpath.exists():
                    print(f"    {fname} (exists, skipping)")
                else:
                    ok = download_replay(m["replayUrl"], fpath)
                    print(f"    {fname} ({'ok' if ok else 'FAILED'})")
                    time.sleep(RATE_DELAY)

    return matches


def main():
    parser = argparse.ArgumentParser(description="Scout Clawber.ai players")
    parser.add_argument("name", nargs="?", help="Player name to scout")
    parser.add_argument("--id", help="Agent ID (skip name lookup)")
    parser.add_argument("--top", type=int, help="Scout top N players from leaderboard")
    parser.add_argument("--limit", type=int, default=50, help="Max matches to fetch (default: 50)")
    parser.add_argument("--losses", action="store_true", help="Only show losses")
    parser.add_argument("--download", action="store_true", help="Download replay files")
    args = parser.parse_args()

    if not args.name and not args.id and not args.top:
        parser.print_help()
        sys.exit(1)

    SCOUT_DIR.mkdir(exist_ok=True)

    leaderboard = fetch_leaderboard()

    if args.top:
        # Scout top N players (skip ourselves)
        sorted_players = sorted(leaderboard.values(), key=lambda x: x["rank"])
        for player in sorted_players[:args.top]:
            if player["agentId"] == OUR_AGENT_ID:
                continue
            scout_player(player["agentId"], player["name"], args.limit, args.losses, args.download)
        return

    if args.id:
        agent_id = args.id
        agent_name = args.name or agent_id[:8]
        # Try to find name from leaderboard
        for entry in leaderboard.values():
            if entry["agentId"] == agent_id:
                agent_name = entry["name"]
                break
    else:
        name_lower = args.name.lower()
        if name_lower not in leaderboard:
            # Try partial match
            candidates = [k for k in leaderboard if name_lower in k]
            if len(candidates) == 1:
                name_lower = candidates[0]
            elif candidates:
                print(f"Multiple matches: {', '.join(candidates)}")
                sys.exit(1)
            else:
                print(f"Player '{args.name}' not found on leaderboard.")
                sys.exit(1)

        entry = leaderboard[name_lower]
        agent_id = entry["agentId"]
        agent_name = entry["name"]

    scout_player(agent_id, agent_name, args.limit, args.losses, args.download)


if __name__ == "__main__":
    main()
