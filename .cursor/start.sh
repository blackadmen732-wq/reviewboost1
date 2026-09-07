#!/usr/bin/env bash
#
# Cloud Agent start phase — per-boot reconciliation. Runs every time the
# environment starts. Brings up Docker and the local Supabase stack, then writes
# frontend/.env.local so the dev server (a terminal) can connect.
#
# Fails closed throughout: a boot that reported success without Docker would
# hand the agent a web app that cannot reach a database.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/dev/tool-versions.sh
source "$REPO_ROOT/scripts/dev/tool-versions.sh"
# shellcheck source=../scripts/dev/docker-nested-vm.sh
source "$REPO_ROOT/scripts/dev/docker-nested-vm.sh"

echo "== Ensure Docker is running =="
if ! docker_daemon_responds; then
  # install.sh already wrote this, but a boot that lost /etc/docker would
  # otherwise come up on a storage driver that cannot mount here.
  docker_write_daemon_config
  docker_start_daemon
fi
docker_require_ready

# The bridge-netfilter bypass resets when br_netfilter is (re)loaded by the
# daemon, so re-apply it on every boot before starting containers.
docker_apply_bridge_netfilter_bypass

echo "== Start local Supabase (idempotent, CLI ${SUPABASE_CLI_VERSION}) =="
docker_run_in_group "cd $(printf '%q' "$REPO_ROOT") && $(supabase_cli_command) start"

echo "== Write frontend/.env.local =="
docker_run_in_group "bash $(printf '%q' "$REPO_ROOT/scripts/dev/setup-local-env.sh")"

echo "start.sh complete. Supabase Studio: http://localhost:54323"
