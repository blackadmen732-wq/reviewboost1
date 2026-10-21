"use client";

import { Check, CircleAlert, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AlertDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { notify } from "@/components/ui/toast";
import {
  formatWhen,
  issueLabel,
  runLabel,
  runStatusLabel,
  stateLabel,
} from "@/features/connections/connection-words";
import { connectionsApi, errorMessage } from "@/features/connections/connections-api";
import type {
  ConnectionSummary,
  IssueSummary,
  PlaceMapping,
  RunSummary,
  TestSummary,
} from "@/lib/server/integrations/connection-service";

interface ProviderView {
  id: string;
  displayName: string;
  monogram: string;
  summary: string;
  dataRead: readonly string[];
  cannotDo: readonly string[];
  availability: "available" | "in_setup" | "planned";
  workflows: ReadonlyArray<{ id: string; label: string; permissions: ReadonlyArray<{ label: string; reason: string }> }>;
}

interface ConnectionDetailProps {
  provider: ProviderView;
  connection: ConnectionSummary | null;
  mappings: readonly PlaceMapping[];
  runs: readonly RunSummary[];
  issues: readonly IssueSummary[];
  places: ReadonlyArray<{ id: string; name: string }>;
}

const CARD = "rounded-[var(--radius-card)] border border-border bg-surface p-5";

/**
 * One app, from "not connected" to "on". Each step is its own button and its
 * own server call: connect, choose places, run the check, turn on. Nothing on
 * this screen sends a message.
 */
export function ConnectionDetail(props: ConnectionDetailProps) {
  const { provider, connection } = props;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-quiet text-base font-semibold text-ink" aria-hidden="true">
          {provider.monogram}
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{provider.displayName}</h1>
          <p className="text-base text-muted">{connection?.accountLabel ?? provider.summary}</p>
        </div>
      </header>

      {!connection ? <NotConnected provider={provider} /> : null}
      {connection?.state === "authorization_required" ? <NeedsPermission provider={provider} connection={connection} /> : null}
      {connection?.state === "connecting" || connection?.state === "error" ? <Setup {...props} connection={connection} /> : null}
      {connection && ["active", "unavailable", "reauth_required", "disconnecting"].includes(connection.state) ? (
        <Connected {...props} connection={connection} />
      ) : null}

      {connection && connection.state !== "disconnecting" ? <Disconnect provider={provider} connection={connection} /> : null}
    </div>
  );
}

// ------------------------------------------------------------ not connected ---

async function startConnect(providerId: string, workflowId: string, reconnectConnectionId?: string) {
  const result = await connectionsApi<{ authorizeUrl: string }>(`/api/v1/connections/providers/${providerId}/authorize`, {
    method: "POST",
    body: { workflowId, ...(reconnectConnectionId ? { reconnectConnectionId } : {}) },
  });
  window.location.assign(result.authorizeUrl);
}

