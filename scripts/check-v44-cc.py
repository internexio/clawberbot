#!/usr/bin/env python3
"""
check-v44-cc.py — one-shot reminder: has v44 (sv96) settled near the ~50% CC ceiling?

Pulls SEMalytics matchHistory, computes v44-since-ship head-to-head vs CrabCrusher-0308,
reports rank, and Telegrams the result. Designed to be fired once by a launchd one-shot
(com.semalytics.clawber-v44-check) ~24h after v44 shipped, then self-remove that job.

Context: memory v44-current-state + cc-ceiling-diagnostics. v44 sv96 shipped 2026-05-30T13:59Z.
Expectation: ~50% vs CC (ceiling). Alert if clearly <40% over n>=8 (possible regression) or
if we fell below #3. Reads .env internally (never put the key on a command line). Auto-ladder
data only — do NOT force-queue CC.
"""
import json, os, sys, urllib.request, subprocess
from datetime import datetime, timezone

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUR = "8f1e1fcf-7e3d-4a9c-90ee-1f0296746628"
SHIP = datetime.fromisoformat("2026-05-30T13:59:00+00:00")   # v44 = sv96
CC = "CrabCrusher-0308"
LABEL = "com.semalytics.clawber-v44-check"

def load_env():
    """Load .env into os.environ (CLAWBER_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)."""
    try:
        for l in open(os.path.join(PROJECT, ".env")):
            l = l.strip()
            if not l or l.startswith("#") or "=" not in l:
                continue
            kk, vv = l.split("=", 1)
            os.environ.setdefault(kk.strip(), vv.strip().strip('"').strip("'"))
    except OSError:
        pass

def key():
    k = os.environ.get("CLAWBER_API_KEY", "")
    if not k:
        raise SystemExit("no CLAWBER_API_KEY")
    return k

def get(url, k=None):
    h = {"Authorization": f"Bearer {k}"} if k else {}
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30).read())

def opp(mid, k):
    try:
        m = get(f"https://clawber.ai/api/v1/match/{mid}", k)
        for a in (m.get("participants") or m.get("agents") or []):
            aid = a.get("agentId") or a.get("id")
            if aid and aid != OUR:
                return a.get("agentName") or a.get("name") or "?"
    except Exception:
        return "?"
    return "?"

def telegram(text):
    import urllib.parse
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat:
        print("telegram creds missing in .env", file=sys.stderr)
        return
    data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
    try:
        urllib.request.urlopen(urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage", data=data), timeout=10)
    except Exception as e:
        print("telegram failed:", e, file=sys.stderr)

def main():
    load_env()
    k = key()
    mh = get(f"https://clawber.ai/api/v1/agent/{OUR}", k).get("matchHistory", [])
    ccW = ccL = 0
    for m in mh:
        try:
            ts = datetime.fromisoformat(m["matchDate"].replace("Z", "+00:00"))
        except Exception:
            continue
        if ts < SHIP:
            continue
        if CC in opp(m["matchId"], k):
            if m.get("isWin"): ccW += 1
            else: ccL += 1
    n = ccW + ccL
    pct = (100 * ccW / n) if n else float("nan")
    lb = get("https://clawber.ai/api/v1/leaderboard").get("leaderboard", [])
    rank = next((i + 1 for i, e in enumerate(lb) if e.get("name") == "SEMalytics"), None)
    rating = next((e.get("rating") for e in lb if e.get("name") == "SEMalytics"), None)

    verdict = "n<8 — too few CC matches yet, keep waiting"
    if n >= 8:
        if pct < 40: verdict = "⚠️ BELOW 40% — possible regression, investigate"
        elif pct <= 60: verdict = "✅ near ~50% ceiling (expected)"
        else: verdict = "📈 above ceiling — better than expected"
    if rank and rank > 3:
        verdict += f" | ⚠️ rank #{rank} (below #3)"

    msg = (f"🤖 v44 (sv96) CC check\n"
           f"vs CC since ship: {ccW}W-{ccL}L"
           + (f" ({pct:.0f}%)" if n else "")
           + f" n={n}\n"
           f"rank #{rank} @ {rating} ELO\n"
           f"{verdict}")
    print(msg)
    telegram(msg)

    # self-remove the one-shot launchd job so it doesn't recur
    subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}/{LABEL}"], capture_output=True)
    try:
        os.remove(os.path.expanduser(f"~/Library/LaunchAgents/{LABEL}.plist"))
    except OSError:
        pass

if __name__ == "__main__":
    main()
