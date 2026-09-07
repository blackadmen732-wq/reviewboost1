# Cloud Agent development environment

The repository-managed environment a Cursor Cloud Agent boots into: the Next.js
web app, the Expo mobile foundation, and a full local Supabase stack running in
Docker. It needs no external secrets — local Supabase prints its own demo
anon/service keys, and the development encryption key is generated on the
machine for a throwaway database.

| File | Role |
| --- | --- |
| `.cursor/environment.json` | Lifecycle wiring: `install`, `start`, the `web` terminal, forwarded ports. Validated against <https://cursor.com/schemas/environment.schema.json>. |
| `.cursor/install.sh` | Install phase. Durable setup baked into the environment snapshot. |
| `.cursor/start.sh` | Start phase. Per-boot reconciliation of Docker and Supabase. |
| `scripts/dev/tool-versions.sh` | The pinned versions, and the wrapper that runs the pinned Supabase CLI. |
| `scripts/dev/docker-nested-vm.sh` | Docker Engine installation, configuration, and readiness proof for the nested VM. |
| `scripts/dev/setup-local-env.sh` | Generates `frontend/.env.local` from the running stack. |

## Pinned versions

Every external tool is pinned in `scripts/dev/tool-versions.sh` so that two
builds of the same commit install the same software. Nothing resolves `latest`,
no `npx` invocation is unversioned, and Docker does not come from the
convenience script at `get.docker.com` — that script always installs upstream's
current stable release, which is exactly the drift being avoided.

| Tool | Pinned value | Source |
| --- | --- | --- |
| Supabase CLI | `2.117.0` | npm, via `npx --yes supabase@<version>` |
| `docker-ce`, `docker-ce-cli` | `5:29.8.0-1~ubuntu.24.04~noble` | Docker's apt repository |
| `containerd.io` | `2.3.4-2~ubuntu.24.04~noble` | Docker's apt repository |
| `docker-buildx-plugin` | `0.37.0-1~ubuntu.24.04~noble` | Docker's apt repository |
| `docker-compose-plugin` | `5.5.1-1~ubuntu.24.04~noble` | Docker's apt repository |
| Docker apt signing key | fingerprint `9DC858229FC7DD38854AE2D88D81803C0EBFCD88` | <https://download.docker.com/linux/ubuntu/gpg> |
| `fuse-overlayfs` | not version-pinned; validated against `1.13-1` | Ubuntu archive |

The Docker apt version strings encode the distribution codename, so they must be
updated when the base image's Ubuntu release changes. `apt-cache madison
docker-ce` lists what the repository offers for the current codename. The
downloaded signing key is checked against the pinned fingerprint before apt is
told to trust it.

`fuse-overlayfs` is the deliberate exception. It comes from the Ubuntu archive,
which withdraws superseded versions as security updates land, so an exact pin
would turn a routine archive rotation into a failed environment build. Its
install is still mandatory: the daemon is configured to use it and cannot start
without it.

### Updating a pinned version

1. Edit `scripts/dev/tool-versions.sh` and this table in the same commit.
2. Run the checks in [Validation](#validation) below.
3. Trigger an environment build and boot an agent from it before merging: the
   install phase is what publishes the snapshot, and a later boot cannot repair
   it.

## Nested-VM Docker

Two nested-virtualisation quirks are handled in
`scripts/dev/docker-nested-vm.sh`:

- **Storage driver.** The native `overlayfs` driver cannot mount inside the VM,
  so `/etc/docker/daemon.json` selects `fuse-overlayfs`.
- **Bridge networking.** Same-bridge container-to-container traffic is silently
  dropped while bridge-netfilter is active — the TCP handshake succeeds and
  larger packets vanish — so `net.bridge.bridge-nf-call-iptables` and its IPv6
  counterpart are set to `0` before any container starts. The knobs exist only
  once `br_netfilter` is loaded; without the module bridged packets already
  bypass netfilter, so their absence is a satisfied precondition rather than a
  suppressed failure.

## Failing closed

The install phase publishes a snapshot that later boots cannot repair. A
suppressed failure there produces an environment that reports success and then
dies waiting for Docker on every boot, so no mandatory step tolerates failure:

- Installing `fuse-overlayfs` and Docker Engine.
- Writing `/etc/docker/daemon.json` and granting docker-group membership.
- Starting or restarting the daemon.
- Proving readiness: `docker info` must answer **and** report the
  `fuse-overlayfs` driver. A daemon that fell back to `overlayfs` answers
  `docker info` happily and then fails to create any container filesystem.
- The `supabase start` / `supabase stop` pass that pre-pulls images, which is
  also the end-to-end proof that the driver and bridge settings work.

On failure the readiness check dumps the tail of `/var/log/docker.log` so the
build log explains itself.

## Generated `frontend/.env.local`

`scripts/dev/setup-local-env.sh` writes the file from `supabase status -o env`
on every boot. It is safe to rerun and is byte-for-byte idempotent.

**Preserved across reruns**, because regenerating them silently breaks data
already on disk:

| Variable | Why |
| --- | --- |
| `CUSTOMER_NOTE_ENCRYPTION_KEY` | Decrypts rows already in the local database. Minted only when absent. |
| `TOKEN_DIGEST_KEY` | Resolves stands already issued. |
| `TOKEN_DIGEST_KEY_PREVIOUS` | The key an in-progress rotation is leaving behind. |
| `TOKEN_DIGEST_KEY_VERSION` | Which version new digests are written under. |

The digest variables are preserved verbatim and never substituted. Dropping
them makes the server fall back to `CUSTOMER_NOTE_ENCRYPTION_KEY`
(`frontend/lib/server/env.ts`), which stops resolving every stand whose digest
was produced by the configured key and silently abandons a rotation. Rotation
runbook: `docs/backend/ENVIRONMENT.md`.

A repeated assignment resolves to its last occurrence, matching dotenv, so the
preserved value is the one the app was actually running with. An assignment with
an empty value counts as unconfigured, which is how `frontend/.env.example`
ships the optional digest keys.

The Supabase URL and the anon/service keys are the opposite: refreshed from the
running stack every time, because the stack is authoritative.

### Permissions

The file carries a service-role key, which bypasses Row Level Security. The
script sets `umask 077` before creating anything, writes through a temporary
file so an interrupted run cannot leave a half-written environment behind, and
then verifies the result is mode `600` rather than assuming it — a file that
already existed world-readable, or a umask the script did not set, must not
leave the key exposed.

### No committed secret assignments

The generator holds its variable names in shell variables and emits values
through a helper, so no literal `NAME=value` secret assignment appears in
committed source. That is what the `secrets` job in `.github/workflows/ci.yml`
scans for, and the rule is enforced as written rather than excluded — see the
final case in `scripts/dev/__tests__/setup-local-env.test.mjs`, which applies
the CI pattern to these scripts.

## Validation

```bash
# Shell syntax and lint
for script in .cursor/install.sh .cursor/start.sh scripts/dev/*.sh; do bash -n "$script"; done
shellcheck -x --source-path=SCRIPTDIR .cursor/install.sh .cursor/start.sh scripts/dev/*.sh

# Environment-file generator
node --test scripts/dev/__tests__/setup-local-env.test.mjs

# Secret scan, the same rules CI applies
git grep -nIE '(SUPABASE_SERVICE_ROLE_KEY|PII_ENCRYPTION_KEY|TOKEN_DIGEST_KEY|ENCRYPTION_KEY)=.+' \
  -- ':!*.example' ':!*.md' ':!docs/**' ':!.github/**'
```

The first three run in the `dev-script-tests` job; the scan runs in `secrets`.
