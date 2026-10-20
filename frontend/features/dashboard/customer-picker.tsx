"use client";

import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Pick a customer brought in through Connections.
 *
 * Each row says who they are (name, last four digits, where they came from) and
 * whether they can be texted, in words and with a dot that carries the same
 * meaning. The status is for orientation: the preview asks the server again,
 * and a customer who hasn't agreed can still be chosen, because that is where
 * the owner records how they agreed.
 */

export type PickerStatus = "can_text" | "no_consent" | "opted_out" | "on_hold";

export interface PickerCustomer {
  customerId: string;
  name: string | null;
  lastFour: string | null;
  sources: readonly string[];
  status: PickerStatus;
  statusText: string;
}

const MAX_RESULTS = 8;

export function customerLabel(customer: Pick<PickerCustomer, "name" | "lastFour">): string {
  const digits = customer.lastFour ? `••• ${customer.lastFour}` : "No number";
  return customer.name ? `${customer.name} · ${digits}` : digits;
}

/** Name or last-four match, case-insensitive; digits typed anywhere match the last four. */
export function filterCustomers(
  customers: readonly PickerCustomer[],
  query: string,
): PickerCustomer[] {
  const q = query.trim().toLowerCase();
  if (q === "") return customers.slice(0, MAX_RESULTS);
  const digits = q.replace(/\D/g, "");
  return customers
    .filter((customer) => {
      if (customer.name?.toLowerCase().includes(q)) return true;
      return digits.length > 0 && (customer.lastFour ?? "").includes(digits.slice(-4));
    })
    .slice(0, MAX_RESULTS);
}

export function CustomerPicker({
  customers,
  selected,
  onSelect,
}: {
  customers: readonly PickerCustomer[];
  selected: PickerCustomer | null;
  onSelect: (customer: PickerCustomer | null) => void;
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const results = useMemo(() => filterCustomers(customers, query), [customers, query]);

  if (selected) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted">Customer</span>
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-canvas px-4 py-2">
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-ink">{customerLabel(selected)}</p>
            <StatusLine customer={selected} />
          </div>
          <button
            type="button"
            className="min-h-11 shrink-0 text-sm font-medium text-ink underline underline-offset-4 hover:no-underline"
            onClick={() => onSelect(null)}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-muted">
        Customer
      </label>
      <input
        id={inputId}
        className="min-h-14 rounded-[var(--radius-control)] border border-border bg-canvas px-4 text-base text-ink"
        type="search"
        autoComplete="off"
        placeholder="Search by name or last 4 digits"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-controls={listId}
      />
      {results.length === 0 ? (
        <p className="mt-1 text-sm text-muted">
          No customer matches &ldquo;{query.trim()}&rdquo;. Check the spelling, or type a number instead.
        </p>
      ) : (
        <ul id={listId} className="mt-1 divide-y divide-border rounded-[var(--radius-control)] border border-border bg-surface">
          {results.map((customer) => (
            <li key={customer.customerId}>
              <button
                type="button"
                className="flex min-h-14 w-full flex-col items-start gap-0.5 px-4 py-2 text-left hover:bg-quiet focus-visible:bg-quiet focus-visible:outline-none"
                onClick={() => {
                  onSelect(customer);
                  setQuery("");
                }}
              >
                <span className="text-base text-ink">{customerLabel(customer)}</span>
                <StatusLine customer={customer} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {customers.length > MAX_RESULTS && query.trim() === "" ? (
        <p className="mt-1 text-sm text-muted">
          Showing the {MAX_RESULTS} most recent of {customers.length}. Search to find anyone else.
        </p>
      ) : null}
    </div>
  );
}

function StatusLine({ customer }: { customer: PickerCustomer }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-sm text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full",
            customer.status === "can_text"
              ? "bg-brand"
              : customer.status === "no_consent"
                ? "bg-star"
                : "bg-danger",
          )}
        />
        <span className={customer.status === "can_text" ? "text-ink" : undefined}>{customer.statusText}</span>
      </span>
      {customer.sources.length > 0 ? <span>· From {customer.sources.join(", ")}</span> : null}
    </span>
  );
}
