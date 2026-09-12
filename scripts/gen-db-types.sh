#!/usr/bin/env bash
set -euo pipefail

# Generate TypeScript types from the Supabase schema.
#
# Usage:
#   Local:  ./scripts/gen-db-types.sh          (uses local Supabase)
#   CI:     ./scripts/gen-db-types.sh --check   (fails if types are stale)
#
# Requires: supabase CLI (npx supabase) and a running local instance or
# SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN for remote generation.

OUTFILE="frontend/lib/database.types.ts"

if [[ -n "${SUPABASE_PROJECT_REF:-}" ]] && [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Generating types from remote project ${SUPABASE_PROJECT_REF}..."
  npx supabase gen types typescript \
    --project-id "$SUPABASE_PROJECT_REF" \
    > "$OUTFILE"
else
  echo "Generating types from local Supabase..."
  npx supabase gen types typescript \
    --local \
    > "$OUTFILE"
fi

echo "Types written to $OUTFILE"

if [[ "${1:-}" == "--check" ]]; then
  if git diff --quiet "$OUTFILE"; then
    echo "Types are up to date."
  else
    echo "::error::Database types are stale. Run ./scripts/gen-db-types.sh and commit."
    git diff "$OUTFILE"
    exit 1
  fi
fi
