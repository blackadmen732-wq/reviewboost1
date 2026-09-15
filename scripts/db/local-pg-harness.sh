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
BIN="$(find /usr/lib/postgresql -mindepth 2 -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -1)"

export PATH="$BIN:$PATH"

# EXTERNAL=1 means a server is already running and the caller has pointed the
# standard libpq variables at it. Overwriting PGHOST here would send every psql
# to a socket this script never created -- which is exactly what happened the
# first time this ran in CI against Supabase's own PostgreSQL.
if [ "${PGHARNESS_EXTERNAL:-0}" != "1" ]; then
  export PGHOST="$SOCK"
  export PGPORT="$PORT"
  export PGUSER=postgres
fi

# PostgreSQL refuses to run as root. In a container that is the only account
# there is, so re-exec the whole script as the unprivileged `postgres` account
# the server package already creates.
RUNAS="${PGHARNESS_USER:-postgres}"
if [ "$(id -u)" -eq 0 ] && [ "${PGHARNESS_EXTERNAL:-0}" != "1" ]; then
  mkdir -p "$WORK"
  chown -R "$RUNAS" "$WORK"
  exec setpriv --reuid="$RUNAS" --regid="$RUNAS" --init-groups \
    env PATH="$PATH" PGHARNESS_DIR="$WORK" PGHARNESS_PORT="$PORT" \
        UPGRADE_CUT="${UPGRADE_CUT:-}" HOME="$WORK" \
    bash "$ROOT/scripts/db/local-pg-harness.sh" "$@"
fi

log() { printf '\n== %s\n' "$*"; }

# EXTERNAL=1 uses a server that is already running -- in CI, the one Supabase
# started -- via the standard libpq variables (PGHOST, PGPORT, PGUSER,
# PGPASSWORD). Same code path either way, so what CI proves is what this proves.
EXTERNAL="${PGHARNESS_EXTERNAL:-0}"

harness_start() {
  if [ "$EXTERNAL" = "1" ]; then
    mkdir -p "$WORK"
    psql -d postgres -c 'select 1' >/dev/null
    return
  fi
  rm -rf "${WORK:?}"/data "${WORK:?}"/sock
  mkdir -p "$PGDATA" "$SOCK"
  initdb -D "$PGDATA" -U postgres --auth=trust --no-sync -E UTF8 >/dev/null
  pg_ctl -D "$PGDATA" -l "$WORK/pg.log" -o "-k $SOCK -p $PORT -c listen_addresses=" -w start >/dev/null
}

harness_stop() {
  [ "$EXTERNAL" = "1" ] && return 0
  pg_ctl -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1 || true
}
trap harness_stop EXIT

# Each run gets its own database so an external server keeps whatever else is
# on it. Names are suffixed per invocation to survive repeated CI runs.
SUFFIX="${PGHARNESS_SUFFIX:-$$}"
db() { echo "rb_${1}_${SUFFIX}"; }

fresh_db() {
  local name="$1"
  dropdb --if-exists "$name" >/dev/null 2>&1 || true
  createdb "$name"
  supabase_shim "$name" >/dev/null 2>&1
}

supabase_shim() {
  psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$ROOT/scripts/db/supabase-shim.sql"
}

