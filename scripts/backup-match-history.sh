#!/bin/bash
# Periodic ADDITIVE backup of match-history replays to Google Drive.
# Key property: NO --delete and --ignore-existing → local deletions/clobbers do NOT
# propagate to the backup. Once a replay is backed up it stays, even if the local
# copy is later removed (by an agent, script, or finger-slip). Protects the corpus
# from the single-copy failure mode (replays are gitignored = not git-recoverable).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
SRC="$BASE_DIR/match-history/"
GDRIVE="$HOME/Library/CloudStorage/GoogleDrive-dpedersen@semalytics.com/My Drive/claude-output"
DEST="$GDRIVE/backups/clawberbot/match-history/"
LOG="$BASE_DIR/logs/backup.log"
ts() { date -u +%FT%TZ; }

if [ ! -d "$GDRIVE" ]; then
  echo "$(ts) ERROR: Google Drive not mounted at $GDRIVE — skipping backup" >> "$LOG"
  exit 1
fi
mkdir -p "$DEST" 2>/dev/null || { echo "$(ts) ERROR: cannot create $DEST" >> "$LOG"; exit 1; }

# Additive only: copy files NOT already in the backup; never update or delete existing.
# Replays are immutable once written, so --ignore-existing is correct and Drive-friendly
# (avoids re-stat'ing/re-uploading ~900MB every run, and dodges mtime drift on the mount).
NEW=$(rsync -r --ignore-existing --no-perms --no-owner --no-group \
        --out-format='%n' "$SRC" "$DEST" 2>>"$LOG" | grep -c . || true)
TOTAL=$(find "$DEST" -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
echo "$(ts) backup OK: +${NEW} new files → backup now holds ${TOTAL} files (additive; deletions never propagate)" >> "$LOG"
