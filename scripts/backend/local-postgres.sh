#!/usr/bin/env bash
#
# Run the ReviewBoost migrations and pgTAP suites against a plain PostgreSQL 16
# server, with no Docker and no Supabase CLI.
#
# WHY THIS EXISTS
# ---------------
# `supabase start` needs to pull container images. Any environment without
# Docker, or behind an egress policy that blocks the container registry, cannot
# run a single line of this project's SQL — which is most of its security. This
# script reproduces the parts of a Supabase database the migrations actually
# depend on (four roles, an `auth` schema with `auth.uid()`, pgcrypto in
# `extensions`) and nothing else, so migrations and pgTAP can run anywhere a
# PostgreSQL server and the pgTAP extension are installed.
#
# It is a development and CI-fallback tool. `supabase db reset` remains the
# reference: this shim can only prove the SQL is correct, never that Supabase's
# own platform pieces agree with it.
#
# `test` assumes a freshly reset database, exactly as `supabase test db` does
# after `supabase db reset`. Some suites assert over unscoped rows, so leftover
# data from another run makes them fail for a reason that has nothing to do
# with the code — which is why `upgrade` puts the database back when it is
# done rather than leaving its fixtures behind.
#
# Usage:
#   scripts/backend/local-postgres.sh start          # start a throwaway cluster
#   scripts/backend/local-postgres.sh reset          # migrations from empty
#   scripts/backend/local-postgres.sh test           # pgTAP suites (fresh DB)
#   scripts/backend/local-postgres.sh upgrade <base> [populated|hosted]
#                                                    # populated-upgrade proof
#   scripts/backend/local-postgres.sh stop
#
# Environment:
#   RB_PGPORT   port for the throwaway cluster (default 55432)
#   RB_PGDATA   data directory (default /var/lib/postgresql/reviewboost-local)
#   RB_PGDB     database name (default reviewboost)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGPORT="${RB_PGPORT:-55432}"
PGDATA="${RB_PGDATA:-/var/lib/postgresql/reviewboost-local}"
PGDB="${RB_PGDB:-reviewboost}"
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"

as_postgres() {
    if [ "$(id -u)" -eq 0 ]; then
        su postgres -c "$1"
    else
        bash -c "$1"
    fi
}

psql_db() {
    PGPASSWORD="" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$PGDB" "$@"
}

start_cluster() {
    if "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null; then
        echo "PostgreSQL already listening on $PGPORT."
        return 0
    fi
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
        echo "Initialising cluster at $PGDATA"
        as_postgres "mkdir -p '$PGDATA' && chmod 700 '$PGDATA'"
        as_postgres "'$PG_BIN/initdb' -D '$PGDATA' -U postgres --auth=trust --no-sync -E UTF8" >/dev/null
    fi
    as_postgres "'$PG_BIN/pg_ctl' -D '$PGDATA' -o '-p $PGPORT -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off -c synchronous_commit=off' -w -l '$PGDATA/server.log' start"
    echo "PostgreSQL listening on 127.0.0.1:$PGPORT"
}

stop_cluster() {
    as_postgres "'$PG_BIN/pg_ctl' -D '$PGDATA' -m immediate -w stop" || true
}

