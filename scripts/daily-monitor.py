#!/usr/bin/env python3
"""
Clawberbot Daily Monitor — statistical analysis + Telegram alerts.

Authoritative source: API /agent/{id}.matchHistory (includes auto-ladder).
results.csv is used only to cheaply enrich opponent names for matches we queued.
Computes rolling WR, opponent-tier breakdown, CC h2h, ELO trend.

Run daily via launchd or manually: python3 scripts/daily-monitor.py
"""

import csv
import json
import math
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from collections import Counter, defaultdict

# ── Config ──────────────────────────────────────────────────────────
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_CSV = os.path.join(PROJECT_DIR, "logs", "results.csv")
LEADERBOARD_CACHE = os.path.join(PROJECT_DIR, "logs", "leaderboard-cache.json")
MONITOR_STATE = os.path.join(PROJECT_DIR, "logs", "monitor-state.json")
OPPONENT_CACHE = os.path.join(PROJECT_DIR, "logs", "opponent-cache.json")
ENV_FILE = os.path.join(PROJECT_DIR, ".env")

OUR_AGENT_ID = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"

TELEGRAM_BOT_TOKEN = "8697910422:AAF7nKHznBX3px2_yg-2Sm-iWK96ys5nerA"
TELEGRAM_CHAT_ID = "7864057399"

API_BASE = "https://clawber.ai/api/v1"

# Alert thresholds
ROLLING_30_WR_ALERT = 0.88      # 2-sigma below 95% expected
ROLLING_100_WR_ALERT = 0.92     # softer threshold for larger window
OPPONENT_CLUSTER_PCT = 0.50     # same opponent >50% of losses in 7 days
ELO_DECLINE_DAYS = 3            # alert if declining this many consecutive days


# ── Helpers ─────────────────────────────────────────────────────────
def binomial_ci(wins, total, z=1.96):
    """Wilson score interval for binomial proportion."""
    if total == 0:
        return (0.0, 1.0)
    p = wins / total
    denom = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denom
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denom
    return (max(0, center - spread), min(1, center + spread))


def send_telegram(text):
    """Send message via Nightwatch Patrol bot."""
    data = urllib.parse.urlencode({
        "chat_id": TELEGRAM_CHAT_ID,
        "parse_mode": "Markdown",
        "text": text,
    }).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
        data=data,
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        return result.get("ok", False)
    except Exception as e:
        print(f"Telegram send failed: {e}", file=sys.stderr)
        return False


def fetch_leaderboard():
    """Fetch current leaderboard, cache locally."""
    try:
        req = urllib.request.Request(f"{API_BASE}/leaderboard")
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        lb = data.get("leaderboard", [])
        # Cache it
        with open(LEADERBOARD_CACHE, "w") as f:
            json.dump({"fetched": datetime.now(timezone.utc).isoformat(), "data": lb}, f)
        return lb
    except Exception as e:
        print(f"Leaderboard fetch failed: {e}", file=sys.stderr)
        # Fall back to cache
        if os.path.exists(LEADERBOARD_CACHE):
            with open(LEADERBOARD_CACHE) as f:
                return json.load(f).get("data", [])
        return []


def load_state():
    """Load previous monitor state for trend detection."""
    if os.path.exists(MONITOR_STATE):
        with open(MONITOR_STATE) as f:
            return json.load(f)
    return {}


def save_state(state):
    with open(MONITOR_STATE, "w") as f:
        json.dump(state, f, indent=2)


# ── Env ─────────────────────────────────────────────────────────────
def load_env():
    """Load .env into process env so urlopen Auth header is available."""
    if not os.path.exists(ENV_FILE):
        return
    with open(ENV_FILE) as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def api_key():
    k = os.environ.get("CLAWBER_API_KEY", "")
    if not k:
        raise RuntimeError("CLAWBER_API_KEY missing (checked .env and env)")
    return k


# ── Opponent Cache ──────────────────────────────────────────────────
def load_opponent_cache():
    if os.path.exists(OPPONENT_CACHE):
        try:
            with open(OPPONENT_CACHE) as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}
    return {}


def save_opponent_cache(cache):
    with open(OPPONENT_CACHE, "w") as f:
        json.dump(cache, f)


