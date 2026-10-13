import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/home",
}));
vi.mock("@/components/ui/toast", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/dashboard/page-transition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => children,
}));

import { SignInFlow } from "@/features/auth/sign-in-flow";
import { OwnerShell } from "@/features/dashboard/owner-shell";
import { EditableRow } from "@/features/dashboard/settings-form";
import { TextRequestComposer } from "@/features/dashboard/text-request-composer";
import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: "local-owner-session" } },
  });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps mobile Settings separate from the four daily destinations", () => {
  render(
    <OwnerShell businessName="Mario’s Pizza">
      <h1>Home</h1>
    </OwnerShell>,
  );
  expect(
    within(screen.getByRole("banner", { name: "Account" })).getByRole("link", {
      name: "Settings",
    }),
  ).toHaveAttribute("href", "/settings");
  const tabs = screen.getByRole("navigation", { name: "Main" });
  expect(within(tabs).getAllByRole("link")).toHaveLength(4);
  expect(within(tabs).queryByRole("link", { name: "Settings" })).toBeNull();
});

it("keeps the email and restores Continue when requesting a code loses the network", async () => {
  auth.signInWithOtp.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  render(<SignInFlow next="/home" />);
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText(/could not reach reviewboost/i);
  expect(screen.getByLabelText("Email address")).toHaveValue("owner@example.test");
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});

it("keeps an unsaved setting editable after a dropped request", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")),
  );
  render(
    <EditableRow
      field="organizationName"
      label="Business"
      value="Mario’s Pizza"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  fireEvent.change(screen.getByLabelText("Business"), {
    target: { value: "Mario’s Pizza House" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Business")).toHaveValue("Mario’s Pizza House");
  expect(screen.getByLabelText("Business")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(refresh).not.toHaveBeenCalled();
});

it("opens a prepared preview through a native link rather than an async popup", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { standUrl: "https://reviewboost.fit/q/local-sample" },
        }),
        { status: 200 },
      ),
    ),
  );
  render(<PreviewCustomerPage standId="local-tag" />);
  const link = await screen.findByRole("link", {
    name: /preview customer page/i,
  });
  expect(link).toHaveAttribute(
    "href",
    "https://reviewboost.fit/q/local-sample",
  );
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

it("records consent separately and never includes it in the send request", async () => {
  const eligibility = {
    allowed: false,
    reason: "no_consent",
    message: "No agreement recorded.",
  };
  const fetcher = vi
    .fn()
    .mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify({
            data: url.endsWith("/preview")
              ? {
                  body: "Local shop: Thanks. https://example.test/q/test Reply STOP to opt out.",
                  segments: 1,
                  encoding: "gsm7",
                  unitCount: 80,
                  recipientLastFour: "0123",
                  eligibility,
                  consentStatement:
                    "This customer agreed to receive a review request.",
                }
              : url.endsWith("/consent")
                ? {
                    eligibility: { allowed: true, reason: null, message: null },
                  }
                : {},
          }),
          { status: 200 },
        ),
    );
  vi.stubGlobal("fetch", fetcher);
  render(
    <TextRequestComposer
      balance={{ monthly: 10, purchased: 0, total: 10 }}
      tags={[{ standId: "local-tag", label: "Counter", locationName: null }]}
      recent={[]}
      canSendRequests
    />,
  );
  const phone = screen.getByLabelText("Customer's mobile number");
  fireEvent.change(phone, { target: { value: "+15555550123" } });
  // One button at a time: Preview first, never Send before a preview.
  expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview text" }));
  await screen.findByRole("heading", {
    name: "Did this customer agree to a text?",
  });
  // With no agreement on record, the only action is recording it.
  expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
  const saveAgreement = screen.getByRole("button", { name: "Save their agreement" });
  expect(saveAgreement).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /in person/i }));
  expect(saveAgreement).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: /this customer agreed/i }),
  );
  fireEvent.click(saveAgreement);
  const send = await screen.findByRole("button", { name: "Send to ••• 0123" });
  const consentCall = fetcher.mock.calls.find(([url]) =>
    url.endsWith("/consent"),
  );
  expect(JSON.parse(consentCall![1].body)).toMatchObject({
    phone: "+15555550123",
    method: "in_person",
    confirmed: true,
    wordingVersion: "owner-attestation-v1",
  });
  fireEvent.click(send);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetcher.mock.calls[2]![1].body)).toEqual({
    phone: "+15555550123",
    standId: "local-tag",
    templateId: "thanks_v1",
  });
  await waitFor(() => expect(phone).toHaveValue(""));
  expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Preview text" })).toBeDisabled();
});
