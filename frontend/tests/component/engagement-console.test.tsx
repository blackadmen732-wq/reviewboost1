import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EngagementConsole } from "@/features/dashboard/engagement-console";
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-owner-token" } },
      }),
    },
  }),
}));
const report = {
  program: {
    enabled: false,
    loyaltyEnabled: false,
    remindersEnabled: false,
    stampsRequired: 10,
    rewardLabel: "A free coffee",
  },
  experiments: [],
  recent: [],
  members: [],
  eventCounts: {},
  configuredProviders: [],
};
afterEach(() => vi.unstubAllGlobals());
describe("loyalty owner controls", () => {
  it("does not enable preparation without a delivery connection and scopes every request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(report));
    vi.stubGlobal("fetch", fetcher);
    render(
      <EngagementConsole
        orgId="selected-business"
        businessName="Corner Cafe"
      />,
    );
    await screen.findByText("Delivery is not connected");
    expect(
      screen.getByRole("button", { name: "Prepare messages" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Enable this program" }),
    ).not.toBeChecked();
    expect(
      (fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>)[
        "X-Organization-Id"
      ],
    ).toBe("selected-business");
  });
  it("shows an error instead of invented zero metrics when reporting fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "Reporting is unavailable" } },
          { status: 503 },
        ),
      ),
    );
    render(<EngagementConsole orgId="business" businessName="Corner Cafe" />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Reporting is unavailable",
      ),
    );
    expect(
      screen.queryByText("Recorded purchases · 30 days"),
    ).not.toBeInTheDocument();
  });
});
