#!/usr/bin/env bash
#
# Prove SMS correctness with the fake provider / local DB only.
# Never talks to Twilio. Never uses a production database.
#
#   1) Vitest: lookup never sends; two exact bodies are unknown;
#      reconcile defers sid_conflict / ambiguous_match without release.
#   2) If local Supabase is up: pgTAP text_requests suite + a two-session
#      SID-claim race (exactly one consume).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../dev/tool-versions.sh
source "$REPO_ROOT/scripts/dev/tool-versions.sh"

cd "$REPO_ROOT"

echo "== Fake-provider / Twilio-adapter vitest (no network send) =="
(
  cd frontend
  npx vitest run \
    tests/unit/sms-provider.test.ts \
    tests/unit/sms-reconcile.test.ts \
    tests/unit/sms-dispatch.test.ts
)

psql_cmd() {
  if [[ -n "${SMS_PROVE_PSQL:-}" ]]; then
    # shellcheck disable=SC2086
    ${SMS_PROVE_PSQL} "$@"
  elif command -v psql >/dev/null 2>&1; then
    local db_url="${SMS_PROVE_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
    psql "$db_url" "$@"
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'supabase_db_reviewboost'; then
    docker exec -i supabase_db_reviewboost psql -U postgres -d postgres "$@"
  else
    return 127
  fi
}

if ! psql_cmd -Atqc "select 1" >/dev/null 2>&1; then
  echo "Local Supabase Postgres is not reachable — skip concurrent SID race."
  echo "Run \`supabase db reset && supabase test db\` when the stack is up."
  exit 0
fi

echo "== Concurrent SID claim race (two sessions, fake SIDs only) =="
psql_cmd -v ON_ERROR_STOP=1 -f - < "$REPO_ROOT/scripts/sms/prove-concurrent-sid-setup.sql"

OUT_A="$(mktemp)"
OUT_B="$(mktemp)"
psql_cmd -v ON_ERROR_STOP=1 -c \
  "select app.sms_reconcile_attach_sid(
      (select attempt_a from public.sms_prove_race),
      (select org_id from public.sms_prove_race),
      'fake_race_sid', 'delivered', null);" >"$OUT_A" &
PID_A=$!
psql_cmd -v ON_ERROR_STOP=1 -c \
  "select app.sms_reconcile_attach_sid(
      (select attempt_b from public.sms_prove_race),
      (select org_id from public.sms_prove_race),
      'fake_race_sid', 'delivered', null);" >"$OUT_B" &
PID_B=$!
wait "$PID_A"
wait "$PID_B"

echo "--- session A ---"
cat "$OUT_A"
echo "--- session B ---"
cat "$OUT_B"

psql_cmd -v ON_ERROR_STOP=1 -f - < "$REPO_ROOT/scripts/sms/prove-concurrent-sid-assert.sql"

echo "SMS correctness prove: no duplicate SID claim, no double consume."
