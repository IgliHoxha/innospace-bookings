#!/usr/bin/env bash
# Says whether this release can change what is on the volume, which is when a backup comes first.
set -euo pipefail
: "${FLY_API_TOKEN:?}" "${GITHUB_EVENT_NAME:?}" "${GITHUB_OUTPUT:?}"

APP="${APP:-innospace-bookings}"
# What opens or lays out the volume: the database modules, the image's boot and the mount.
TOUCHES="src/lib/db.ts Dockerfile docker-entrypoint.sh fly.toml.example"

# The live image's tag is its commit, with "sha-" stripped where the label carries it.
live=$(flyctl image show -a "$APP" --json | jq -r '.[0].Tag // empty' | sed 's/^sha-//') || live=
# From what is live, not the last push: a failed or superseded run hides no change.
# shellcheck disable=SC2086
if [ "$GITHUB_EVENT_NAME" = push ] && [ -n "$live" ] && git diff --quiet "$live" HEAD -- $TOUCHES; then
  echo "::notice::Nothing that touches the volume changed since $live, so no backup is taken."
  echo "No restore point for this release: nothing that touches the volume changed." >> "$GITHUB_STEP_SUMMARY"
  echo "needed=false" >> "$GITHUB_OUTPUT"
else
  # A manual run, an image no commit names, or a diff git could not make: back up anyway.
  echo "needed=true" >> "$GITHUB_OUTPUT"
fi