function NotConnected({ provider }: { provider: ProviderView }) {
  const [workflowId, setWorkflowId] = useState(provider.workflows[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workflow = provider.workflows.find((item) => item.id === workflowId);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await startConnect(provider.id, workflowId);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <>
      {provider.availability !== "available" ? (
        <InlineNotice title={provider.availability === "planned" ? "Planned" : "Coming soon"}>
          {provider.availability === "planned"
            ? `${provider.displayName} is on our list. You can't connect it yet.`
            : `We're finishing ${provider.displayName}. You can't connect it yet.`}
        </InlineNotice>
      ) : null}

      {provider.dataRead.length > 0 ? (
        <section className={CARD}>
          <h2 className="text-base font-semibold text-ink">What ReviewBoost reads</h2>
          <ul className="mt-2 flex flex-col gap-1 text-base text-ink">
            {provider.dataRead.map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="mt-1 size-4 shrink-0 text-brand-text" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <h2 className="mt-4 text-base font-semibold text-ink">What it can&apos;t do</h2>
          <ul className="mt-2 flex flex-col gap-1 text-base text-muted">
            {provider.cannotDo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {provider.availability === "available" ? (
        <section className={CARD}>
          {provider.workflows.length > 1 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-base font-semibold text-ink">What should we read?</legend>
              {provider.workflows.map((item) => (
                <label key={item.id} className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border p-3">
                  <input type="radio" name="workflow" value={item.id} checked={workflowId === item.id} onChange={() => setWorkflowId(item.id)} />
                  <span className="text-base text-ink">{item.label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {workflow ? (
            <div className="mt-4">
              <p className="text-sm font-semibold text-ink">{provider.displayName} will ask you to allow:</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-muted">
                {workflow.permissions.map((permission) => (
                  <li key={permission.label}>
                    <span className="text-ink">{permission.label}.</span> {permission.reason}.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? (
            <div className="mt-4">
              <InlineNotice kind="error">{error}</InlineNotice>
            </div>
          ) : null}
          <Button className="mt-4" loading={busy} loadingLabel="Opening…" onClick={connect} disabled={!workflowId}>
            Connect {provider.displayName}
          </Button>
          <p className="mt-2 text-sm text-muted">Connecting doesn&apos;t text anyone. You&apos;ll choose places and run a check first.</p>
        </section>
      ) : null}
    </>
  );
}

function NeedsPermission({ provider, connection }: { provider: ProviderView; connection: ConnectionSummary }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className={CARD}>
      <InlineNotice title="Not every permission was given" kind="error">
        ReviewBoost needs every permission on the list to find who visited. Sign in again and allow them all.
      </InlineNotice>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <Button
        className="mt-4"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await startConnect(provider.id, connection.workflowId, connection.id);
          } catch (caught) {
            setError(errorMessage(caught));
            setBusy(false);
          }
        }}
      >
        Sign in to {provider.displayName} again
      </Button>
    </section>
  );
}

// -------------------------------------------------------------------- setup ---

function Setup({ provider, connection, mappings, places }: ConnectionDetailProps & { connection: ConnectionSummary }) {
  const router = useRouter();
  const [providerPlaces, setProviderPlaces] = useState<Array<{ externalLocationId: string; name: string }> | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(mappings.map((mapping) => [mapping.externalLocationId, mapping.locationId])),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "activate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestSummary | null>(
    connection.lastTestPassed && connection.testedConfigVersion === connection.configVersion ? connection.lastTestSummary : null,
  );

  const saved = mappings.length > 0;
  const tested = test !== null && connection.testedConfigVersion === connection.configVersion;

  useEffect(() => {
    let cancelled = false;
    connectionsApi<{ providerLocations: Array<{ externalLocationId: string; name: string }> }>(
      `/api/v1/connections/${connection.id}/configuration`,
    ).then(
      (data) => {
        if (!cancelled) setProviderPlaces(data.providerLocations);
      },
      (caught: unknown) => {
        if (!cancelled) setLoadError(errorMessage(caught));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection.id]);

  async function step(kind: "save" | "test" | "activate", run: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const chosen = Object.entries(choice).filter(([, locationId]) => locationId);

  return (
    <>
      {connection.state === "error" ? (
        <InlineNotice title="Something went wrong" kind="error">
          Check your places and run the check again.
        </InlineNotice>
      ) : null}

      <section className={CARD} aria-labelledby="step-places">
        <h2 id="step-places" className="text-base font-semibold text-ink">
          1. Match your places
        </h2>
        <p className="mt-1 text-sm text-muted">Visits at places you leave out are not brought in.</p>
        {loadError ? (
          <div className="mt-3">
            <InlineNotice kind="error">{loadError}</InlineNotice>
          </div>
        ) : null}
        {!providerPlaces && !loadError ? <p className="mt-3 text-sm text-muted">Reading places from {provider.displayName}…</p> : null}
        {providerPlaces ? (
          <div className="mt-3 flex flex-col gap-3">
            {providerPlaces.map((place) => (
              <label key={place.externalLocationId} className="flex flex-col gap-1">
                <span className="text-sm font-medium text-ink">{place.name}</span>
                <select
                  value={choice[place.externalLocationId] ?? ""}
                  onChange={(event) => setChoice((current) => ({ ...current, [place.externalLocationId]: event.target.value }))}
                  className="min-h-12 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-base text-ink"
                >
                  <option value="">Don&apos;t bring in</option>
                  {places.map((own) => (
                    <option key={own.id} value={own.id}>
                      {own.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <Button
              variant={saved ? "secondary" : "primary"}
              loading={busy === "save"}
              disabled={chosen.length === 0 || busy !== null}
              onClick={() =>
                step("save", async () => {
                  await connectionsApi(`/api/v1/connections/${connection.id}/configuration`, {
                    method: "POST",
                    body: { mappings: chosen.map(([externalLocationId, locationId]) => ({ externalLocationId, locationId })) },
                  });
                  setTest(null);
                  router.refresh();
                })
              }
            >
              {saved ? "Save changes" : "Save places"}
            </Button>
          </div>
        ) : null}
      </section>

      <section className={CARD} aria-labelledby="step-check">
        <h2 id="step-check" className="text-base font-semibold text-ink">
          2. Run a check
        </h2>
        <p className="mt-1 text-sm text-muted">Reads the last 7 days without saving anything, so you can see what would come in.</p>
        {tested && test ? (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-ink">
            <li>{test.visitsFound} visits at your chosen places</li>
            <li>{test.reachable} with a phone number ReviewBoost can use</li>
            <li>{test.noPhone} without a usable phone (these are listed, not brought in)</li>
            {test.otherPlaces > 0 ? <li>{test.otherPlaces} at places you didn&apos;t choose</li> : null}
          </ul>
        ) : null}
        <Button
          className="mt-3"
          variant={tested ? "secondary" : "primary"}
          loading={busy === "test"}
          disabled={!saved || busy !== null}
          onClick={() =>
            step("test", async () => {
              const result = await connectionsApi<{ summary: TestSummary }>(`/api/v1/connections/${connection.id}/test`, {
                method: "POST",
              });
              setTest(result.summary);
              router.refresh();
            })
          }
        >
          {tested ? "Run the check again" : "Run the check"}
        </Button>
      </section>

      <section className={CARD} aria-labelledby="step-on">
        <h2 id="step-on" className="text-base font-semibold text-ink">
          3. Turn on
        </h2>
        <p className="mt-1 text-sm text-muted">
          Brings in the last 30 days, then keeps up as new visits happen. It doesn&apos;t text anyone; Text Requests still need each
          customer&apos;s agreement.
        </p>
        <Button
          className="mt-3"
          loading={busy === "activate"}
          disabled={!tested || busy !== null}
          onClick={() =>
            step("activate", async () => {
              await connectionsApi(`/api/v1/connections/${connection.id}/activate`, { method: "POST" });
              notify.success(`${provider.displayName} is on`, "The first read has started.");
              router.refresh();
            })
          }
        >
          Turn on
        </Button>
      </section>

      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
    </>
  );
}

// ---------------------------------------------------------------- connected ---

function Connected({ provider, connection, mappings, runs, issues }: ConnectionDetailProps & { connection: ConnectionSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = stateLabel(connection.state, provider.displayName);
  const running = runs.some((run) => run.status === "queued" || run.status === "running");

  return (
    <>
      {connection.state === "reauth_required" ? (
        <section className={CARD}>
          <InlineNotice title={`Sign in to ${provider.displayName} again`} kind="error">
            Access ended, so nothing new is coming in. Your customers and history are kept.
          </InlineNotice>
          <Button
            className="mt-4"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await startConnect(provider.id, connection.workflowId, connection.id);
              } catch (caught) {
                setError(errorMessage(caught));
                setBusy(false);
              }
            }}
          >
            Sign in again
          </Button>
        </section>
      ) : null}

      {connection.state === "unavailable" ? (
        <InlineNotice title={`Can't reach ${provider.displayName}`}>
          We keep trying on our own. Nothing is lost; visits are brought in once it answers.
        </InlineNotice>
      ) : null}

      {connection.state === "disconnecting" ? <InlineNotice title="Disconnecting">This finishes on its own.</InlineNotice> : null}

      <section className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Status</h2>
          <span className="rounded-full bg-quiet px-3 py-1 text-xs font-semibold text-ink">{status.label}</span>
        </div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Last updated</dt>
          <dd className="text-ink">{formatWhen(connection.lastSuccessAt)}</dd>
          <dt className="text-muted">Places</dt>
          <dd className="text-ink">{mappings.map((mapping) => mapping.externalLocationName ?? mapping.externalLocationId).join(", ") || "None"}</dd>
        </dl>
        {connection.warningCodes.includes("records_skipped") ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <CircleAlert className="size-4" aria-hidden="true" />
            Some records couldn&apos;t be brought in. They&apos;re listed below.
          </p>
        ) : null}
        {connection.state === "active" ? (
          <Button
            className="mt-4"
            variant="secondary"
            loading={busy}
            disabled={running}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await connectionsApi(`/api/v1/connections/${connection.id}/sync`, { method: "POST" });
                notify.success("Updating now");
                router.refresh();
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {running ? "Updating…" : "Update now"}
          </Button>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      {issues.length > 0 ? (
        <section className={CARD}>
          <h2 className="text-base font-semibold text-ink">Not brought in ({issues.length})</h2>
          <p className="mt-1 text-sm text-muted">Fix these in {provider.displayName}; they come in on the next update.</p>
          <ul className="mt-3 flex flex-col divide-y divide-[color:var(--color-border)]">
            {issues.map((issue) => (
              <li key={issue.id} className="flex flex-col py-2 text-sm">
                <span className="text-ink">{issue.hint ?? "A record"}</span>
                <span className="text-muted">{issueLabel(issue.issueCode)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {runs.length > 0 ? (
        <section className={CARD}>
          <h2 className="text-base font-semibold text-ink">Recent updates</h2>
          <ul className="mt-3 flex flex-col divide-y divide-[color:var(--color-border)]">
            {runs.map((run) => {
              const added = (run.counts["customers_created"] ?? 0) + (run.counts["customers_updated"] ?? 0);
              const visits = (run.counts["visits_created"] ?? 0) + (run.counts["visits_updated"] ?? 0);
              return (
                <li key={run.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block text-ink">{runLabel(run.kind)}</span>
                    <span className="block text-muted">
                      {formatWhen(run.finishedAt ?? run.createdAt)} · {added} customers, {visits} visits
                    </span>
                  </span>
                  <span className="shrink-0 text-muted">{runStatusLabel(run.status)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

// --------------------------------------------------------------- disconnect ---

function Disconnect({ provider, connection }: { provider: ProviderView; connection: ConnectionSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Disconnect {provider.displayName}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        title={`Disconnect ${provider.displayName}?`}
        description={`New visits stop coming in and ReviewBoost's access to ${provider.displayName} is removed. Customers already brought in are kept for 30 days in case you reconnect, then deleted. Consent and Text Requests you already have are not affected.`}
        confirmLabel="Disconnect"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            const result = await connectionsApi<{ revoked: boolean }>(`/api/v1/connections/${connection.id}/disconnect`, {
              method: "POST",
            });
            notify.success(
              `${provider.displayName} disconnected`,
              result.revoked ? undefined : `Also remove ReviewBoost from your ${provider.displayName} settings to be sure.`,
            );
            setOpen(false);
            router.refresh();
          } catch (caught) {
            notify.error("Couldn't disconnect", errorMessage(caught));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
