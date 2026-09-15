#!/usr/bin/env bash
#
# Race the limits that cost money.
#
# pgTAP runs inside one transaction, so it can prove a cap is checked and never
# that the check survives two requests arriving at once. This launches real
# concurrent sessions against the local cluster and asserts the database — not
# an HTTP pre-check — is what holds the line.
#
# Usage: scripts/backend/concurrency-proof.sh
# Requires: scripts/backend/local-postgres.sh reset

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGPORT="${RB_PGPORT:-55432}"
PGDB="${RB_PGDB:-reviewboost}"
RACERS="${RB_RACERS:-8}"

psql_db() {
    psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$PGDB" "$@"
}

ORG="00000000-0000-0000-0000-00000000cafe"
OWNER="00000000-0000-0000-0000-00000000beef"
LOCATION="00000000-0000-0000-0000-00000000face"

cleanup() {
    psql_db -c "delete from public.organizations where id = '$ORG'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Seeding a Starter business with 3 Tag slots, two already used..."
cleanup
psql_db >/dev/null <<SQL
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('$OWNER', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'race@test', 'x', now(), now())
on conflict (id) do nothing;

insert into public.organizations (id, name, slug, status)
values ('$ORG', 'Race Co', 'race-co-$(date +%s)', 'active');

insert into public.organization_members (org_id, user_id, role, status)
values ('$ORG', '$OWNER', 'owner', 'active');

update public.entitlement_snapshots
   set plan_id = 'starter', status = 'active', source = 'concurrency-proof'
 where org_id = '$ORG';

insert into public.locations (id, org_id, name, google_review_url, status)
values ('$LOCATION', '$ORG', 'Race Main', 'https://g.page/r/race/review', 'active');

insert into public.review_stands
    (org_id, location_id, public_token_hash, public_token_prefix, status, public_token_key_version)
values
    ('$ORG', '$LOCATION', 'race-existing-1', 'race0001', 'active', 1),
    ('$ORG', '$LOCATION', 'race-existing-2', 'race0002', 'active', 1);
SQL

echo "Launching $RACERS concurrent Tag creates against 1 remaining slot..."
outdir="$(mktemp -d)"
for i in $(seq 1 "$RACERS"); do
    (
        # `set -e` is off inside this subshell on purpose: a refused create is
        # the expected outcome for most racers, and aborting here would skip
        # recording it and make a silent miss look like a refusal.
        set +e
        psql -X -q -t -A -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$PGDB" <<SQL >"$outdir/$i.out" 2>&1
select set_config('request.jwt.claims',
    json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, false);
set role authenticated;
select public.rpc_create_stand(
    '$ORG'::uuid,
    '$LOCATION'::uuid,
    'Racer $i',
    'race-new-hash-$i',
    'racer$(printf '%03d' "$i")',
    1::smallint,
    'race-req-$i',
    'v1:aXYtcmFjZXI=:Y3QtcmFjZXItcGFkZGluZw==:dGFnLXJhY2Vy',
    1::smallint);
SQL
        echo "$?" > "$outdir/$i.code"
    ) &
done
wait

created=0
refused=0
for i in $(seq 1 "$RACERS"); do
    if [ "$(cat "$outdir/$i.code")" = "0" ]; then
        created=$((created + 1))
    else
        refused=$((refused + 1))
        if ! grep -q 'tag_limit_reached' "$outdir/$i.out"; then
            echo "FAIL: racer $i failed for a reason other than the cap:"
            sed -n '1,5p' "$outdir/$i.out"
            exit 1
        fi
    fi
done

total="$(psql_db -t -A -c "select count(*) from public.review_stands where org_id = '$ORG' and status <> 'retired'")"
rm -rf "$outdir"

echo "created=$created refused=$refused total_tags=$total"

failures=0
if [ "$created" -ne 1 ]; then
    echo "FAIL: expected exactly 1 create to win the last slot, got $created."
    failures=1
fi
if [ "$total" -ne 3 ]; then
    echo "FAIL: a Starter business ended with $total Tags; the cap is 3."
    failures=1
fi
if [ "$refused" -ne $((RACERS - 1)) ]; then
    echo "FAIL: expected $((RACERS - 1)) refusals, got $refused."
    failures=1
fi

if [ "$failures" -ne 0 ]; then
    exit 1
fi

echo "ok    $RACERS concurrent creates, 1 slot, 1 winner, cap held by the database."

# ---------------------------------------------------------------- credit ----
#
# The other race that costs money: several sends reaching for the last
# segments at once. Over-reserving here is a message a business is billed for
# and did not buy.

echo
echo "Seeding 3 monthly and 2 purchased segments — 5 in total..."
psql_db >/dev/null <<SQL
select app.sms_grant_credits('$ORG', 'monthly', 3, 'invoice', 'race-invoice', now() + interval '30 days', null);
select app.sms_grant_credits('$ORG', 'purchased', 2, 'purchase', 'race-purchase', null, null);
SQL

echo "Launching $RACERS concurrent 2-segment reservations against 5 segments..."
outdir="$(mktemp -d)"
for i in $(seq 1 "$RACERS"); do
    (
        set +e
        psql -X -q -t -A -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$PGDB" <<SQL >"$outdir/$i.out" 2>&1
select case when reserved then 'reserved' else 'refused' end
  from app.sms_quota_reserve('$ORG'::uuid, 2, 'race-reservation-key-$i', null);
SQL
        echo "$?" > "$outdir/$i.code"
    ) &
done
wait

reserved=0
for i in $(seq 1 "$RACERS"); do
    if grep -q 'reserved' "$outdir/$i.out" 2>/dev/null; then
        reserved=$((reserved + 1))
    fi
done
rm -rf "$outdir"

read -r monthly purchased total < <(
    psql_db -t -A -F' ' -c "select monthly, purchased, total from app.sms_balance('$ORG')"
)
held="$(psql_db -t -A -c "select coalesce(sum(segments), 0) from public.sms_reservation_slices where org_id = '$ORG' and status = 'held'")"
overspent="$(psql_db -t -A -c "select count(*) from public.sms_credit_grants where org_id = '$ORG' and consumed + reserved > segments")"

echo "reserved=$reserved held_segments=$held remaining monthly=$monthly purchased=$purchased total=$total"

credit_failures=0
# Five segments, two per reservation: exactly two can win.
if [ "$reserved" -ne 2 ]; then
    echo "FAIL: expected exactly 2 of $RACERS reservations to win 5 segments, got $reserved."
    credit_failures=1
fi
if [ "$held" -ne 4 ]; then
    echo "FAIL: expected 4 segments held, got $held."
    credit_failures=1
fi
if [ "$overspent" -ne 0 ]; then
    echo "FAIL: $overspent grant(s) were overspent."
    credit_failures=1
fi
# Monthly is spent first: 4 taken from 3 monthly + 1 purchased leaves 0 and 1.
if [ "$monthly" -ne 0 ] || [ "$purchased" -ne 1 ]; then
    echo "FAIL: expected monthly=0 purchased=1 after spending monthly first; got $monthly and $purchased."
    credit_failures=1
fi

if [ "$credit_failures" -ne 0 ]; then
    exit 1
fi

echo "ok    $RACERS concurrent reservations, 5 segments, 2 winners, monthly spent first."
