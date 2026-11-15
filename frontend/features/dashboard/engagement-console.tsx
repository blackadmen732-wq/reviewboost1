"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { AdaptiveReport } from "@/lib/server/engagement/adaptive-service";
import type { EngagementProgram } from "@/lib/server/engagement/decision";

type Report = AdaptiveReport & {
  program: EngagementProgram;
  configuredProviders: string[];
};
const CAMPAIGNS = [
  {
    id: "reward_ready",
    name: "Reward ready",
    title: "Your reward is ready",
    body: "An earned reward is waiting on your loyalty card.",
  },
  {
    id: "one_visit_away",
    name: "Almost there",
    title: "One visit away",
    body: "One more qualifying purchase earns your next reward.",
  },
  {
    id: "return_visit",
    name: "Return visit",
    title: "Your next visit counts",
    body: "Your loyalty card is ready for your next qualifying purchase.",
  },
] as const;

async function authorizedRequest(
  orgId: string,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();
  if (!session) throw new Error("Your session expired. Please sign in again.");
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "X-Organization-Id": orgId,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error?.message ??
        "Unable to load your loyalty program. Please try again.",
    );
  return data;
}

export function EngagementConsole({
  orgId,
  businessName,
  canManage = true,
}: {
  orgId: string;
  businessName: string;
  canManage?: boolean;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [form, setForm] = useState<EngagementProgram | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(
    async (resetForm = false) => {
      const result = (await authorizedRequest(
        orgId,
        "/api/v1/engagement/experiments",
      )) as Report;
      setReport(result);
      setForm((current) =>
        resetForm || current === null ? result.program : current,
      );
    },
    [orgId],
  );
  useEffect(() => {
    let current = true;
    authorizedRequest(orgId, "/api/v1/engagement/experiments")
      .then((data: Report) => {
        if (current) {
          setReport(data);
          setForm(data.program);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (current)
          setError(
            e instanceof Error ? e.message : "Unable to load this page.",
          );
      });
    return () => {
      current = false;
    };
  }, [orgId]);
  async function act(id: string, path: string, method: string, body?: unknown) {
    if (busy) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const result = await authorizedRequest(orgId, path, method, body);
      await load(id === "settings");
      setNotice(
        id === "prepare"
          ? `${result.queued} messages prepared; ${result.control} customers in the comparison group. ${result.deferred} waiting for a campaign or delivery connection.`
          : "Changes saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(null);
    }
  }
  if (!report || !form)
    return (
      <div
        role={error ? "alert" : "status"}
        className="rounded-2xl border border-border bg-surface p-6 text-muted"
      >
        {error ?? "Loading your loyalty program…"}
      </div>
    );
  const purchases = report.eventCounts.purchase_confirmed ?? 0;
  const accepted = report.eventCounts.provider_accepted ?? 0;
  const unknown = report.eventCounts.send_unknown ?? 0;
  const enabled = form.enabled && form.loyaltyEnabled && form.remindersEnabled;
  return (
    <div className="space-y-7">
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-brand-soft p-4 text-brand-text"
        >
          {notice}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Recorded purchases · 30 days", value: purchases },
          { label: "Messages accepted · 30 days", value: accepted },
          { label: "Uncertain sends · 30 days", value: unknown },
        ].map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border border-border bg-surface p-5"
          >
            <p className="text-sm text-muted">{m.label}</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{m.value}</p>
          </div>
        ))}
      </div>
      <form
        className="rounded-2xl border border-border bg-surface p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void act("settings", "/api/v1/engagement", "PUT", form);
        }}
      >
        <h2 className="text-lg font-semibold text-ink">Your loyalty program</h2>
        <p className="mt-1 text-sm text-muted">
          Customers choose whether to join and receive reminders.
        </p>
        <fieldset
          disabled={!canManage || busy !== null}
          className="mt-5 grid gap-4"
        >
          {(
            [
              { key: "enabled", label: "Enable this program" },
              { key: "loyaltyEnabled", label: "Track purchases and rewards" },
              {
                key: "remindersEnabled",
                label: "Allow opted-in customer reminders",
              },
            ] as const
          ).map((item) => (
            <label
              key={item.key}
              className="flex min-h-11 items-center gap-3 text-ink"
            >
              <input
                className="size-5 accent-[var(--rb-brand)]"
                type="checkbox"
                checked={form[item.key]}
                onChange={(e) =>
                  setForm({ ...form, [item.key]: e.target.checked })
                }
              />
              {item.label}
            </label>
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm text-ink">
              Purchases per reward
              <input
                className="min-h-11 rounded-xl border border-border bg-canvas px-3"
                type="number"
                min="2"
                max="100"
                required
                value={form.stampsRequired}
                onChange={(e) =>
                  setForm({ ...form, stampsRequired: Number(e.target.value) })
                }
              />
            </label>
            <label className="grid gap-2 text-sm text-ink">
              Reward description
              <input
                className="min-h-11 rounded-xl border border-border bg-canvas px-3"
                maxLength={120}
                required
                value={form.rewardLabel}
                onChange={(e) =>
                  setForm({ ...form, rewardLabel: e.target.value })
                }
              />
            </label>
          </div>
          <div>
            <Button type="submit" disabled={busy !== null}>
              {busy === "settings" ? "Saving…" : "Save program"}
            </Button>
          </div>
        </fieldset>
      </form>
      <section aria-labelledby="campaign-heading">
        <h2 id="campaign-heading" className="text-lg font-semibold text-ink">
          Messages that learn
        </h2>
        <p className="mt-1 text-sm text-muted">
          Two message versions per campaign. Selection adapts to recorded
          purchases after completed seven-day observation windows.
        </p>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          {CAMPAIGNS.map((c) => {
            const experiment = report.experiments.find(
              (e) => e.campaign === c.id,
            );
            const mature =
              experiment?.cohorts.reduce((n, g) => n + g.matured, 0) ?? 0;
            const treatment = experiment?.cohorts.find(
              (g) => g.cohort === "treatment",
            );
            const control = experiment?.cohorts.find(
              (g) => g.cohort === "control",
            );
            return (
              <article
                key={c.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface"
              >
                <div className="bg-brand-soft p-5 text-brand-text">
                  <p className="text-xs font-semibold uppercase tracking-wide">
                    Message preview · {businessName}
                  </p>
                  <h3 className="mt-4 text-xl font-semibold">{c.title}</h3>
                  <p className="mt-2 text-sm">
                    {c.id === "reward_ready"
                      ? `${form.rewardLabel}. Open your loyalty card to see your available reward.`
                      : c.body}
                  </p>
                  <p className="mt-5 text-sm font-semibold">
                    Open your loyalty card →
                  </p>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="font-medium text-ink">{c.name}</p>
                  <p className="mt-2 text-sm text-muted">
                    {mature === 0
                      ? "Waiting for completed observations."
                      : `${mature} completed observation windows.`}
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted">Message group</dt>
                      <dd className="mt-1 font-semibold text-ink">
                        {treatment?.converted ?? 0} / {treatment?.matured ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">No-message group</dt>
                      <dd className="mt-1 font-semibold text-ink">
                        {control?.converted ?? 0} / {control?.matured ?? 0}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-muted">
                    Recorded repeat purchases / completed windows. These counts
                    alone do not establish a winner.
                  </p>
                  <div className="mt-auto pt-5">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!canManage || busy !== null}
                      onClick={() =>
                        void act(
                          c.id,
                          "/api/v1/engagement/experiments",
                          "POST",
                          { campaign: c.id, active: !experiment?.active },
                        )
                      }
                    >
                      {experiment?.active
                        ? "Pause campaign"
                        : "Enable campaign"}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5">
        <div>
          <p className="font-medium text-ink">
            {report.configuredProviders.length
              ? "Delivery provider configured"
              : "Delivery is not connected"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {report.configuredProviders.length
              ? "Eligible customers receive at most one campaign message a week, during local daytime hours."
              : "Messages remain unsent until a delivery provider and customer wallet destination are connected."}
          </p>
        </div>
        <Button
          type="button"
          disabled={
            !canManage ||
            !enabled ||
            !report.configuredProviders.length ||
            busy !== null
          }
          onClick={() => void act("prepare", "/api/v1/engagement/run", "POST")}
        >
          {busy === "prepare" ? "Preparing…" : "Prepare messages"}
        </Button>
      </div>
      <section
        aria-labelledby="recent-heading"
        className="rounded-2xl border border-border bg-surface p-5"
      >
        <h2 id="recent-heading" className="text-lg font-semibold text-ink">
          Recent decisions
        </h2>
        {report.recent.length ? (
          <ul className="mt-3 divide-y divide-border">
            {report.recent.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap justify-between gap-2 py-3 text-sm"
              >
                <span className="text-ink">
                  {a.cohort === "control" ? "No-message comparison" : a.title}
                </span>
                <span className="text-muted">
                  {a.state.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">
            No campaign decisions recorded yet.
          </p>
        )}
      </section>
    </div>
  );
}
