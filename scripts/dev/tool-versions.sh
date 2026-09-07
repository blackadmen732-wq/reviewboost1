#!/usr/bin/env bash
#
# Pinned versions of the external tools the development environment installs.
#
# Two builds of the same commit must install the same tools, so nothing here is
# resolved from a moving target: no `latest`, no unversioned `npx`, and no
# convenience installer that follows upstream's current stable release. Change a
# version by editing this file in a reviewed commit.
#
# Rationale, the validated combination, and the update procedure:
#   docs/dev/CLOUD_AGENT_ENVIRONMENT.md
#
# Sourced — never executed — by .cursor/install.sh, .cursor/start.sh and
# scripts/dev/setup-local-env.sh.

# shellcheck disable=SC2034 # every value here is consumed by the sourcing script

# ------------------------------------------------------------ Supabase CLI --

# Runs the local Supabase stack (`supabase start`, `status`, `stop`) and must
# understand supabase/config.toml.
SUPABASE_CLI_VERSION="2.117.0"

# ------------------------------------------------------------ Docker Engine --

# Installed from Docker's own apt repository. `apt-cache madison docker-ce`
# lists the version strings available for the distribution codename; they encode
# the codename, so they change when the base image's Ubuntu release changes.
DOCKER_APT_KEY_URL="https://download.docker.com/linux/ubuntu/gpg"
DOCKER_APT_KEY_FINGERPRINT="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
DOCKER_CE_VERSION="5:29.8.0-1~ubuntu.24.04~noble"
DOCKER_CE_CLI_VERSION="5:29.8.0-1~ubuntu.24.04~noble"
CONTAINERD_VERSION="2.3.4-2~ubuntu.24.04~noble"
DOCKER_BUILDX_PLUGIN_VERSION="0.37.0-1~ubuntu.24.04~noble"
DOCKER_COMPOSE_PLUGIN_VERSION="5.5.1-1~ubuntu.24.04~noble"

# The storage driver the daemon runs on inside the nested VM. Supplied by the
# Ubuntu archive, which withdraws superseded versions as security updates land,
# so this one is not version-pinned — pinning it would make the build fail the
# day the archive rotates. The validated version is recorded in the doc above.
FUSE_OVERLAYFS_PACKAGE="fuse-overlayfs"

# -------------------------------------------------------------- Invocation --

# Run the pinned Supabase CLI.
#
# SUPABASE_CLI_BIN substitutes an already-resolved executable. The automated
# tests use it to install a stub; an environment that carries the pinned CLI on
# disk can use it to skip npx entirely. Everything else resolves the exact
# pinned release, which npx caches after the first run.
supabase_cli() {
  if [[ -n "${SUPABASE_CLI_BIN:-}" ]]; then
    "${SUPABASE_CLI_BIN}" "$@"
  else
    npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
  fi
}

# The same invocation as a single string, for the places that have to hand a
# command to another shell (`sg docker -c`).
supabase_cli_command() {
  if [[ -n "${SUPABASE_CLI_BIN:-}" ]]; then
    printf '%q' "${SUPABASE_CLI_BIN}"
  else
    printf 'npx --yes %q' "supabase@${SUPABASE_CLI_VERSION}"
  fi
}
