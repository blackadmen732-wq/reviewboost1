"use client";

import { Check, FileSpreadsheet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { AlertDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { notify } from "@/components/ui/toast";
import { formatWhen } from "@/features/connections/connection-words";
import { connectionsApi, errorMessage } from "@/features/connections/connections-api";
import {
  columnLabels,
  extractRows,
  guessColumns,
  type Cell,
  type ColumnChoice,
} from "@/features/connections/sheet-columns";
import { MAX_SHEET_ROWS, openCsvFile, pickGoogleSheet, preloadGoogle, type PickedSheet } from "@/lib/google/sheets-client";

interface ProviderView {
  displayName: string;
  monogram: string;
  logoSrc: string | null;
  summary: string;
  dataRead: readonly string[];
  cannotDo: readonly string[];
  available: boolean;
}

export interface SheetListSummary {
  id: string;
  label: string | null;
  createdAt: string;
  rowsReceived: number;
  rowsUnusable: number;
  created: number;
  updated: number;
  unchanged: number;
}

interface ImportResult {
  importId: string;
  created: number;
  updated: number;
  unchanged: number;
  unusable: Array<{ row: number; reason: "no_phone" | "invalid_phone" }>;
  unusableCount: number;
}

export type ListSource = "google_sheets" | "csv";

interface GoogleSheetsImportProps {
  /** Which front door: Google's picker, or a CSV file from the owner's computer. */
  source: ListSource;
  provider: ProviderView;
  google: { clientId: string; apiKey: string; projectNumber: string } | null;
  lists: readonly SheetListSummary[];
}

const CARD = "rounded-[var(--radius-card)] border border-border bg-surface p-5";

type Step =
  | { kind: "start" }
  | { kind: "opening" }
  | { kind: "review"; sheet: PickedSheet; tab: string; cells: Cell[][]; choice: ColumnChoice }
  | { kind: "saving"; sheet: PickedSheet }
  | { kind: "done"; title: string; result: ImportResult };

/**
 * Google Sheets: pick a sheet in Google's own window, check which columns are
 * the name and the phone, then bring the people in. Nothing here texts anyone,
 * and ReviewBoost keeps no access to the Google account afterwards.
 */
export function GoogleSheetsImport({ source, provider, google, lists }: GoogleSheetsImportProps) {
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<PickedSheet | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const ready = source === "csv" ? provider.available : Boolean(google);

  useEffect(() => {
    if (source === "google_sheets" && google) preloadGoogle();
    // Whatever happens, the Google permission does not outlive this screen.
    return () => sheetRef.current?.done();
  }, [google, source]);

  async function openFile(file: File) {
    setError(null);
    setStep({ kind: "opening" });
    try {
      const sheet = await openCsvFile(file);
      sheetRef.current = sheet;
      const cells = await sheet.readTab(sheet.tabs[0]!.title);
      setStep({ kind: "review", sheet, tab: sheet.tabs[0]!.title, cells, choice: guessColumns(cells) });
    } catch (caught) {
      setError(errorMessage(caught));
      setStep({ kind: "start" });
    }
  }

  async function choose() {
    if (source === "csv") {
      fileInput.current?.click();
      return;
    }
    if (!google) return;
    setError(null);
    sheetRef.current?.done();
    setStep({ kind: "opening" });
    try {
      const sheet = await pickGoogleSheet(google);
      sheetRef.current = sheet;
      const tab = sheet.tabs[0]!.title;
      const cells = await sheet.readTab(tab);
      setStep({ kind: "review", sheet, tab, cells, choice: guessColumns(cells) });
    } catch (caught) {
      setError(errorMessage(caught));
      setStep({ kind: "start" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <ProviderMark provider={provider} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{provider.displayName}</h1>
          <p className="text-base text-muted">{provider.summary}</p>
        </div>
      </header>

      {!ready ? (
        <InlineNotice title="Coming soon">
          We&apos;re finishing {provider.displayName}. You can&apos;t add a list yet.
        </InlineNotice>
      ) : null}

      {step.kind === "start" || step.kind === "opening" ? (
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
          {error ? (
            <div className="mt-4">
              <InlineNotice kind="error">{error}</InlineNotice>
            </div>
          ) : null}
          {ready && source === "google_sheets" ? (
            <>
              <Button className="mt-4" loading={step.kind === "opening"} loadingLabel="Opening Google…" onClick={choose}>
                Choose a Google Sheet
              </Button>
              <p className="mt-2 text-sm text-muted">
                Google will ask you to sign in and pick one sheet. We read it once and don&apos;t keep access to your Google account.
              </p>
            </>
          ) : null}
          {ready && source === "csv" ? (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void openFile(file);
                }}
              />
              <Button className="mt-4" loading={step.kind === "opening"} loadingLabel="Reading the file…" onClick={choose}>
                Choose a CSV file
              </Button>
              <p className="mt-2 text-sm text-muted">
                In Excel or Numbers, use Save As or Export and pick CSV. The file is read on your device; only names and phone numbers are sent.
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      {step.kind === "review" ? (
        <Review
          source={source}
          step={step}
          error={error}
          onChange={(next) => setStep(next)}
          onError={setError}
          onPickAgain={choose}
          onSaved={(title, result) => {
            sheetRef.current?.done();
            sheetRef.current = null;
            setError(null);
            setStep({ kind: "done", title, result });
          }}
          onSaving={(sheet) => setStep({ kind: "saving", sheet })}
        />
      ) : null}

      {step.kind === "saving" ? (
        <section className={CARD} aria-busy="true">
          <p className="text-base text-ink">Adding people from {step.sheet.title}…</p>
        </section>
      ) : null}

      {step.kind === "done" ? <Done source={source} title={step.title} result={step.result} onAnother={() => setStep({ kind: "start" })} /> : null}

      {lists.length > 0 ? <Lists lists={lists} /> : null}
    </div>
  );
}

export function ProviderMark({ provider, size = "lg" }: { provider: Pick<ProviderView, "monogram" | "logoSrc">; size?: "lg" | "md" }) {
  const box = size === "lg" ? "size-12" : "size-10";
  if (provider.logoSrc) {
    return (
      <span className={`grid ${box} shrink-0 place-items-center rounded-[10px] border border-border bg-surface`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small local brand file, no optimisation needed */}
        <img src={provider.logoSrc} alt="" className="size-[60%] object-contain" />
      </span>
    );
  }
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-[10px] border border-border bg-surface text-ink`} aria-hidden="true">
      <FileSpreadsheet className="size-[55%]" />
    </span>
  );
}

// ----------------------------------------------------------------- review ---

function Review({
  source,
  step,
  error,
  onChange,
  onError,
  onPickAgain,
  onSaving,
  onSaved,
}: {
  source: ListSource;
  step: Extract<Step, { kind: "review" }>;
  error: string | null;
  onChange: (next: Step) => void;
  onError: (message: string | null) => void;
  onPickAgain: () => void;
  onSaving: (sheet: PickedSheet) => void;
  onSaved: (title: string, result: ImportResult) => void;
}) {
  const { sheet, tab, cells, choice } = step;
  const labels = useMemo(() => columnLabels(cells, choice.headerRow), [cells, choice.headerRow]);
  const rows = useMemo(() => extractRows(cells, choice), [cells, choice]);
  const withPhone = rows.filter((row) => row.phone).length;
  const tooMany = rows.length > MAX_SHEET_ROWS;
  const [tabBusy, setTabBusy] = useState(false);

  async function switchTab(title: string) {
    setTabBusy(true);
    onError(null);
    try {
      const next = await sheet.readTab(title);
      onChange({ kind: "review", sheet, tab: title, cells: next, choice: guessColumns(next) });
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setTabBusy(false);
    }
  }

  async function save() {
    onError(null);
    onSaving(sheet);
    try {
      const result = await connectionsApi<ImportResult>("/api/v1/customers/lists", {
        method: "POST",
        body:
          source === "google_sheets"
            ? { source, label: sheet.title.slice(0, 120), sourceRef: sheet.id, rows }
            : { source, label: sheet.title.slice(0, 120), rows },
      });
      onSaved(sheet.title, result);
    } catch (caught) {
      onError(errorMessage(caught));
      onChange(step);
    }
  }

  const select = (key: keyof Omit<ColumnChoice, "headerRow">, label: string, optional: boolean) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <select
        value={choice[key] ?? ""}
        onChange={(event) =>
          onChange({ ...step, choice: { ...choice, [key]: event.target.value === "" ? null : Number(event.target.value) } })
        }
        className="min-h-12 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
      >
        <option value="">{optional ? "None" : "Choose a column"}</option>
        {labels.map((text, index) => (
          <option key={index} value={index}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{sheet.title}</h2>
        <button type="button" onClick={onPickAgain} className="min-h-11 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline">
          {source === "csv" ? "Pick a different file" : "Pick a different sheet"}
        </button>
      </div>

      {sheet.tabs.length > 1 ? (
        <label className="mt-4 flex flex-col gap-1">
          <span className="text-sm font-semibold text-ink">Which tab?</span>
          <select
            value={tab}
            disabled={tabBusy}
            onChange={(event) => void switchTab(event.target.value)}
            className="min-h-12 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-base text-ink"
          >
            {sheet.tabs.map((item) => (
              <option key={item.title} value={item.title}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="mt-4 text-base text-ink">Check which columns we should use.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {select("name", choice.lastName !== null ? "First name" : "Name", false)}
        {select("lastName", "Last name", true)}
        {select("phone", "Phone number", false)}
      </div>

      {rows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-[var(--radius-control)] border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">First rows of {sheet.title}</caption>
            <thead className="bg-quiet text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Row</th>
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Phone</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 5).map((row) => (
                <tr key={row.row} className="border-t border-border">
                  <td className="px-3 py-2 tabular-nums text-muted">{row.row}</td>
                  <td className="px-3 py-2 text-ink">{row.name ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-ink">{row.phone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-3 text-sm text-muted">
        {rows.length === 0
          ? "We didn't find anyone in that tab."
          : `${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"}, ${withPhone.toLocaleString()} with a phone number.`}
      </p>

      {tooMany ? (
        <div className="mt-4">
          <InlineNotice kind="error">
            This tab has more than {MAX_SHEET_ROWS.toLocaleString()} people. Split it into smaller tabs and add them one at a time.
          </InlineNotice>
        </div>
      ) : null}

      <div className="mt-4">
        <InlineNotice title="This doesn't text anyone">
          Adding people only puts their name and number in ReviewBoost. You still need each person&apos;s OK before you text them.
        </InlineNotice>
      </div>

      {error ? (
        <div className="mt-4">
          <InlineNotice kind="error">{error}</InlineNotice>
        </div>
      ) : null}

      <Button className="mt-4" onClick={save} disabled={tooMany || withPhone === 0 || choice.phone === null || tabBusy}>
        Add these people
      </Button>
    </section>
  );
}

// ------------------------------------------------------------------- done ---

function Done({ source, title, result, onAnother }: { source: ListSource; title: string; result: ImportResult; onAnother: () => void }) {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);

  const parts = [
    result.created ? `${result.created.toLocaleString()} new` : null,
    result.updated ? `${result.updated.toLocaleString()} updated` : null,
    result.unchanged ? `${result.unchanged.toLocaleString()} already here` : null,
  ].filter(Boolean);

  return (
    <section className={CARD} aria-live="polite">
      <h2 className="flex items-start gap-2 text-lg font-semibold text-ink">
        <Check className="mt-1 size-5 shrink-0 text-brand-text" aria-hidden="true" />
        Added people from {title}
      </h2>
      <p className="mt-1 text-base text-ink">{parts.length ? parts.join(" · ") : "Nobody new."}</p>
      {result.unusableCount > 0 ? (
        <div className="mt-4">
          <InlineNotice title={`${result.unusableCount.toLocaleString()} ${result.unusableCount === 1 ? "row wasn't" : "rows weren't"} added`}>
            {result.unusable.some((item) => item.reason === "invalid_phone")
              ? "The phone number couldn't be used (too short, too long, or not a real number), or there wasn't one. "
              : "There was no phone number. "}
            Rows {result.unusable.map((item) => item.row).join(", ")}
            {result.unusableCount > result.unusable.length ? ` and ${result.unusableCount - result.unusable.length} more` : ""}. Fix them in your list, then add it again.
          </InlineNotice>
        </div>
      ) : null}
      <p className="mt-4 text-sm text-muted">
        {source === "google_sheets"
          ? "We've let go of the Google permission. Add the sheet again any time to bring in changes."
          : "Add the file again any time to bring in changes. Nobody is added twice."}
      </p>
      <Button className="mt-4" variant="secondary" onClick={onAnother}>
        {source === "google_sheets" ? "Add another sheet" : "Add another file"}
      </Button>
    </section>
  );
}

// ------------------------------------------------------------------ lists ---

function Lists({ lists }: { lists: readonly SheetListSummary[] }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<SheetListSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const result = await connectionsApi<{ contactsRemoved: number }>(`/api/v1/customers/lists/${removing.id}/remove`, { method: "POST" });
      notify.success(
        result.contactsRemoved
          ? `Removed ${removing.label ?? "the list"} and ${result.contactsRemoved} ${result.contactsRemoved === 1 ? "person" : "people"} only it had.`
          : `Removed ${removing.label ?? "the list"}.`,
      );
      setRemoving(null);
      router.refresh();
    } catch (caught) {
      notify.error(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Lists you&apos;ve added</h2>
      <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {lists.map((list) => (
          <li key={list.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-ink">{list.label ?? "Customer list"}</p>
              <p className="text-sm text-muted">
                {formatWhen(list.createdAt)} · {(list.created + list.updated + list.unchanged).toLocaleString()} people
                {list.rowsUnusable ? ` · ${list.rowsUnusable.toLocaleString()} rows skipped` : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" className="w-auto shrink-0" onClick={() => setRemoving(list)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? null : setRemoving(null))}
        title={`Remove ${removing?.label ?? "this list"}?`}
        description="People who only came from this list are removed from ReviewBoost. Anyone you also know from somewhere else, or who has visited, stays. Your original file or sheet isn't changed."
        confirmLabel="Remove list"
        onConfirm={remove}
        loading={busy}
      />
    </section>
  );
}
