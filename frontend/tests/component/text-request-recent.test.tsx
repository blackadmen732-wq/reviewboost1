import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) }));

import { TextRequestComposer } from "@/features/dashboard/text-request-composer";

/**
 * Recent Text Requests: what moves and what does not. A row that was there
 * when the page opened is simply there; one that arrives after a send settles
 * in; a status that moves on fades to the new one. Nothing else animates.
 */
const balance = { monthly: 40, purchased: 0, total: 40 };
const tags = [{ standId: "s1", label: "Counter", locationName: null }];
const row = (id: string, status: string) => ({
  id,
  status,
  segments: 1,
  recipientLastFour: id.padStart(4, "0").slice(-4),
  createdAt: "2026-09-26T12:00:00Z",
});

function draw(recent: ReturnType<typeof row>[]) {
  return <TextRequestComposer balance={balance} tags={tags} recent={recent} canSendRequests />;
}

describe("Recent Text Requests", () => {
  it("animates nothing on arrival", () => {
    const { container } = render(draw([row("1", "delivered"), row("2", "sending")]));
    expect(container.querySelector(".animate-row-in, [class*='animate-fade-in']")).toBeNull();
  });

  it("settles in only the row just sent, and fades only the status that moved", () => {
    const { container, rerender } = render(draw([row("1", "delivered"), row("2", "sending")]));
    rerender(draw([row("3", "queued"), row("1", "delivered"), row("2", "delivered")]));
    const arrived = container.querySelectorAll(".animate-row-in");
    expect(arrived).toHaveLength(1);
    expect(arrived[0]).toHaveTextContent("0003");
    const moved = container.querySelectorAll("li .animate-fade-in");
    expect(moved).toHaveLength(1);
    expect(moved[0]).toHaveTextContent("Delivered");
    expect(moved[0]?.closest("li")).toHaveTextContent("0002");
    expect(screen.getAllByText("Delivered")).toHaveLength(2);
  });
});