# apply_chain <db> [stop_after_version] [start_after_version]
apply_chain() {
  local db="$1" stop_after="${2:-}" start_after="${3:-}" applied=0 started=1 f version
  [ -n "$start_after" ] && started=0
  for f in "$ROOT"/supabase/migrations/*.sql; do
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

  local one two
  one="$(db run1)"; two="$(db run2)"

  log "Run 1: fresh database, apply every migration in order"
  fresh_db "$one"
  echo "applied $(apply_chain "$one") migration files"

  log "Run 2: second fresh database, identical chain (determinism)"
  fresh_db "$two"
  echo "applied $(apply_chain "$two") migration files"

  log "Schema comparison run1 vs run2"
  schema_dump "$one" > "$WORK/run1.sql"
  schema_dump "$two" > "$WORK/run2.sql"
  if diff -u "$WORK/run1.sql" "$WORK/run2.sql" > "$WORK/drift.diff"; then
    echo "identical ($(wc -l < "$WORK/run1.sql") lines of schema)"
  else
    echo "DRIFT between two fresh runs:" >&2
    head -60 "$WORK/drift.diff" >&2
    return 1
  fi

  log "Object counts"
  counts "$one"

  dropdb --if-exists "$one" >/dev/null 2>&1 || true
  dropdb --if-exists "$two" >/dev/null 2>&1 || true

  log "RESULT: chain applies cleanly and deterministically"
}

# The test CI does not do: migrate a database that already holds rows.
cmd_upgrade() {
  local cut="${UPGRADE_CUT:-20260902000700}" up
  cut="${cut:-20260902000700}"
  up="$(db upgrade)"
  harness_start

  log "Base: apply chain through $cut"
  fresh_db "$up"
  echo "applied $(apply_chain "$up" "$cut") migration files"

  log "Seed production-shaped rows"
  psql -v ON_ERROR_STOP=1 -q -d "$up" -f "$ROOT/scripts/db/seed-populated.sql"
  psql -d "$up" -At -c "select 'orgs=' || (select count(*) from public.organizations)
                          || ' members=' || (select count(*) from public.organization_members)
                          || ' locations=' || (select count(*) from public.locations)
                          || ' stands=' || (select count(*) from public.review_stands)
                          || ' responses=' || (select count(*) from public.customer_responses)"

  log "Apply every remaining migration on top of the populated database"
  echo "applied $(apply_chain "$up" "" "$cut") migration files"

  log "Assert nothing was lost and the new objects are usable"
  psql -v ON_ERROR_STOP=1 -q -d "$up" -f "$ROOT/scripts/db/assert-populated-upgrade.sql"

  dropdb --if-exists "$up" >/dev/null 2>&1 || true

  log "RESULT: populated database upgrades cleanly"
}

# Build a fresh migrated database and run an arbitrary SQL file against it.
# This is how the RLS / isolation / limit tests below get a real server.
cmd_sql() {
  local file="${2:?usage: $0 sql <file.sql>}" t
  t="$(db sql)"
  harness_start
  fresh_db "$t"
  apply_chain "$t" >/dev/null
  # The concurrency test opens its own connections with dblink, which runs
  # *inside* the server. So the address must be the server's view of itself,
  # not the client's: in CI the server is in a container, where the published
  # 127.0.0.1:54322 the runner connects to does not exist. The suite derives
  # host, port, database and user from the server's own settings.
  #
  # The one thing the server cannot tell it is the password, so that is the
  # only thing passed in.
  psql -v ON_ERROR_STOP=1 \
       -v seed="$ROOT/scripts/db/seed-populated.sql" \
       -v dbpassword="${PGPASSWORD:-}" \
       -q -d "$t" -f "$file"
  local status=$?
  dropdb --if-exists "$t" >/dev/null 2>&1 || true
  return $status
}

# Run the repository's pgTAP suites, the way `supabase test db` does: each file
# on its own freshly migrated database, and the TAP output judged on its own
# terms rather than on psql's exit code.
cmd_pgtap() {
  local t suite out bad; t="$(db pgtap)"; local failed=0
  harness_start

  for suite in "$ROOT"/supabase/tests/*.sql; do
    fresh_db "$t"
    apply_chain "$t" >/dev/null
    psql -q -d "$t" -c 'create extension if not exists pgtap;' >/dev/null 2>&1

    out="$(psql -X -q -t -A -d "$t" -f "$suite" 2>&1)"

    bad="$(printf '%s\n' "$out" | grep -E '^not ok|^# Looks like|Bad plan|^psql:.*ERROR' || true)"
    if [ -n "$bad" ]; then
      failed=1
      printf '\n== %s FAILED\n' "$(basename "$suite")"
      printf '%s\n' "$bad" | head -12
      # The assertion name usually sits on the failing line; show context.
      printf '%s\n' "$out" | grep -B2 -A6 '^not ok' | head -30
    else
      printf '== %-34s %s assertions\n' "$(basename "$suite")" \
        "$(printf '%s\n' "$out" | grep -c '^ok ')"
    fi
  done

  dropdb --if-exists "$t" >/dev/null 2>&1 || true
  if [ "$failed" -eq 0 ]; then log "RESULT: pgTAP suites pass"; else log "RESULT: pgTAP FAILURES"; return 1; fi
}

case "${1:-chain}" in
  chain)   cmd_chain ;;
  pgtap)   cmd_pgtap ;;
  upgrade) cmd_upgrade ;;
  sql)     cmd_sql "$@" ;;
  *) echo "usage: $0 [chain|upgrade]" >&2; exit 2 ;;
esac
