#!/usr/bin/env bash
#
# Cloud Agent start phase — per-boot reconciliation. Runs every time the
# environment starts. Brings up Docker and the local Supabase stack, then
# writes frontend/.env.local so the dev server (a terminal) can connect.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Ensure Docker is running =="
sudo service docker start || true
for _ in $(seq 1 60); do
  if sudo docker info >/dev/null 2>&1; then break; fi
  sleep 1
done
sudo docker info >/dev/null 2>&1 || { echo "Docker daemon did not become ready." >&2; exit 1; }

# The bridge-netfilter bypass resets when br_netfilter is (re)loaded by the
# daemon, so re-apply it on every boot before starting containers.
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1 || true
sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true

echo "== Start local Supabase (idempotent) =="
sg docker -c "cd '$REPO_ROOT' && npx --yes supabase start"

echo "== Write frontend/.env.local =="
sg docker -c "bash '$REPO_ROOT/scripts/dev/setup-local-env.sh'"

echo "start.sh complete. Supabase Studio: http://localhost:54323"
