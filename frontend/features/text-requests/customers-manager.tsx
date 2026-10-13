"use client";

import { Download, MessageSquareText, Pencil, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogContent, DialogRoot } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import {
  CUSTOMER_NAME_MAX,
  compareCustomers,
  matchesCustomer,
  textRequestStatus,
  type CustomerConsentKind,
  type CustomerConsentState,
} from "@/lib/owner/customers";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils/cn";
import { relativeDay } from "@/lib/utils/relative-day";

export interface CustomerRowData {
  id: string;
  name: string | null;
  lastFour: string;
  locationId: string | null;
  consent: CustomerConsentState;
  lastRequestStatus: string | null;
  lastRequestAt: string | null;
  createdAt: string;
}

interface Place {
  locationId: string;
  name: string;
}

type Filter = "all" | CustomerConsentKind;

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "agreed", label: "Agreed to texts" },
  { value: "no_record", label: "No agreement recorded" },
  { value: "opted_out", label: "Asked not to be texted" },
];

async function authorized(path: string, init: RequestInit = {}): Promise<Response> {
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();
  if (!session) throw new Error("Your session expired. Sign in again, then try.");
  return fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string; details?: Array<{ message?: string }> };
  } | null;
  return payload?.error?.details?.[0]?.message ?? payload?.error?.message ?? fallback;
}

/**
 * Customers: the people this business saved for Text Requests.
 *
 * Search by name or the last digits, filter by what the consent ledger says,
 * add, change, remove, and export. Every change goes to the API and the page
 * is then read again from the server, so what is shown is what is stored.
 *
 * The page never has a whole number: rows carry the last four digits, and an
 * edit changes the number only when a new one is typed. Saving a customer is
 * not their agreement to texts, and the page says so where it matters.
 */
