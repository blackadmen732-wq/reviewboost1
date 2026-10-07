#!/usr/bin/env bash
# Restore a backup into an empty Supabase database and prove every row came
# back. A backup nobody has restored is a hope, not a backup.
#
#   scripts/ops/restore-drill.sh <dir with roles.sql, schema.sql, data.sql> <db-url>
#
# The restore is Supabase's documented one (roles, schema, then data with
# triggers off, in one transaction that stops at the first error). The check
# compares, table by table, the rows in the dump with the rows in the restored
# database, for the public schema and auth.users — tables an empty project
# starts without, so the counts must be equal, not merely close.
set -euo pipefail

dir=${1:?backup directory}
db_url=${2:?database url}

started=$(date +%s)

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --quiet \
  --file "$dir/roles.sql" \
  --file "$dir/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$dir/data.sql" \
  --dbname "$db_url" >/dev/null

restored=$(date +%s)
echo "Restore finished in $((restored - started))s."

failed=0
checked=0
while IFS=$'\t' read -r table expected; do
  case "$table" in
    '"public".'* | public.* | '"auth"."users"' | auth.users) ;;
    *) continue ;;
  esac
  actual=$(psql --tuples-only --no-align --dbname "$db_url" --command "select count(*) from $table")
  checked=$((checked + 1))
  if [[ "$actual" != "$expected" ]]; then
    echo "::error::$table: $expected rows in the backup, $actual after restore"
    failed=1
  else
    echo "  $table: $actual rows"
  fi
done < <(bash "$(dirname "$0")/dump-row-counts.sh" "$dir/data.sql")

if [[ "$checked" -eq 0 ]]; then
  echo "::error::No public tables were found in the backup to compare"
  exit 1
fi

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "Restore drill passed: $checked tables, every row accounted for, in $((restored - started))s."
