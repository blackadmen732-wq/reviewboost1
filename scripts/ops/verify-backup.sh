#!/usr/bin/env bash
# Refuse a backup that is not one: a dump that "succeeds" against the wrong
# database, or an empty one, must fail the job rather than be kept as the
# copy someone restores from one day.
#
#   scripts/ops/verify-backup.sh <dir with roles.sql, schema.sql, data.sql>
#
# Prints how many rows of each table the dump holds (counts only, no data).
set -euo pipefail

dir=${1:?backup directory}

for file in roles.sql schema.sql data.sql; do
  if [[ ! -s "$dir/$file" ]]; then
    echo "::error::$file is missing or empty"
    exit 1
  fi
done

if ! grep -Eq 'CREATE TABLE (IF NOT EXISTS )?"?public"?\."?organizations"?' "$dir/schema.sql"; then
  echo "::error::schema.sql has no public.organizations table — this is not the ReviewBoost database"
  exit 1
fi

if ! grep -Eq '^COPY "?public"?\."?organizations"?' "$dir/data.sql"; then
  echo "::error::data.sql holds no public.organizations rows block"
  exit 1
fi

echo "Rows in this backup, per table:"
bash "$(dirname "$0")/dump-row-counts.sh" "$dir/data.sql" | sort | sed 's/^/  /'