def load_csv_opponents():
    """Build {match_id: opponent_name} from results.csv (zero API cost)."""
    out = {}
    if not os.path.exists(RESULTS_CSV):
        return out
    with open(RESULTS_CSV) as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < 4:
                continue
            mid = row[1].strip()
            opp = row[3].strip()
            if mid and opp:
                out[mid] = opp
    return out


def fetch_opponent_name(match_id):
    """Look up opponent name via /match/{id}. Returns name or '?'."""
    try:
        req = urllib.request.Request(
            f"{API_BASE}/match/{match_id}",
            headers={"Authorization": f"Bearer {api_key()}"},
        )
        data = json.loads(urllib.request.urlopen(req, timeout=15).read())
    except Exception as e:
        print(f"  opponent lookup failed for {match_id[:8]}: {e}", file=sys.stderr)
        return "?"

    parts = data.get("participants") or data.get("agents") or []
    for a in parts:
        aid = a.get("agentId") or a.get("id")
        if aid and aid != OUR_AGENT_ID:
            return a.get("agentName") or a.get("name") or "?"
    return "?"


# ── Fetch Match History (authoritative) ─────────────────────────────
def fetch_match_history(days_back=30):
    """Pull authoritative matchHistory from API, enrich with opponent names.

    Opponent enrichment is layered for cost:
      1) opponent cache (zero cost)
      2) results.csv cross-ref by match_id (zero cost)
      3) per-match /match/{id} fetch (one HTTP call, cached after)
    """
    req = urllib.request.Request(
        f"{API_BASE}/agent/{OUR_AGENT_ID}",
        headers={"Authorization": f"Bearer {api_key()}"},
    )
    data = json.loads(urllib.request.urlopen(req, timeout=30).read())
    mh = data.get("matchHistory", [])

    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    matches = []
    for m in mh:
        try:
            ts = datetime.fromisoformat(m["matchDate"].replace("Z", "+00:00"))
        except (ValueError, KeyError):
            continue
        if ts < cutoff:
            continue
        matches.append({
            "time": ts,
            "match_id": m["matchId"],
            "result": "WIN" if m.get("isWin") else "LOSS",
            "placement": m.get("placement"),
            "opponent": "",
        })

    matches.sort(key=lambda x: x["time"])

    # Enrich opponents
    opp_cache = load_opponent_cache()
    csv_opps = load_csv_opponents()
    api_fetches = 0
    for m in matches:
        mid = m["match_id"]
        if mid in opp_cache:
            m["opponent"] = opp_cache[mid]
        elif mid in csv_opps:
            m["opponent"] = csv_opps[mid]
            opp_cache[mid] = csv_opps[mid]
        else:
            name = fetch_opponent_name(mid)
            m["opponent"] = name
            opp_cache[mid] = name
            api_fetches += 1
            time.sleep(0.1)  # be polite to the API

    if api_fetches:
        save_opponent_cache(opp_cache)
        print(f"  Resolved {api_fetches} opponent name(s) via API")

    return matches


def parse_results_csv_fallback(days_back=30):
    """Last-resort fallback if API is down. Misses auto-ladder matches."""
    matches = []
    if not os.path.exists(RESULTS_CSV):
        return matches
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    with open(RESULTS_CSV) as f:
        for row in csv.reader(f):
            if len(row) < 4:
                continue
            try:
                ts = datetime.fromisoformat(row[0].replace("Z", "+00:00"))
            except (ValueError, IndexError):
                continue
            if ts < cutoff:
                continue
            matches.append({
                "time": ts,
                "match_id": row[1],
                "result": row[2],
                "opponent": row[3],
                "placement": None,
            })
    return sorted(matches, key=lambda m: m["time"])