export function CustomersManager({
  customers,
  places,
}: {
  customers: readonly CustomerRowData[];
  places: readonly Place[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<CustomerRowData | "new" | null>(null);
  const [exporting, setExporting] = useState(false);

  const shown = [...customers]
    .filter((customer) => filter === "all" || customer.consent.kind === filter)
    .filter((customer) => matchesCustomer(customer, query))
    .sort(compareCustomers);

  async function exportCsv() {
    setExporting(true);
    try {
      const response = await authorized("/api/v1/customers/export");
      if (!response.ok) {
        notify.error("Export didn't work", await errorMessage(response, "Please try again shortly."));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reviewboost-customers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      notify.error("Export didn't work", caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setExporting(false);
    }
  }

  const placeName = (locationId: string | null) =>
    places.length > 1 ? (places.find((place) => place.locationId === locationId)?.name ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base text-muted" aria-live="polite">
          <span className="font-semibold tabular-nums text-ink">{customers.length.toLocaleString()}</span>{" "}
          {customers.length === 1 ? "customer" : "customers"} saved
        </p>
        <div className="flex items-center gap-2">
          {customers.length > 0 ? (
            <Button
              variant="ghost"
              className="w-auto"
              onClick={() => void exportCsv()}
              loading={exporting}
              loadingLabel="Exporting…"
            >
              <Download className="size-5" aria-hidden="true" />
              Export
            </Button>
          ) : null}
          <Button variant="action" className="w-auto" onClick={() => setEditing("new")}>
            <Plus className="size-5" aria-hidden="true" />
            Add customer
          </Button>
        </div>
      </div>

      {customers.length === 0 ? (
        <EmptyState
          title="No saved customers yet"
          description="Save the people you text often, so next time you pick them instead of typing a number. Saving someone isn't their agreement to texts."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <label className="relative block">
              <span className="sr-only">Search customers</span>
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                placeholder="Search by name or last digits"
                className="pl-12"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="sr-only">Show</span>
              <select
                className="min-h-14 w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 text-base text-ink"
                value={filter}
                onChange={(event) => setFilter(event.target.value as Filter)}
              >
                {FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="text-base text-muted">No customers match.</p>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              <table className="w-full border-collapse text-left md:table-fixed">
                <colgroup>
                  <col className="md:w-[25%]" />
                  <col className="md:w-[26%]" />
                  <col className="md:w-[19%]" />
                  <col className="md:w-[30%]" />
                </colgroup>
                <thead className="hidden border-b border-border bg-quiet md:table-header-group">
                  <tr className="text-sm text-muted">
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Texting</th>
                    <th scope="col" className="px-4 py-3 font-medium">Last text</th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((customer) => (
                    <CustomerRow
                      key={customer.id}
                      customer={customer}
                      placeName={placeName(customer.locationId)}
                      onEdit={() => setEditing(customer)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <CustomerDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        editing={editing}
        places={places}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function ConsentBadge({ consent }: { consent: CustomerConsentState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        consent.kind === "opted_out" ? "font-medium text-danger" : "text-muted",
        consent.kind === "agreed" && "text-ink",
      )}
      data-consent={consent.kind}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          consent.kind === "agreed" && "bg-brand",
          consent.kind === "no_record" && "border border-[color:var(--rb-border-strong)]",
          consent.kind === "opted_out" && "bg-danger",
        )}
      />
      {consent.label}
    </span>
  );
}

function CustomerRow({
  customer,
  placeName,
  onEdit,
}: {
  customer: CustomerRowData;
  placeName: string | null;
  onEdit: () => void;
}) {
  const last = customer.lastRequestStatus ? textRequestStatus(customer.lastRequestStatus) : null;
  const canText = customer.consent.kind !== "opted_out";
  return (
    <tr className="flex flex-col gap-2 px-4 py-4 md:table-row md:py-0" data-customer-row>
      <td className="min-w-0 md:px-4 md:py-4">
        <p className="break-words text-base font-medium text-ink">{customer.name ?? "No name"}</p>
        <p className="text-sm tabular-nums text-muted">
          ••• {customer.lastFour}
          {placeName ? ` · ${placeName}` : ""}
        </p>
      </td>
      <td className="md:px-4 md:py-4">
        <ConsentBadge consent={customer.consent} />
      </td>
      <td className="text-sm text-muted md:px-4 md:py-4">
        {last && customer.lastRequestAt ? (
          <span>
            {last.label} · <span className="whitespace-nowrap">{relativeDay(customer.lastRequestAt)}</span>
          </span>
        ) : (
          <span>Never texted</span>
        )}
      </td>
      <td className="md:px-4 md:py-4 md:text-right">
        <div className="-ml-3 flex items-center gap-1 md:ml-0 md:justify-end">
          {canText ? (
            <Link
              href={`/text-requests?customer=${customer.id}`}
              className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] px-3 text-sm font-medium text-brand-text hover:bg-quiet focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              <MessageSquareText className="size-4" aria-hidden="true" />
              Send a text
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted hover:bg-quiet hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            aria-label={`Edit ${customer.name ?? `customer ending ${customer.lastFour}`}`}
          >
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </button>
        </div>
      </td>
    </tr>
  );
}

function CustomerDialog({
  editing,
  places,
  onClose,
  onSaved,
}: {
  editing: CustomerRowData | "new" | null;
  places: readonly Place[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = editing !== null && editing !== "new" ? editing : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [phone, setPhone] = useState("");
  const [locationId, setLocationId] = useState(existing?.locationId ?? places[0]?.locationId ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!existing && phone.trim().length < 3) {
      setError("Enter their mobile number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim() || null,
        locationId: locationId || null,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      };
      const response = existing
        ? await authorized(`/api/v1/customers/${existing.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await authorized("/api/v1/customers", { method: "POST", body: JSON.stringify(body) });
      if (!response.ok) {
        setError(await errorMessage(response, "That didn't save. Please try again."));
        return;
      }
      notify.success(existing ? "Customer updated" : "Customer saved");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach ReviewBoost. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authorized(`/api/v1/customers/${existing.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await errorMessage(response, "That didn't remove them. Please try again."));
        return;
      }
      notify.success("Customer removed", "Their past texts and agreement history are kept.");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach ReviewBoost. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogRoot open={editing !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        title={existing ? "Edit customer" : "Add customer"}
        description={
          existing
            ? `Ending ••• ${existing.lastFour}. Leave the number empty to keep it.`
            : "Saving someone isn't their agreement to texts. You'll confirm that before the first text."
        }
      >
        <div className="flex flex-col gap-4 py-2">
          <div>
            <label htmlFor="customer-name" className="mb-1 block text-sm font-medium text-ink">
              Name <span className="font-normal text-muted">(optional)</span>
            </label>
            <Input
              id="customer-name"
              value={name}
              maxLength={CUSTOMER_NAME_MAX}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="customer-phone" className="mb-1 block text-sm font-medium text-ink">
              {existing ? "New mobile number" : "Mobile number"}
            </label>
            <Input
              id="customer-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              placeholder={existing ? `Keep ••• ${existing.lastFour}` : "+1 555 123 4567"}
              invalid={error !== null && /number/i.test(error)}
              onChange={(event) => {
                setPhone(event.target.value);
                setError(null);
              }}
            />
          </div>
          {places.length > 1 ? (
            <div>
              <label htmlFor="customer-place" className="mb-1 block text-sm font-medium text-ink">
                Usual place
              </label>
              <select
                id="customer-place"
                className="min-h-14 w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 text-base text-ink"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                <option value="">Not set</option>
                {places.map((place) => (
                  <option key={place.locationId} value={place.locationId}>
                    {place.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>

        {confirmingRemove && existing ? (
          <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-danger/40 p-4">
            <p className="text-base text-ink">
              Remove {existing.name ?? `••• ${existing.lastFour}`} from Customers? Their past texts and
              agreement history stay.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                variant="destructive"
                loading={busy}
                loadingLabel="Removing…"
                onClick={() => void remove()}
                className="sm:flex-1"
              >
                Remove
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmingRemove(false)} className="sm:flex-1">
                Keep
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              variant="action"
              loading={busy}
              loadingLabel="Saving…"
              onClick={() => void save()}
              className="sm:flex-1"
            >
              {existing ? "Save changes" : "Save customer"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose} className="sm:flex-1">
              Cancel
            </Button>
          </div>
        )}

        {existing && !confirmingRemove ? (
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            className="mt-2 inline-flex min-h-11 items-center self-start text-sm font-medium text-danger underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            Remove customer
          </button>
        ) : null}
      </DialogContent>
    </DialogRoot>
  );
}
