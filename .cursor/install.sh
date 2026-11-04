#!/usr/bin/env bash
#
# Cloud Agent install phase — durable, idempotent setup baked into the
# environment snapshot. Runs after the repository is checked out.
#
#   * Docker Engine, at the versions pinned in scripts/dev/tool-versions.sh
#   * fuse-overlayfs, the only storage driver that mounts in the nested VM
#   * Node dependencies for the web app and the mobile foundation
#   * Generated API types
#   * Pre-pulled Supabase images, so every later boot starts quickly
#
# Every step is mandatory and every step fails closed. This phase publishes a
# snapshot that later boots cannot repair, so an install that swallowed a failed
# package operation would hand out an environment where Supabase never starts
# while still reporting success.
#
# Per-boot work (starting dockerd, starting Supabase, the dev server) lives in
# start.sh and the terminals, not here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/dev/tool-versions.sh
source "$REPO_ROOT/scripts/dev/tool-versions.sh"
# shellcheck source=../scripts/dev/docker-nested-vm.sh
source "$REPO_ROOT/scripts/dev/docker-nested-vm.sh"

echo "== Docker Engine (pinned) =="
docker_install_engine
docker_install_storage_driver
docker_write_daemon_config
docker_grant_group_membership
docker_restart_daemon
docker_require_ready
docker_apply_bridge_netfilter_bypass

echo "== Web dependencies =="
( cd "$REPO_ROOT/frontend" && npm ci && npm run api:generate )

echo "== Mobile dependencies =="
( cd "$REPO_ROOT/apps/mobile" && npm ci )

# These public email templates are read by Kong as its own container user.
# Restricted cloud checkouts may create them mode 600, which makes Kong
# return 403 and Auth fall back to a link-only email instead of the code.
chmod 644 "$REPO_ROOT/supabase/templates/magic-link.html" "$REPO_ROOT/supabase/templates/confirmation.html"

echo "== Pre-pull Supabase images (CLI ${SUPABASE_CLI_VERSION}) =="
# Start the stack once so every image lands in the snapshot, then stop it: no
# process started here survives into a later boot. This doubles as the
# end-to-end proof that the storage driver and bridge settings above work, so a
# failure is fatal rather than a warning that boots inherit.
docker_run_in_group "cd $(printf '%q' "$REPO_ROOT") && $(supabase_cli_command) start"
docker_run_in_group "cd $(printf '%q' "$REPO_ROOT") && $(supabase_cli_command) stop --no-backup"

echo "install.sh complete."
