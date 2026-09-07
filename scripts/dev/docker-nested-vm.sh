#!/usr/bin/env bash
#
# Docker Engine setup for the nested Cloud Agent VM, shared by .cursor/install.sh
# (which bakes the result into the environment snapshot) and .cursor/start.sh
# (which reconciles it on every boot).
#
# Two nested-virtualisation quirks are handled here:
#
#   * The native overlayfs driver cannot mount inside the VM, so the daemon has
#     to run on fuse-overlayfs.
#   * Same-bridge container-to-container traffic is silently dropped while
#     bridge-netfilter is active — the TCP handshake succeeds and larger packets
#     vanish — so it is switched off before any container starts.
#
# Every function here fails closed. Local Supabase is unusable without Docker,
# so an install that reported success while one of these steps failed would
# publish a snapshot whose every later boot dies waiting for the daemon.
#
# Sourced — never executed. Requires scripts/dev/tool-versions.sh to be sourced
# first for the pinned package versions.

DOCKER_STORAGE_DRIVER="fuse-overlayfs"
DOCKER_READY_TIMEOUT_SECONDS="${DOCKER_READY_TIMEOUT_SECONDS:-60}"
DOCKER_DAEMON_CONFIG="/etc/docker/daemon.json"

docker_pinned_packages() {
  printf '%s\n' \
    "docker-ce=${DOCKER_CE_VERSION}" \
    "docker-ce-cli=${DOCKER_CE_CLI_VERSION}" \
    "containerd.io=${CONTAINERD_VERSION}" \
    "docker-buildx-plugin=${DOCKER_BUILDX_PLUGIN_VERSION}" \
    "docker-compose-plugin=${DOCKER_COMPOSE_PLUGIN_VERSION}"
}

# True when every pinned package is installed at exactly its pinned version.
# The base image usually already satisfies this, which keeps the install phase
# off the network entirely.
docker_packages_match_pins() {
  local spec name want have
  while read -r spec; do
    name="${spec%%=*}"
    want="${spec#*=}"
    if ! have="$(dpkg-query -W -f='${Version}' "$name" 2>/dev/null)"; then
      return 1
    fi
    [[ "$have" == "$want" ]] || return 1
  done < <(docker_pinned_packages)
}

# Trust Docker's apt repository, verifying the signing key against the pinned
# fingerprint before apt is ever told to trust it.
docker_configure_apt_repository() {
  local keyring="/etc/apt/keyrings/docker.asc"
  local tmp_key fingerprints codename

  if ! command -v gpg >/dev/null 2>&1; then
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gnupg
  fi

  tmp_key="$(mktemp)"
  curl -fsSL "$DOCKER_APT_KEY_URL" -o "$tmp_key"
  fingerprints="$(gpg --show-keys --with-colons "$tmp_key" | sed -n 's/^fpr:*\([0-9A-F]*\):$/\1/p')"
  if ! grep -qx "$DOCKER_APT_KEY_FINGERPRINT" <<<"$fingerprints"; then
    rm -f "$tmp_key"
    echo "Refusing to install Docker: the signing key at ${DOCKER_APT_KEY_URL} does not" >&2
    echo "carry the pinned fingerprint ${DOCKER_APT_KEY_FINGERPRINT}." >&2
    return 1
  fi

  sudo install -m 0755 -d /etc/apt/keyrings
  sudo install -m 0644 "$tmp_key" "$keyring"
  rm -f "$tmp_key"

  # shellcheck disable=SC1091 # provided by the distribution at runtime
  codename="$(. /etc/os-release && printf '%s' "${VERSION_CODENAME}")"
  printf 'deb [arch=%s signed-by=%s] https://download.docker.com/linux/ubuntu %s stable\n' \
    "$(dpkg --print-architecture)" "$keyring" "$codename" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
}