# ── Analysis ────────────────────────────────────────────────────────
def analyze(matches, leaderboard):
    """Run all analyses, return structured report."""
    alerts = []
    report = {}

    if not matches:
        return {"error": "No matches found"}, ["No match data available"]

    # Build opponent ELO lookup
    elo_lookup = {}
    for entry in leaderboard:
        elo_lookup[entry["name"]] = entry.get("rating", 1000)

    top10_names = set(e["name"] for e in leaderboard[:10])

    # Our current ELO and rank
    our_entry = next((e for e in leaderboard if e["name"] == "SEMalytics"), None)
    our_elo = our_entry["rating"] if our_entry else 0
    our_rank = our_entry["rank"] if our_entry else "?"
    cc_entry = next((e for e in leaderboard if "CrabCrusher-0308" in e["name"]), None)
    cc_elo = cc_entry["rating"] if cc_entry else 0
    cc_gap = cc_elo - our_elo if cc_elo else "?"

    report["elo"] = our_elo
    report["rank"] = our_rank
    report["cc_gap"] = cc_gap

    # ── Rolling WR ──
    recent_30 = matches[-30:] if len(matches) >= 30 else matches
    recent_100 = matches[-100:] if len(matches) >= 100 else matches

    w30 = sum(1 for m in recent_30 if m["result"] == "WIN")
    t30 = len(recent_30)
    wr30 = w30 / t30 if t30 else 0
    ci30 = binomial_ci(w30, t30)

    w100 = sum(1 for m in recent_100 if m["result"] == "WIN")
    t100 = len(recent_100)
    wr100 = w100 / t100 if t100 else 0
    ci100 = binomial_ci(w100, t100)

    report["rolling_30"] = f"{w30}W-{t30 - w30}L ({wr30:.0%})"
    report["rolling_30_ci"] = f"[{ci30[0]:.0%}-{ci30[1]:.0%}]"
    report["rolling_100"] = f"{w100}W-{t100 - w100}L ({wr100:.0%})"
    report["rolling_100_ci"] = f"[{ci100[0]:.0%}-{ci100[1]:.0%}]"

    if wr30 < ROLLING_30_WR_ALERT and t30 >= 20:
        alerts.append(f"⚠️ Rolling-30 WR dropped to {wr30:.0%} ({w30}W-{t30-w30}L)")

    if wr100 < ROLLING_100_WR_ALERT and t100 >= 50:
        alerts.append(f"⚠️ Rolling-100 WR dropped to {wr100:.0%}")

    # ── WR by opponent tier ──
    top10_matches = [m for m in recent_100 if m["opponent"] in top10_names]
    rest_matches = [m for m in recent_100 if m["opponent"] not in top10_names]

    t10_w = sum(1 for m in top10_matches if m["result"] == "WIN")
    t10_t = len(top10_matches)
    rest_w = sum(1 for m in rest_matches if m["result"] == "WIN")
    rest_t = len(rest_matches)

    report["top10_wr"] = f"{t10_w}W-{t10_t - t10_w}L ({t10_w/t10_t:.0%})" if t10_t else "no matches"
    report["rest_wr"] = f"{rest_w}W-{rest_t - rest_w}L ({rest_w/rest_t:.0%})" if rest_t else "no matches"

    # ── CC head-to-head (7 days) ──
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    week_matches = [m for m in matches if m["time"] >= week_ago]
    cc_matches = [m for m in week_matches if "CrabCrusher-0308" in m["opponent"]]
    cc_wins = sum(1 for m in cc_matches if m["result"] == "WIN")
    cc_losses = len(cc_matches) - cc_wins

    report["cc_wins_7d"] = cc_wins
    report["cc_losses_7d"] = cc_losses

    if cc_losses >= 3:
        alerts.append(f"🦀 {cc_losses} losses to CC-0308 this week ({cc_wins}W-{cc_losses}L)")

    # ── General loss check ──
    week_losses = [m for m in week_matches if m["result"] != "WIN"]
    if wr30 < ROLLING_30_WR_ALERT and t30 >= 20:
        loss_opponents = Counter(m["opponent"] for m in week_losses)
        parts = [f"{opp} ×{c}" for opp, c in loss_opponents.most_common(3)]
        alerts.append(f"⚠️ R30 WR {wr30:.0%} — losses: {', '.join(parts)}")

    # ── Daily ELO trend ──
    prev_state = load_state()
    elo_history = prev_state.get("elo_history", [])

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Don't duplicate today's entry
    if not elo_history or elo_history[-1]["date"] != today_str:
        elo_history.append({"date": today_str, "elo": our_elo})
    else:
        elo_history[-1]["elo"] = our_elo

    # Keep last 30 days
    elo_history = elo_history[-30:]

    if len(elo_history) >= ELO_DECLINE_DAYS + 1:
        recent_elos = [e["elo"] for e in elo_history[-(ELO_DECLINE_DAYS + 1):]]
        declining = all(recent_elos[i] >= recent_elos[i + 1] for i in range(len(recent_elos) - 1))
        if declining and wr100 > 0.90:
            delta = recent_elos[0] - recent_elos[-1]
            alerts.append(f"📉 ELO declining {ELO_DECLINE_DAYS}+ days (-{delta}) despite {wr100:.0%} WR")

    elo_delta = our_elo - elo_history[-2]["elo"] if len(elo_history) >= 2 else 0
    report["elo_delta"] = elo_delta

    # ── Matches today ──
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)
    today_matches = [m for m in matches if m["time"] >= today_start]
    today_w = sum(1 for m in today_matches if m["result"] == "WIN")
    today_t = len(today_matches)
    report["today"] = f"{today_w}W-{today_t - today_w}L" if today_t else "no matches yet"

    # Save state
    save_state({
        "elo_history": elo_history,
        "last_run": datetime.now(timezone.utc).isoformat(),
        "last_elo": our_elo,
        "last_wr30": wr30,
    })

    return report, alerts


