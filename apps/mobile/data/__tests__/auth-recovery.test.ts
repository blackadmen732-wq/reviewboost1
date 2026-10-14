// @vitest-environment jsdom
import React, { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  query: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
      signOut: mocks.signOut,
    },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        abortSignal: () => mocks.query(),
      };
      return q;
    },
  },
}));
vi.mock("../review-sign-in", () => ({ signInForReview: vi.fn() }));
import { AuthProvider, useAuth } from "../auth-context";
const session = {
  user: { id: "test-owner", email: "test@example.test", user_metadata: {} },
};
function Probe() {
  const auth = useAuth();
  return createElement(
    "div",
    null,
    createElement(
      "p",
      null,
      JSON.stringify({
        loading: auth.isLoading,
        orgLoading: auth.orgLoading,
        sessionError: auth.sessionError,
        orgError: auth.orgError,
        count: auth.organizations.length,
      }),
    ),
    createElement(
      "button",
      { onClick: () => void auth.refreshOrganizations() },
      "Retry",
    ),
    createElement("button", { onClick: () => void auth.logout() }, "Sign out"),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  mocks.query.mockResolvedValue({ data: [], error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("finishes restoration with a readable error when the session SDK rejects", async () => {
  mocks.getSession.mockRejectedValueOnce(new Error("Offline"));
  render(createElement(AuthProvider, null, createElement(Probe)));
  await screen.findByText(/Could not restore your session/);
  expect(screen.getByText(/sessionError/).textContent).toContain(
    '"loading":false',
  );
});
it("clears organization loading after a rejection and supports a successful retry", async () => {
  mocks.query
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({
      data: [
        {
          org_id: "business",
          role: "owner",
          organizations: { name: "Test business", timezone: "UTC" },
        },
      ],
      error: null,
    });
  render(createElement(AuthProvider, null, createElement(Probe)));
  await screen.findByText(/Could not load your businesses/);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByText(/sessionError/).textContent).toContain('"count":1'),
  );
  expect(screen.getByText(/sessionError/).textContent).toContain(
    '"orgLoading":false',
  );
});
it("ignores a stale organization lookup after signing out", async () => {
  let release: (value: unknown) => void = () => undefined;
  mocks.query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  render(createElement(AuthProvider, null, createElement(Probe)));
  await waitFor(() => expect(mocks.query).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
  await act(async () =>
    release({
      data: [
        {
          org_id: "old-business",
          role: "owner",
          organizations: { name: "Old", timezone: "UTC" },
        },
      ],
      error: null,
    }),
  );
  expect(screen.getByText(/sessionError/).textContent).toContain('"count":0');
});