# Install Docker Engine at the pinned versions from Docker's apt repository.
#
# Deliberately not the convenience script at get.docker.com: that always
# installs upstream's current stable release, so rebuilding this commit later
# would produce a different engine than the one this environment was validated
# against.
docker_install_engine() {
  if docker_packages_match_pins; then
    echo "Docker Engine already at the pinned versions; nothing to install."
    return 0
  fi

  docker_configure_apt_repository
  sudo apt-get update
  # shellcheck disable=SC2046 # each pinned spec is a separate apt argument
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    --allow-downgrades -o Dpkg::Options::=--force-confold $(docker_pinned_packages)

  if ! docker_packages_match_pins; then
    echo "Docker Engine is not at the pinned versions after installation." >&2
    docker_pinned_packages >&2
    return 1
  fi
}

# fuse-overlayfs comes from the Ubuntu archive, which withdraws superseded
# versions, so it is installed unpinned but is mandatory: the daemon is
# configured to use it and cannot start without it.
docker_install_storage_driver() {
  if command -v fuse-overlayfs >/dev/null 2>&1; then
    echo "fuse-overlayfs present: $(fuse-overlayfs --version 2>&1 | tr '\n' ' ')"
    return 0
  fi

  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    -o Dpkg::Options::=--force-confold "$FUSE_OVERLAYFS_PACKAGE"

  if ! command -v fuse-overlayfs >/dev/null 2>&1; then
    echo "${FUSE_OVERLAYFS_PACKAGE} is required: the native overlayfs driver cannot" >&2
    echo "mount inside the nested VM, so Docker has no usable storage driver." >&2
    return 1
  fi
}

docker_write_daemon_config() {
  sudo mkdir -p "$(dirname "$DOCKER_DAEMON_CONFIG")"
  printf '{\n  "storage-driver": "%s"\n}\n' "$DOCKER_STORAGE_DRIVER" \
    | sudo tee "$DOCKER_DAEMON_CONFIG" >/dev/null
}

# `sg docker` and unsudoed docker commands need the invoking user in the group.
docker_grant_group_membership() {
  sudo usermod -aG docker "$(id -un)"
}

docker_daemon_responds() {
  sudo docker info >/dev/null 2>&1
}

docker_start_daemon() {
  sudo service docker start
}

# Restart a daemon that is already up so a changed storage driver takes effect.
docker_restart_daemon() {
  if docker_daemon_responds; then
    sudo service docker restart
  else
    docker_start_daemon
  fi
}

docker_dump_daemon_log() {
  local log="/var/log/docker.log"
  if sudo test -f "$log"; then
    echo "--- last 40 lines of ${log} ---" >&2
    sudo tail -n 40 "$log" >&2
  fi
}

# Prove Docker is actually usable, rather than assuming the start command
# implies it: the daemon must answer, and it must have come up on the storage
# driver the nested VM requires. A daemon that fell back to overlayfs answers
# `docker info` and then fails to create any container filesystem.
docker_require_ready() {
  local waited=0 driver

  while ! docker_daemon_responds; do
    if (( waited >= DOCKER_READY_TIMEOUT_SECONDS )); then
      echo "Docker daemon did not become ready within ${DOCKER_READY_TIMEOUT_SECONDS}s." >&2
      docker_dump_daemon_log
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  driver="$(sudo docker info --format '{{.Driver}}')"
  if [[ "$driver" != "$DOCKER_STORAGE_DRIVER" ]]; then
    echo "Docker came up on the '${driver}' storage driver; '${DOCKER_STORAGE_DRIVER}' is" >&2
    echo "required inside the nested VM. Check ${DOCKER_DAEMON_CONFIG}." >&2
    docker_dump_daemon_log
    return 1
  fi

  echo "Docker ready: server $(sudo docker version --format '{{.Server.Version}}') on ${driver}."
}

# Bridged container-to-container traffic must bypass netfilter in the nested VM.
docker_apply_bridge_netfilter_bypass() {
  local key path
  for key in net.bridge.bridge-nf-call-iptables net.bridge.bridge-nf-call-ip6tables; do
    path="/proc/sys/${key//./\/}"
    # The knob exists only once br_netfilter is loaded. Without the module,
    # bridged packets already bypass netfilter: a satisfied precondition, not a
    # suppressed failure.
    if [[ -e "$path" ]]; then
      sudo sysctl -w "${key}=0" >/dev/null
    fi
  done
}

# Run a command string with the docker group applied, so a membership granted
# moments earlier is effective without a new login.
docker_run_in_group() {
  sg docker -c "$1"
}
