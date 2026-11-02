import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }));

import { TextRequestComposer } from "@/features/dashboard/text-request-composer";

/**
 * An empty balance says why when the plan explains it. A trial includes no
 * texts, and a bare "0 texts left" read like a broken page to a trial owner.
 */
const tags = [{ standId: "s1", label: "Counter", locationName: null }];
const empty = { monthly: 0, purchased: 0, total: 0 };

function draw(planStatus: "trialing" | "active" | null, balance = empty) {
  return (
    <TextRequestComposer balance={balance} tags={tags} recent={[]} canSendRequests planStatus={planStatus} />
  );
}

describe("Text Requests balance", () => {
  it("tells a trial owner that texts start with the paid plan", () => {
    render(draw("trialing"));
    expect(screen.getByText(/free trial doesn't include texts/i)).toBeVisible();
  });

  it("tells a business with no plan that texts come with one", () => {
    render(draw(null));
    expect(screen.getByText("Texts come with a paid plan.")).toBeVisible();
  });

  it("keeps the plain count when a paid plan has used its texts", () => {
    const { container } = render(draw("active"));
    expect(container.querySelector("[data-empty-balance-reason]")).toBeNull();
  });

  it("says nothing extra when there are texts left", () => {
    const { container } = render(draw("trialing", { monthly: 10, purchased: 0, total: 10 }));
    expect(container.querySelector("[data-empty-balance-reason]")).toBeNull();
  });
});
