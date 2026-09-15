#!/usr/bin/env bash
# Two simultaneous Tag creates, one slot: exactly one must win.
#
# This is the test the whole entitlement lock exists for, and it cannot be
# written inside a single SQL session. It lived in test-tag-limits.sql using
# dblink, which opens connections from *inside* the server -- and that cannot
# work on a hosted PostgreSQL: there `postgres` is not a superuser, dblink
# refuses a non-superuser connection unless a password was genuinely exchanged,
# and every route into the server from within it is trust authentication.
#
# Two concurrent sessions are a client-side concern. The caller already holds
# credentials that work, so the race runs as two real psql processes.
#
# Called with the database name; libpq variables are already set by the harness.
set -uo pipefail

DB="${1:?usage: test-tag-race.sh <database>}"
ORG=cccccccc-0000-0000-0000-00000000000c
LOC=c10c0000-0000-0000-0000-00000000000c
USR=33333333-3333-3333-3333-333333333333

q() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

# Starter allows 3. Two already exist, so exactly one slot is left.
if ! q <<SQL
insert into auth.users (id, email) values ('$USR', 'racer@example.test');
insert into public.organizations (id, name, slug) values ('$ORG', 'Org C', 'org-c');
insert into public.organization_members (org_id, user_id, role, status, joined_at)
    values ('$ORG', '$USR', 'owner', 'active', now());
insert into public.locations (id, org_id, name) values ('$LOC', '$ORG', 'Main');
select public.rpc_set_entitlement('$ORG', 'starter', 'active', 'manual', null, null);
insert into public.review_stands
    (org_id, location_id, public_token_hash, public_token_prefix, label, status,
     public_token_encrypted, token_encryption_key_version)
values ('$ORG', '$LOC', 'c-hash-1', 'cccc01', 'existing one', 'active', 'cipher-1', 1),
       ('$ORG', '$LOC', 'c-hash-2', 'cccc02', 'existing two', 'active', 'cipher-2', 1);
SQL
then
  echo "FAIL: could not create fixtures"
  exit 1
fi

racer() { # $1 = label, $2 = token suffix, $3 = seconds to hold the transaction
  q >/dev/null 2>&1 <<SQL
set request.jwt.claim.sub = '$USR';
begin;
select public.rpc_create_stand('$ORG', '$LOC', '$1', 'c-hash-$2', 'ccr$2',
                               1::smallint, null, 'cipher-$2', 1::smallint);
select pg_sleep($3);
commit;
SQL
}

# Racer one takes the entitlement lock and holds it. Racer two enters the same
# function while it is held, and must still be inside when we look.
racer "racer one" r1 3 & PID1=$!
sleep 1
racer "racer two" r2 0 & PID2=$!

# Prove racer two is *blocked*, not merely later. If the cap were advisory it
# would sail past and insert a fourth Tag.
sleep 1
BLOCKED=$(q -c "
  select count(*) from pg_stat_activity
   where datname = '$DB' and wait_event_type = 'Lock' and state = 'active'")

wait $PID1; OK1=$?
wait $PID2; OK2=$?

LIVE=$(q -c "select count(*) from public.review_stands
              where org_id = '$ORG' and status <> 'retired'")
WINS=0
[ "$OK1" -eq 0 ] && WINS=$((WINS + 1))
[ "$OK2" -eq 0 ] && WINS=$((WINS + 1))

if [ "${BLOCKED:-0}" -lt 1 ]; then
  echo "FAIL: the second create was never blocked -- the cap is not serialised"
  exit 1
fi
if [ "$LIVE" -ne 3 ]; then
  echo "FAIL: starter allows 3, org holds $LIVE (exit codes: $OK1 / $OK2)"
  exit 1
fi
if [ "$WINS" -ne 1 ]; then
  echo "FAIL: expected exactly one winner, got $WINS (exit codes: $OK1 / $OK2)"
  exit 1
fi

echo "PASS concurrency: second create blocked at the lock, then refused; cap held at 3"
