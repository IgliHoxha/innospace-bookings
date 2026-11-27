#!/usr/bin/env bash
# Says what this push needs, measured from the last commit that passed: which checks, and whether an image.
set -euo pipefail
: "${GITHUB_EVENT_NAME:?}" "${GITHUB_OUTPUT:?}"

# Read by no check and held by no image: Prettier skips them and no test opens them.
UNCHECKED="README.md LICENSE Makefile .env.example docs"
# Read by Prettier and the tests alone: the folder holds nothing ESLint or tsc reads.
UNLINTED=".github"
# What the app's tsconfig leaves out, so its typecheck never reads them.
UNTYPED="tests vitest.config.ts"
# Read by the checks, but kept out of the image by .dockerignore.
UNBUILT="tests .github .gitignore .prettierrc.json .prettierignore tsconfig.tests.json vitest.config.ts docker-compose.yml"

# The head of this workflow's last green push run: a red or superseded run hides no change.
# A manual run has no base, and neither has a push GitHub cannot answer for: both run everything.
base=
if [ "$GITHUB_EVENT_NAME" = push ]; then
  base=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/fly-deploy.yml/runs?branch=$GITHUB_REF_NAME&event=push&status=success&per_page=1" \
    --jq '.workflow_runs[0].head_sha // empty') || base=
fi
echo "Measured from ${base:-nothing, so everything runs}."
# True unless every change since the base sits under the given paths.
# A diff git cannot make counts as a change, and so does a path on no list.
beyond() {
  local path specs=(.)
  [ -n "$base" ] || return 0
  for path in $1; do specs+=(":(exclude)$path"); done
  ! git diff --quiet "$base" HEAD -- "${specs[@]}"
}
answer() { if beyond "$1"; then echo true; else echo false; fi; }
checks=$(answer "$UNCHECKED")
code=$(answer "$UNCHECKED $UNLINTED")
app=$(answer "$UNCHECKED $UNLINTED $UNTYPED")
image=$(answer "$UNCHECKED $UNBUILT")
{
  echo "checks=$checks"
  echo "code=$code"
  echo "app=$app"
  echo "image=$image"
} | tee -a "$GITHUB_OUTPUT"
if [ "$checks" = false ]; then
  echo "Nothing a check reads changed since $base: no checks, no build, no release." >> "$GITHUB_STEP_SUMMARY"
elif [ "$image" = false ]; then
  echo "Nothing in the image changed since $base: the checks run, nothing is built or released." >> "$GITHUB_STEP_SUMMARY"
fi
