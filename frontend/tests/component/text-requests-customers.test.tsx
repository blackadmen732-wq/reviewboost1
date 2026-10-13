import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  }),
}));

import { TextRequestComposer } from "@/features/dashboard/text-request-composer";
import { CustomersManager, type CustomerRowData } from "@/features/text-requests/customers-manager";
import { customerConsentState } from "@/lib/owner/customers";

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });

const balance = { monthly: 10, purchased: 0, total: 10 };
const tags = [{ standId: "tag-1", label: "Counter", locationName: null, locationId: "loc-1" }];

describe("Text Requests: sending to a saved customer", () => {
  it("sends by customer id, so the browser never holds the number", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith("/preview")
        ? ok({
            body: "Mario's Pizza: Thanks for visiting today. How did we do? https://reviewboost.fit/q/abc\nReply STOP to opt out.",
            segments: 1,
            encoding: "gsm7",
            unitCount: 90,
            recipientLastFour: "0142",
            eligibility: { allowed: true, reason: null, message: null },
            consentStatement: "x",
          })
        : ok({ requestId: "r1", created: true }, 201),
    );
    vi.stubGlobal("fetch", fetcher);

    render(
      <TextRequestComposer
        balance={balance}
        tags={tags}
        recent={[]}
        canSendRequests
        customers={[
          { id: "cust-1", name: "Ana", lastFour: "0142", agreement: customerConsentState("opted_in") },
          { id: "cust-2", name: null, lastFour: "7781", agreement: customerConsentState(null) },
        ]}
        initialCustomerId="cust-1"
      />,
    );

    // Arrived from Customers → "Send a text": that customer is already chosen.
    expect(screen.getByRole("radio", { name: "Saved customer" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Customer" })).toHaveValue("cust-1");
    expect(screen.getByText("Agreed to texts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview text" }));
    const send = await screen.findByRole("button", { name: "Send to ••• 0142" });

    // The phone draws the server's text, link and STOP line included.
    const phones = document.querySelectorAll("[data-message-body]");
    expect(phones.length).toBeGreaterThan(0);
    expect(phones[0]).toHaveTextContent("Reply STOP to opt out.");
    expect(within(phones[0] as HTMLElement).getByText(/reviewboost\.fit\/q\/abc/)).toBeInTheDocument();

    fireEvent.click(send);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    for (const [, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
      const body = JSON.parse(String(init.body));
      expect(body.customerId).toBe("cust-1");
      expect(body).not.toHaveProperty("phone");
    }
  });

  it("goes back to Preview when the recipient changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok({
          body: "B",
          segments: 1,
          encoding: "gsm7",
          unitCount: 1,
          recipientLastFour: "0142",
          eligibility: { allowed: true, reason: null, message: null },
          consentStatement: "x",
        }),
      ),
    );
    render(
      <TextRequestComposer
        balance={balance}
        tags={tags}
        recent={[]}
        canSendRequests
        customers={[
          { id: "cust-1", name: "Ana", lastFour: "0142", agreement: customerConsentState("opted_in") },
          { id: "cust-2", name: "Bo", lastFour: "7781", agreement: customerConsentState(null) },
        ]}
        initialCustomerId="cust-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview text" }));
    await screen.findByRole("button", { name: "Send to ••• 0142" });
    fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), { target: { value: "cust-2" } });
    expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Preview text" })).toBeEnabled();
  });

  it("offers no Send for a number that cannot be texted, and says why", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok({
          body: "B",
          segments: 1,
          encoding: "gsm7",
          unitCount: 1,
          recipientLastFour: "0142",
          eligibility: { allowed: false, reason: "opt_out", message: "They asked not to get texts." },
          consentStatement: "x",
        }),
      ),
    );
    render(<TextRequestComposer balance={balance} tags={tags} recent={[]} canSendRequests />);
    fireEvent.change(screen.getByLabelText("Customer's mobile number"), { target: { value: "+15552010142" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview text" }));
    await screen.findByText("They asked not to get texts.");
    expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save their agreement" })).toBeNull();
  });

  it("says when saved customers could not load, and still lets the owner type a number", () => {
    render(<TextRequestComposer balance={balance} tags={tags} recent={[]} canSendRequests customers={null} />);
    expect(screen.getByText(/saved customers couldn.t load/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Customer's mobile number")).toBeEnabled();
  });

  it("keeps a long status in its own column so the number never breaks", () => {
    render(
      <TextRequestComposer
        balance={balance}
        tags={tags}
        canSendRequests
        recent={[{ id: "a", status: "suppressed", segments: 1, recipientLastFour: "3390", createdAt: "2026-10-12T12:00:00Z" }]}
      />,
    );
    const number = screen.getByText("••• 3390");
    expect(number.className).toMatch(/whitespace-nowrap/);
    expect(number.className).toMatch(/shrink-0/);
  });
});

const customer = (over: Partial<CustomerRowData>): CustomerRowData => ({
  id: "cust-1",
  name: "Ana López",
  namesDiffer: false,
  lastFour: "0142",
  sources: ["manual"],
  addedByHand: true,
  lastVisitAt: null,
  lastVisitLocationId: null,
  consent: customerConsentState("opted_in"),
  lastRequestStatus: "delivered",
  lastRequestAt: "2026-10-12T12:00:00Z",
  createdAt: "2026-10-01T12:00:00Z",
  ...over,
});

describe("Text Requests: people who visited recently", () => {
  it("lists recent visitors first, says where they came from, and sends nothing on its own", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const today = new Date().toISOString();
    const lastMonth = new Date(Date.now() - 40 * 86_400_000).toISOString();
    render(
      <TextRequestComposer
        balance={balance}
        tags={tags}
        recent={[]}
        canSendRequests
        customers={[
          { id: "c-zed", name: "Zed", lastFour: "0101", agreement: customerConsentState(null), lastVisitAt: today, source: "Square" },
          { id: "c-amy", name: "Amy", lastFour: "0102", agreement: customerConsentState(null), lastVisitAt: lastMonth, source: "Square" },
          { id: "c-bo", name: "Bo", lastFour: "0103", agreement: customerConsentState(null) },
        ]}
        initialCustomerId="c-zed"
      />,
    );

    const groups = document.querySelectorAll("optgroup");
    expect([...groups].map((group) => group.label)).toEqual(["Visited recently", "Everyone else"]);
    expect(within(groups[0] as HTMLElement).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Zed · ••• 0101 · today",
    ]);
    expect(within(groups[1] as HTMLElement).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Amy · ••• 0102",
      "Bo · ••• 0103",
    ]);

    expect(screen.getByText("Visited today · from Square")).toBeInTheDocument();
    // A visit is not agreement: the owner is still asked how they agreed.
    expect(screen.getByText(/No agreement recorded/)).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Customers", () => {
  const list = [
    customer({}),
    customer({ id: "cust-2", name: "Bo", lastFour: "7781", consent: customerConsentState(null), lastRequestStatus: null, lastRequestAt: null }),
    customer({ id: "cust-3", name: "Cy", lastFour: "3390", consent: customerConsentState("opted_out") }),
  ];

  it("searches by name or digits and filters by texting permission", () => {
    render(<CustomersManager customers={list} places={[]} sourceNames={{ square: "Square" }} />);
    expect(document.querySelectorAll("[data-customer-row]")).toHaveLength(3);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search customers" }), { target: { value: "lop" } });
    expect(document.querySelectorAll("[data-customer-row]")).toHaveLength(1);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search customers" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Show" }), { target: { value: "no_record" } });
    const rows = document.querySelectorAll("[data-customer-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Bo");
    expect(rows[0]).toHaveTextContent("Never texted");
  });

  it("does not offer a text to someone who asked not to be texted", () => {
    render(<CustomersManager customers={list} places={[]} sourceNames={{ square: "Square" }} />);
    const rows = [...document.querySelectorAll<HTMLElement>("[data-customer-row]")];
    const cy = rows.find((row) => row.textContent?.includes("Cy"))!;
    expect(within(cy).queryByRole("link", { name: /send a text/i })).toBeNull();
    const ana = rows.find((row) => row.textContent?.includes("Ana"))!;
    expect(within(ana).getByRole("link", { name: /send a text/i })).toHaveAttribute(
      "href",
      "/text-requests?customer=cust-1",
    );
  });

  it("adds a customer through the API, then reloads from the server", async () => {
    const fetcher = vi.fn(async () => ok({ id: "new", lastFour: "4455" }, 201));
    vi.stubGlobal("fetch", fetcher);
    render(<CustomersManager customers={[]} places={[]} sourceNames={{ square: "Square" }} />);
    expect(screen.getByText("No saved customers yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Dee" } });
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "+15550004455" } });
    fireEvent.click(screen.getByRole("button", { name: "Save customer" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/customers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Dee", phone: "+15550004455" });
  });

  it("shows the server's reason when a save is refused, and keeps the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "That number is already saved." } }), { status: 409 }),
      ),
    );
    render(<CustomersManager customers={[]} places={[]} sourceNames={{ square: "Square" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add customer" }));
    fireEvent.change(await screen.findByLabelText("Mobile number"), { target: { value: "+15550004455" } });
    fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That number is already saved.");
    expect(screen.getByLabelText("Mobile number")).toHaveValue("+15550004455");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows where a customer came from and their last visit", () => {
    render(
      <CustomersManager
        customers={[
          customer({
            id: "sq-1",
            name: "Bo Chen",
            sources: ["square"],
            addedByHand: false,
            lastVisitAt: new Date().toISOString(),
            lastVisitLocationId: "loc-2",
            namesDiffer: true,
          }),
        ]}
        places={[
          { locationId: "loc-1", name: "Main St" },
          { locationId: "loc-2", name: "Harbor" },
        ]}
        sourceNames={{ square: "Square" }}
      />,
    );
    const row = document.querySelector<HTMLElement>("[data-customer-row]")!;
    expect(row).toHaveTextContent("From Square");
    expect(row).toHaveTextContent("Visited today · Harbor");
    expect(row.querySelector("[data-names-differ]")).not.toBeNull();
  });

  it("does not offer to change a number or remove a customer a connected app supplies", async () => {
    render(
      <CustomersManager
        customers={[customer({ id: "sq-1", sources: ["square"], addedByHand: false })]}
        places={[]}
        sourceNames={{ square: "Square" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Ana López" }));
    await screen.findByText(/Square keeps their number up to date/);
    expect(screen.queryByLabelText(/mobile number/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove customer" })).toBeNull();
  });

  it("asks before removing, and removes through the API", async () => {
    const fetcher = vi.fn(async () => ok({ id: "cust-1", deleted: true }));
    vi.stubGlobal("fetch", fetcher);
    render(<CustomersManager customers={[customer({})]} places={[]} sourceNames={{ square: "Square" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Ana López" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove customer" }));
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/customers/cust-1");
    expect(init.method).toBe("DELETE");
  });
});
