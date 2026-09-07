#!/usr/bin/env bash
#
# Cloud Agent install phase — durable, idempotent setup baked into the
# environment snapshot. Runs after the repository is checked out.
#
#   * Docker Engine (local Supabase runs in containers)
#   * Node dependencies for the web app and the mobile foundation
#   * Generated API types
#   * Pre-pulled Supabase images so every boot starts quickly
#
# Per-boot work (starting dockerd, starting Supabase, the dev server) lives in
# start.sh / the terminals, not here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Docker Engine =="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sudo sh /tmp/get-docker.sh
fi

# fuse-overlayfs is the storage driver that works inside the nested Cloud Agent
# VM; the native overlayfs driver cannot mount there.
sudo apt-get update -y || true
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  -o Dpkg::Options::=--force-confold fuse-overlayfs || true
sudo mkdir -p /etc/docker
printf '{\n  "storage-driver": "fuse-overlayfs"\n}\n' | sudo tee /etc/docker/daemon.json >/dev/null
sudo usermod -aG docker "$(id -un)" || true
sudo service docker restart || sudo service docker start || true

# Same-bridge container-to-container traffic must bypass iptables in the nested
# VM, otherwise packets between the Supabase containers are silently dropped.
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1 || true
sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1 || true

echo "== Web dependencies =="
( cd "$REPO_ROOT/frontend" && npm ci && npm run api:generate )

echo "== Mobile dependencies =="
( cd "$REPO_ROOT/apps/mobile" && npm ci )

echo "== Pre-pull Supabase images =="
# Start once to pull every image into the snapshot, then stop. `sg docker`
# picks up the freshly added docker group without needing a new login.
if sg docker -c "cd '$REPO_ROOT' && npx --yes supabase start"; then
  sg docker -c "cd '$REPO_ROOT' && npx --yes supabase stop --no-backup" || true
else
  echo "WARNING: supabase start failed during install; boot will pull images." >&2
fi

echo "install.sh complete."