# ── Format & Send ───────────────────────────────────────────────────
def format_message(report, alerts):
    """Format report as concise Telegram message."""
    lines = []
    lines.append("🤖 *Clawberbot Daily*")
    lines.append("")

    # ELO + WR
    elo = report.get("elo", "?")
    rank = report.get("rank", "?")
    cc_gap = report.get("cc_gap", "?")
    delta = report.get("elo_delta", 0)
    delta_str = f"+{delta}" if delta >= 0 else str(delta)
    lines.append(f"#{rank} {elo} ELO ({delta_str}) | CC gap: {cc_gap}")
    lines.append(f"WR: {report.get('rolling_100', '?')}")

    # CC head-to-head (7 days)
    cc_losses = report.get("cc_losses_7d", 0)
    cc_wins = report.get("cc_wins_7d", 0)
    if cc_losses > 0 or cc_wins > 0:
        lines.append(f"vs CC: {cc_wins}W-{cc_losses}L (7d)")
    else:
        lines.append("vs CC: no matches (7d)")

    # Alerts only if something's wrong
    if alerts:
        lines.append("")
        for alert in alerts:
            lines.append(alert)

    return "\n".join(lines)


# ── Main ────────────────────────────────────────────────────────────
def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Clawberbot daily monitor starting...")

    load_env()

    # Fetch data
    leaderboard = fetch_leaderboard()
    try:
        matches = fetch_match_history(days_back=30)
        source = "api"
    except Exception as e:
        print(f"  API matchHistory fetch failed ({e}); falling back to results.csv", file=sys.stderr)
        matches = parse_results_csv_fallback(days_back=30)
        source = "csv-fallback"

    print(f"  Loaded {len(matches)} matches (last 30 days, source={source}), {len(leaderboard)} leaderboard entries")

    # Analyze
    report, alerts = analyze(matches, leaderboard)
    if source == "csv-fallback":
        alerts.insert(0, "⚠️ API matchHistory unreachable — report based on queued matches only (auto-ladder losses missing).")

    if "error" in report:
        msg = f"🤖 *Clawberbot Daily*\n\n⚠️ {report['error']}"
        send_telegram(msg)
        return

    # Format and send
    msg = format_message(report, alerts)
    print(f"\n{msg}\n")

    success = send_telegram(msg)
    if success:
        print("  ✓ Telegram sent")
    else:
        print("  ✗ Telegram failed")

    # Also write to Google Drive for laptop access
    gdrive = os.path.expanduser(
        "~/Library/CloudStorage/GoogleDrive-dpedersen@semalytics.com/My Drive/claude-output/"
    )
    if os.path.isdir(gdrive):
        outpath = os.path.join(gdrive, "clawberbot-daily.md")
        try:
            with open(outpath, "w") as f:
                f.write(f"# Clawberbot Daily — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}\n\n")
                f.write(msg.replace("*", "**") + "\n")
            print(f"  ✓ Written to {outpath}")
        except PermissionError as e:
            # launchd lacks Google Drive sandbox permission — non-fatal.
            print(f"  ⚠ gdrive write skipped: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
