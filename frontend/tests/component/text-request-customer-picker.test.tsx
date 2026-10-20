import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * Texts: choosing a customer brought in through Connections.
 */

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowser: () => ({ auth }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { TextRequestComposer } from "@/features/dashboard/text-request-composer";

const TAG = { standId: "7e000000-0000-4000-8000-00000000000a", label: "Counter", locationName: null };
const BALANCE = { monthly: 10, purchased: 0, total: 10 };
const CUSTOMERS = [
  {
    customerId: "7d000000-0000-4000-8000-00000000000a",
    name: "Ana Ruiz",
    lastFour: "0101",
    sources: ["Google Sheets"],
    status: "no_consent" as const,
    statusText: "Hasn't agreed to texts yet",
  },
  {
    customerId: "7d000000-0000-4000-8000-00000000000b",
    name: "Ben Cole",
    lastFour: "0202",
    sources: ["Spreadsheet"],
    status: "can_text" as const,
    statusText: "Can text",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
});
afterEach(() => vi.unstubAllGlobals());

it("starts on the customer list, with each person's texting status", () => {
  render(<TextRequestComposer balance={BALANCE} tags={[TAG]} recent={[]} customers={CUSTOMERS} />);
  expect(screen.getByText("Ana Ruiz · ••• 0101")).toBeInTheDocument();
  expect(screen.getByText("Hasn't agreed to texts yet")).toBeInTheDocument();
  expect(screen.getByText("Can text")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Type a number instead" })).toBeInTheDocument();
});

it("previews a picked customer by id, never by a number the browser holds", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          body: "Corner Cafe: How was your visit? Reply STOP to opt out.",
          segments: 1,
          encoding: "gsm7",
          unitCount: 60,
          recipientLastFour: "0202",
          eligibility: { allowed: true, reason: null, message: null },
          consentStatement: "x",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<TextRequestComposer balance={BALANCE} tags={[TAG]} recent={[]} customers={CUSTOMERS} />);

  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ben" } });
  fireEvent.click(screen.getByRole("button", { name: /Ben Cole/ }));
  expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("/api/v1/text-requests/preview");
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body).toMatchObject({ customerId: CUSTOMERS[1]!.customerId, standId: TAG.standId });
  expect(body).not.toHaveProperty("phone");
});

it("still lets the owner type a number", () => {
  render(<TextRequestComposer balance={BALANCE} tags={[TAG]} recent={[]} customers={CUSTOMERS} />);
  fireEvent.click(screen.getByRole("button", { name: "Type a number instead" }));
  expect(screen.getByLabelText("Mobile number")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Choose from your customers" })).toBeInTheDocument();
});

it("says so when customers couldn't be loaded, instead of showing none", () => {
  render(<TextRequestComposer balance={BALANCE} tags={[TAG]} recent={[]} customers={null} />);
  expect(screen.getByText(/couldn.t be loaded/)).toBeInTheDocument();
  expect(screen.getByLabelText("Mobile number")).toBeInTheDocument();
});

it("with no customers, it is the number field as before", () => {
  render(<TextRequestComposer balance={BALANCE} tags={[TAG]} recent={[]} customers={[]} />);
  expect(screen.getByLabelText("Mobile number")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Type a number instead" })).toBeNull();
});
