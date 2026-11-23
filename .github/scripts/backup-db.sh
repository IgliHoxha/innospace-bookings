#!/usr/bin/env bash
# Copies the live database out of the Fly machine, checks it opens, and stores it gzipped in the R2 bucket.
set -euo pipefail

APP="${APP:-innospace-bookings}"
BUCKET="${BUCKET:-innospace-bookings-backups}"
# "nightly" or "pre-release-<commit>": part of the object's name, so a restore point is easy to find.
LABEL="${1:?usage: backup-db.sh <label>}"
: "${FLY_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${R2_BACKUP_TOKEN:?}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# ssh reaches only a running machine, and a suspended one does not wake for it.
machine=$(flyctl machine list -a "$APP" --json | jq -er 'if length == 1 then .[0].id else error("expected one machine, found \(length)") end')
flyctl machine start "$machine" -a "$APP" > /dev/null

# VACUUM INTO writes one consistent file, journal included, while the app keeps serving.
read -r -d '' copy <<'EOF' || true
sh -c "rm -f /tmp/bookings-backup.db /tmp/bookings-backup.db.gz && node -e \"require(\\\"/app/node_modules/better-sqlite3\\\")(\\\"/app/data/bookings.db\\\",{readonly:true,fileMustExist:true}).prepare(\\\"VACUUM INTO ?\\\").run(\\\"/tmp/bookings-backup.db\\\")\" && gzip -9 /tmp/bookings-backup.db"
EOF
flyctl ssh console -a "$APP" -C "$copy" > /dev/null
flyctl ssh sftp get /tmp/bookings-backup.db.gz "$work/backup.db.gz" -a "$APP" > /dev/null
flyctl ssh console -a "$APP" -C "rm -f /tmp/bookings-backup.db.gz" > /dev/null

# A copy that does not open is not a backup, so it is checked before it is kept.
gunzip -c "$work/backup.db.gz" > "$work/backup.db"
check=$(sqlite3 "$work/backup.db" "PRAGMA integrity_check")
[ "$check" = ok ] || { echo "::error::The copy fails SQLite's integrity check: $check"; exit 1; }
rows=$(sqlite3 "$work/backup.db" "SELECT count(*) FROM bookings")

# Only counts and sizes are printed: the repository is public and the file holds guests' details.
key="bookings-$(date -u +%Y-%m-%dT%H%MZ)-$LABEL.db.gz"
curl --fail-with-body -sS --retry 3 --retry-all-errors --max-time 60 -o /dev/null -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$BUCKET/objects/$key" \
  -H "Authorization: Bearer $R2_BACKUP_TOKEN" -H "Content-Type: application/gzip" \
  --data-binary "@$work/backup.db.gz"
echo "Restore point: \`$key\` in the R2 bucket \`$BUCKET\` ($rows bookings, $(wc -c < "$work/backup.db.gz" | tr -d ' ') bytes)." >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
