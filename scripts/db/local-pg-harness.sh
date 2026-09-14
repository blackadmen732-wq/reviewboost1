#!/usr/bin/env bash
# Local migration-chain harness.
#
# CI proves the chain with `supabase db reset`, which needs Docker. Where Docker
# is unavailable this runs the same chain against a plain PostgreSQL 16 server
# plus the smallest possible stand-in for the parts Supabase supplies: the
# `auth` schema, `auth.uid()`, and the Data API roles. It is not a substitute
# for CI -- it cannot prove PostgREST grants -- but it does prove that every
# file parses, applies in order, and leaves the schema the migrations describe.
#
# Subcommands:
#   chain      fresh apply x2, determinism diff, object counts   (default)
#   upgrade    apply to a cut point, insert production-shaped rows,
#              apply the rest, assert nothing was lost
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${PGHARNESS_DIR:-${TMPDIR:-/tmp}/rb-pg-harness}"
PGDATA="$WORK/data"
SOCK="$WORK/sock"
PORT="${PGHARNESS_PORT:-54329}"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"

export PATH="$BIN:$PATH"
export PGHOST="$SOCK"
export PGPORT="$PORT"
export PGUSER=postgres

# PostgreSQL refuses to run as root. In a container that is the only account
# there is, so re-exec the whole script as the unprivileged `postgres` account
# the server package already creates.
RUNAS="${PGHARNESS_USER:-postgres}"
if [ "$(id -u)" -eq 0 ]; then
  mkdir -p "$WORK"
  chown -R "$RUNAS" "$WORK"
  exec setpriv --reuid="$RUNAS" --regid="$RUNAS" --init-groups \
    env PATH="$PATH" PGHARNESS_DIR="$WORK" PGHARNESS_PORT="$PORT" \
        UPGRADE_CUT="${UPGRADE_CUT:-}" HOME="$WORK" \
    bash "$ROOT/scripts/db/local-pg-harness.sh" "$@"
fi

log() { printf '\n== %s\n' "$*"; }

harness_start() {
  rm -rf "${WORK:?}"/data "${WORK:?}"/sock
  mkdir -p "$PGDATA" "$SOCK"
  initdb -D "$PGDATA" -U postgres --auth=trust --no-sync -E UTF8 >/dev/null
  pg_ctl -D "$PGDATA" -l "$WORK/pg.log" -o "-k $SOCK -p $PORT -c listen_addresses=" -w start >/dev/null
}

harness_stop() {
  pg_ctl -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1 || true
}
trap harness_stop EXIT

supabase_shim() {
  psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$ROOT/scripts/db/supabase-shim.sql"
}

# apply_chain <db> [stop_after_version] [start_after_version]
apply_chain() {
  local db="$1" stop_after="${2:-}" start_after="${3:-}" applied=0 started=1
  [ -n "$start_after" ] && started=0
  for f in "$ROOT"/supabase/migrations/*.sql; do
    local version
    version="$(basename "$f" | cut -d_ -f1)"
    if [ "$started" -eq 0 ]; then
      [ "$version" = "$start_after" ] && started=1
      continue
    fi
    if ! psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$f" >/dev/null 2>"$WORK/err.txt"; then
      echo "FAIL applying $(basename "$f")" >&2
      sed -n '1,25p' "$WORK/err.txt" >&2
      return 1
    fi
    applied=$((applied + 1))
    if [ -n "$stop_after" ] && [ "$version" = "$stop_after" ]; then break; fi
  done
  echo "$applied"
}

schema_dump() {
  pg_dump -d "$1" -s --schema=public --schema=app --no-owner --no-acl \
    | grep -v '^--' | grep -v '^$' | grep -v '^\\\(un\)\?restrict '
}

counts() {
  psql -d "$1" -At -c "
    select 'tables     ' || count(*) from pg_tables where schemaname in ('public','app')
    union all select 'functions  ' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app')
    union all select 'policies   ' || count(*) from pg_policies where schemaname in ('public','app')
    union all select 'indexes    ' || count(*) from pg_indexes where schemaname in ('public','app')
    union all select 'rls tables ' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;
  "
}

cmd_chain() {
  harness_start

  log "Run 1: fresh database, apply every migration in order"
  createdb run1; supabase_shim run1
  echo "applied $(apply_chain run1) migration files"

  log "Run 2: second fresh database, identical chain (determinism)"
  createdb run2; supabase_shim run2
  echo "applied $(apply_chain run2) migration files"

  log "Schema comparison run1 vs run2"
  schema_dump run1 > "$WORK/run1.sql"
  schema_dump run2 > "$WORK/run2.sql"
  if diff -u "$WORK/run1.sql" "$WORK/run2.sql" > "$WORK/drift.diff"; then
    echo "identical ($(wc -l < "$WORK/run1.sql") lines of schema)"
  else
    echo "DRIFT between two fresh runs:" >&2
    head -60 "$WORK/drift.diff" >&2
    return 1
  fi

  log "Object counts"
  counts run1

  log "RESULT: chain applies cleanly and deterministically"
}

# The test CI does not do: migrate a database that already holds rows.
cmd_upgrade() {
  local cut="${UPGRADE_CUT:-20260902000700}"
  harness_start

  log "Base: apply chain through $cut"
  createdb up; supabase_shim up
  echo "applied $(apply_chain up "$cut") migration files"

  log "Seed production-shaped rows"
  psql -v ON_ERROR_STOP=1 -q -d up -f "$ROOT/scripts/db/seed-populated.sql"
  psql -d up -At -c "select 'orgs=' || (select count(*) from public.organizations)
                          || ' members=' || (select count(*) from public.organization_members)
                          || ' locations=' || (select count(*) from public.locations)
                          || ' stands=' || (select count(*) from public.review_stands)
                          || ' responses=' || (select count(*) from public.customer_responses)"

  log "Apply every remaining migration on top of the populated database"
  echo "applied $(apply_chain up "" "$cut") migration files"

  log "Assert nothing was lost and the new objects are usable"
  psql -v ON_ERROR_STOP=1 -q -d up -f "$ROOT/scripts/db/assert-populated-upgrade.sql"

  log "RESULT: populated database upgrades cleanly"
}

# Build a fresh migrated database and run an arbitrary SQL file against it.
# This is how the RLS / isolation / limit tests below get a real server.
cmd_sql() {
  local file="${2:?usage: $0 sql <file.sql>}"
  harness_start
  createdb t >/dev/null; supabase_shim t >/dev/null 2>&1
  apply_chain t >/dev/null
  psql -v ON_ERROR_STOP=1 -q -d t -f "$file"
}

case "${1:-chain}" in
  chain)   cmd_chain ;;
  upgrade) cmd_upgrade ;;
  sql)     cmd_sql "$@" ;;
  *) echo "usage: $0 [chain|upgrade]" >&2; exit 2 ;;
esac
