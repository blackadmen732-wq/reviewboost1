#!/usr/bin/env bash
# Run both CI secret scanners locally, with their exact rules.
#
# There are two, and they do not agree: ci.yml excludes `*.example` from the
# live-key pattern and backend-database.yml does not. That difference is how a
# documentation comment reading "live keys (sk_live_...)" in an .env.example
# turns one job red and leaves the other green. Reproducing both here means the
# disagreement is visible before a push instead of after one.
#
# The rule when this fires on an example or a comment is to change the
# credential-shaped string -- `sk_test_example_not_a_secret`,
# `whsec_example_not_a_secret` -- never to widen the scanner.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

found=0
report() { echo "::error::$1"; found=1; }

echo "== ci.yml: secrets =="
git grep -nIE '(SUPABASE_SERVICE_ROLE_KEY|PII_ENCRYPTION_KEY|TOKEN_DIGEST_KEY|ENCRYPTION_KEY)=.+' \
  -- ':!*.example' ':!*.md' ':!docs/**' ':!.github/**' && report "A populated secret assignment is committed."
git grep -nIE '(eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,})' \
  -- ':!*.example' ':!*.md' ':!.github/**' && report "A JWT token appears to be committed."
git grep -nIE '(sk_live_[A-Za-z0-9]{20,}|re_[A-Za-z0-9_]{20,})' \
  -- ':!*.md' ':!.githooks/**' && report "A live API key appears to be committed."

echo "== backend-database.yml: No committed secrets =="
# Note the missing ':!*.example' compared with the job above.
git grep -nIE '(sk_live_|re_[A-Za-z0-9_]{20,}|SK[0-9a-f]{32}|AC[0-9a-f]{32}|ghp_[A-Za-z0-9]{30,})' \
  -- ':!*.md' ':!.github/**' ':!.githooks/**' && report "A live credential appears to be committed."
git grep -nIE '^(SUPABASE_SERVICE_ROLE_KEY|CUSTOMER_NOTE_ENCRYPTION_KEY)=.+' \
  -- ':!*.example' ':!*.md' ':!docs/**' && report "A populated secret assignment is committed."
git grep -nI 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY' \
  -- ':!*.md' ':!.github/**' ':!*.ts' && report "The service-role key must never carry the NEXT_PUBLIC_ prefix."

if [ "$found" -eq 1 ]; then
  echo "SECRET SCAN FAILED"
  exit 1
fi
echo "No committed secrets found (both scanners)."
