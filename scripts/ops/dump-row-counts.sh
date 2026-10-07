#!/usr/bin/env bash
# Rows per table in a `supabase db dump --use-copy --data-only` file, as
# "<table>\t<rows>". In COPY text format a row is exactly one line (newlines
# inside values are escaped), and a block ends at a line holding only "\.".
set -euo pipefail

awk '
  /^COPY / { table = $2; rows = 0; inside = 1; next }
  inside && $0 == "\\." { print table "\t" rows; inside = 0; next }
  inside { rows++ }
' "${1:?data.sql}"