# The smallest Supabase-shaped environment the migrations need. Anything the
# migrations do not reference is deliberately absent: a shim that invents more
# than the real platform provides would hide a missing grant.
bootstrap_sql() {
    cat <<'SQL'
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticator') then
        create role authenticator noinherit login;
    end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Only the columns the migrations and the pgTAP fixtures actually use.
create table if not exists auth.users (
    id                  uuid primary key,
    instance_id         uuid,
    aud                 text,
    role                text,
    email               text,
    encrypted_password  text,
    raw_user_meta_data  jsonb not null default '{}'::jsonb,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- Verbatim behaviour of Supabase's auth.uid(): the subject claim PostgREST
-- sets on the request, or null when there is none.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
$$;
SQL
}

reset_db() {
    PGPASSWORD="" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres \
        -c "drop database if exists $PGDB (force)" -c "create database $PGDB"
    # Supabase's image puts `extensions` on the search path; pgTAP installs
    # there, so `plan()` has to resolve without every suite qualifying it.
    PGPASSWORD="" psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres \
        -c "alter database $PGDB set search_path to \"\$user\", public, extensions"
    bootstrap_sql | psql_db -q
    apply_migrations until "${1:-}"
}

# `until` stops after that migration; `after` skips everything up to and
# including it. The upgrade proof needs both halves of the same list.
apply_migrations() {
    local mode="${1:-until}"
    # Compared by version, so `20260901213000` and
    # its full filename (`20260901213000_<name>.sql`) both mean
    # "through that migration". Comparing whole filenames silently dropped
    # the named migration itself from `until` and ran it again under `after`.
    local marker="${2:-}"
    marker="${marker##*/}"
    marker="${marker%%_*}"
    local applied=0
    for file in "$REPO_ROOT"/supabase/migrations/*.sql; do
        local name version
        name="$(basename "$file")"
        version="${name%%_*}"
        if [ -n "$marker" ]; then
            if [ "$mode" = "until" ] && [[ "$version" > "$marker" ]]; then
                continue
            fi
            if [ "$mode" = "after" ] && [[ ! "$version" > "$marker" ]]; then
                continue
            fi
        fi
        psql_db -q -f "$file" >/dev/null
        applied=$((applied + 1))
    done
    echo "Applied $applied migration(s)${marker:+ $mode $marker}."
}

# The populated-upgrade proof: a realistic old database, migrated forward, then
# asked whether it still holds everything it held before. A fresh-database
# reset can never answer that question.
upgrade_proof() {
    local baseline="${1:?baseline migration required}"
    # Which fixture pair: `populated` (pre-destination, with the old SMS
    # ledger) or `hosted` (the schema the hosted ledger records).
    local fixture="${2:-populated}"
    start_cluster >/dev/null
    reset_db "$baseline"
    echo "Loading the pre-upgrade database ($fixture)..."
    psql_db -q -f "$REPO_ROOT/supabase/upgrade/${fixture}_baseline.sql" >/dev/null
    apply_migrations after "$baseline"
    local output
    output="$(psql_db -q --no-align --tuples-only -f "$REPO_ROOT/supabase/upgrade/${fixture}_upgrade_test.sql" 2>&1)" || {
        echo "$output" | tail -30
        return 1
    }
    if echo "$output" | grep -qE '^not ok|^# Looks like'; then
        echo "$output" | grep -E '^not ok|^# ' | head -40
        return 1
    fi
    echo "ok    $fixture upgrade ($(echo "$output" | grep -cE '^ok [0-9]+') assertions)"

    # Leave the cluster as every other command expects to find it. The proof's
    # fixtures are realistic old data, and a suite that counts rows without
    # scoping them would otherwise fail on the next run for no real reason.
    echo "Restoring a fresh database..."
    reset_db >/dev/null
}

run_tests() {
    local failures=0
    for file in "$REPO_ROOT"/supabase/tests/*.sql; do
        local name output
        name="$(basename "$file")"
        # TAP output only survives psql unaligned and tuples-only; anything
        # else pads the lines and a `^not ok` check silently passes forever.
        if ! output="$(psql_db -q --no-align --tuples-only -f "$file" 2>&1)"; then
            echo "FAIL  $name"
            echo "$output" | tail -30
            failures=$((failures + 1))
            continue
        fi
        local assertions
        assertions="$(echo "$output" | grep -cE '^ok [0-9]+' || true)"
        # `# Looks like you planned N but ran M` is how pgTAP reports a plan
        # mismatch, and it is not a `not ok` line: a suite that quietly runs
        # more or fewer assertions than it planned would otherwise pass.
        if echo "$output" | grep -qE '^not ok|^# Looks like' || [ "$assertions" -eq 0 ]; then
            echo "FAIL  $name"
            echo "$output" | grep -E '^not ok|^# |ERROR' | head -30
            failures=$((failures + 1))
            continue
        fi
        echo "ok    $name ($assertions assertions)"
    done
    if [ "$failures" -gt 0 ]; then
        echo "$failures suite(s) failed."
        return 1
    fi
    echo "All pgTAP suites passed."
}

case "${1:-}" in
    start) start_cluster ;;
    stop) stop_cluster ;;
    reset) start_cluster >/dev/null; reset_db "${2:-}" ;;
    migrate) apply_migrations "${2:-until}" "${3:-}" ;;
    upgrade) upgrade_proof "${2:-}" "${3:-populated}" ;;
    test) run_tests ;;
    psql) shift; psql_db "$@" ;;
    *)
        echo "usage: $0 {start|stop|reset [until-migration]|migrate [until|after] [migration]|upgrade <baseline-migration> [populated|hosted]|test|psql}" >&2
        exit 64
        ;;
esac
