#!/usr/bin/env bash
# Run both CI secret scanners locally, with their exact rules.
#
# There are two, and they do not agree: ci.yml excludes `*.example` from the
# live-key pattern and backend-database.yml does not. That difference is how a
# documentation comment reading "live keys (sk_" "live_...)" in an .env.example
# turns one job red and leaves the other green. Reproducing both here means the
# disagreement is visible before a push instead of after one.
#
# The rule when this fires on an example or a comment is to change the
# credential-shaped string -- `sk_test_example_not_a_secret`,
# `whsec_example_not_a_secret` -- never to widen the scanner.
#
# WHY THE PATTERNS ARE ASSEMBLED FROM FRAGMENTS
# ---------------------------------------------
# The backend-database scanner greps every file that is not .md, .github/**, or
# .githooks/**, which includes this one. A scanner that spelled its own
# patterns out in full would fail on itself -- and the fix for that is the same
# rule as above: change the string, not the scanner. So every credential shape
# below is concatenated from pieces that are individually harmless.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1

found=0
report() { echo "::error::$1"; found=1; }

SK_LIVE="sk_""live_"
RESEND="re_""[A-Za-z0-9_]{20,}"
TWILIO_SID="AC""[0-9a-f]{32}"
TWILIO_KEY="SK""[0-9a-f]{32}"
GH_PAT="ghp_""[A-Za-z0-9]{30,}"
SERVICE_ROLE="SUPABASE_SERVICE_ROLE_KEY"
PUBLIC_PREFIXED="NEXT_PUBLIC_""$SERVICE_ROLE"
JWT_HEAD="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"

echo "== ci.yml: secrets =="
git grep -nIE "(${SERVICE_ROLE}|PII_ENCRYPTION_KEY|TOKEN_DIGEST_KEY|ENCRYPTION_KEY)=.+" \
  -- ':!*.example' ':!*.md' ':!docs/**' ':!.github/**' ':!scripts/dev/secret-scan.sh' \
  && report "A populated secret assignment is committed."

git grep -nIE "(${JWT_HEAD}\.[A-Za-z0-9_-]{20,})" \
  -- ':!*.example' ':!*.md' ':!.github/**' ':!scripts/dev/secret-scan.sh' \
  && report "A JWT token appears to be committed."

git grep -nIE "(${SK_LIVE}[A-Za-z0-9]{20,}|${RESEND})" \
  -- ':!*.md' ':!.githooks/**' ':!scripts/dev/secret-scan.sh' \
  && report "A live API key appears to be committed."

echo "== backend-database.yml: No committed secrets =="
# Note the missing ':!*.example' compared with the job above.
git grep -nIE "(${SK_LIVE}|${RESEND}|${TWILIO_KEY}|${TWILIO_SID}|${GH_PAT})" \
  -- ':!*.md' ':!.github/**' ':!.githooks/**' ':!scripts/dev/secret-scan.sh' \
  && report "A live credential appears to be committed."

git grep -nIE "^(${SERVICE_ROLE}|CUSTOMER_NOTE_ENCRYPTION_KEY)=.+" \
  -- ':!*.example' ':!*.md' ':!docs/**' ':!scripts/dev/secret-scan.sh' \
  && report "A populated secret assignment is committed."

git grep -nI "$PUBLIC_PREFIXED" \
  -- ':!*.md' ':!.github/**' ':!*.ts' ':!scripts/dev/secret-scan.sh' \
  && report "The service-role key must never carry the NEXT_PUBLIC_ prefix."

if [ "$found" -eq 1 ]; then
  echo "SECRET SCAN FAILED"
  exit 1
fi
echo "No committed secrets found (both scanners)."
