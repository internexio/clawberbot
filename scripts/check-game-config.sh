#!/bin/bash
# Check Clawber game mechanics for changes by parsing the API docs
# Compares current values against known baseline in game-config.json
# Run daily (or at session start) to detect meta shifts
#
# Usage: check-game-config.sh [--quiet|--update]
#   --quiet:  Only output if changes detected
#   --update: Accept new values as baseline

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$BASE_DIR/game-config.json"
DOCS_URL="https://clawber.ai/llms-full.txt"
TMPFILE=$(mktemp)
FLAG="${1:-}"

trap "rm -f $TMPFILE" EXIT

# Fetch current docs
curl -sf "$DOCS_URL" -o "$TMPFILE" 2>/dev/null || {
  echo "ERROR: Failed to fetch API docs from $DOCS_URL"
  exit 1
}

# Use python to parse all values from docs
CURRENT=$(python3 - "$TMPFILE" << 'PYEOF'
import re, json, sys
from datetime import datetime, timezone

with open(sys.argv[1]) as f:
    docs = f.read()

def find_after(label):
    pattern = rf'{label}[:\s*]*\**(\d+)'
    m = re.search(pattern, docs, re.IGNORECASE)
    return int(m.group(1)) if m else None

config = {
    "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "attack_damage": find_after("attack damage"),
    "attack_range": find_after("attack range"),
    "attack_cooldown": find_after("attack cooldown"),
    "ability_damage": find_after("ability damage"),
    "ability_cast_range": None,
    "ability_effect_radius": None,
    "ability_cooldown": find_after("ability cooldown"),
    "bot_hp": None,
    "bot_speed": None,
    "arena_size": None,
    "pickup_health_restore": None,
    "pickup_ammo_restore": None,
    "zone_damage_per_tick": None,
}

# Bot HP: "Health: 100 HP" or "**Health**: 100 HP"
m = re.search(r'\*{0,2}Health\*{0,2}[:\s]*(\d+)\s*HP', docs)
if m:
    config["bot_hp"] = int(m.group(1))

# Bot speed: "Speed: 12 units per tick"
m = re.search(r'\*{0,2}Speed\*{0,2}[:\s]*(\d+)\s*units', docs)
if m:
    config["bot_speed"] = int(m.group(1))

# Ability range line: "700 units (cast), 150 units (effect radius)"
m = re.search(r'[Aa]bility range[:\s*]*\**(\d+)\s*units?\s*\(cast\)[,\s]*(\d+)\s*units?\s*\(effect', docs)
if m:
    config["ability_cast_range"] = int(m.group(1))
    config["ability_effect_radius"] = int(m.group(2))

# Arena size: "2048 x 2048 units"
m = re.search(r'(\d{3,5})\s*x\s*\1\s*units', docs)
if m:
    config["arena_size"] = int(m.group(1))

# Pickup restores: "restores **35 HP**"
m = re.search(r'health.*?restores?\s*\**(\d+)\s*(?:HP|health)', docs, re.IGNORECASE)
if m:
    config["pickup_health_restore"] = int(m.group(1))

# Ammo pickup: "restores **3 ammo**"
m = re.search(r'ammo.*?restores?\s*\**(\d+)\s*ammo', docs, re.IGNORECASE)
if m:
    config["pickup_ammo_restore"] = int(m.group(1))

# Zone damage: look for "N HP/tick" or "N damage per tick" near zone
for line in docs.split('\n'):
    if 'zone' in line.lower() and ('damage' in line.lower() or 'hp' in line.lower()):
        nums = re.findall(r'(\d+)\s*(?:HP|damage)', line, re.IGNORECASE)
        if nums:
            config["zone_damage_per_tick"] = int(nums[0])
            break

print(json.dumps(config, indent=2))
PYEOF
)

if [[ -z "$CURRENT" || "$CURRENT" == "null" ]]; then
  echo "ERROR: Failed to parse game config from docs"
  exit 1
fi

# If no baseline exists, create it
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "$CURRENT" > "$CONFIG_FILE"
  echo "Created initial game config baseline at $CONFIG_FILE"
  echo "$CURRENT" | python3 -m json.tool
  exit 0
fi

# Compare against baseline
CHANGES=$(python3 - "$CONFIG_FILE" "$CURRENT" << 'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    old = json.load(f)
new = json.loads(sys.argv[2])

changes = []
skip = {"fetched_at"}
for key in new:
    if key in skip:
        continue
    old_val = old.get(key)
    new_val = new.get(key)
    if new_val is not None and old_val != new_val:
        changes.append(f"  {key}: {old_val} -> {new_val}")

if changes:
    print("\n".join(changes))
PYEOF
) || true

if [[ -n "$CHANGES" ]]; then
  echo "⚠️  GAME CONFIG CHANGES DETECTED:"
  echo "$CHANGES"
  echo ""
  OLD_DATE=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('fetched_at','unknown'))")
  echo "Previous baseline from: $OLD_DATE"

  if [[ "$FLAG" == "--update" ]]; then
    echo "$CURRENT" > "$CONFIG_FILE"
    echo "✓ Baseline updated."
  else
    echo "Run with --update to accept new values as baseline."
  fi
  exit 2  # Non-zero to signal changes
else
  if [[ "$FLAG" != "--quiet" ]]; then
    OLD_DATE=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('fetched_at','unknown'))")
    echo "✓ Game config unchanged (baseline: $OLD_DATE)"
    echo "$CURRENT" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f'  {k}: {v}') for k,v in d.items() if k != 'fetched_at']"
  fi
  exit 0
fi
