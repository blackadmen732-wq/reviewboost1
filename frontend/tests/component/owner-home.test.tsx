import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/owner-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/owner-fetch")>()),
  ownerFetch: vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: { standUrl: "https://reviewboost.fit/q/sample" },
        }),
        { status: 200 },
      ),
  ),
}));

import { OwnerHome } from "@/features/dashboard/owner-home";
import {
  deriveHomeModel,
  type HomeCounts,
  type HomeStand,
} from "@/features/dashboard/home-model";

const emptyCounts: HomeCounts = {
  ratingsToday: 0,
  unread: 0,
  activeStands: 0,
  recentCount: 0,
  hasGoogleLink: true,
};

const stand: HomeStand = {
  standId: "stand-1",
  label: "Counter",
  status: "active",
  nfcProvisionedAt: null,
  tokenRotatedAt: null,
};

const programmed: HomeStand = {
  ...stand,
  nfcProvisionedAt: "2026-09-01T00:00:00.000Z",
};

describe("OwnerHome", () => {
  it("empty without a tag names the blocker and one primary action", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [],
      hasLocation: true,
    });

    render(
      <OwnerHome businessName="Oak & Vine" model={model} unreadItems={[]} />,
    );

    expect(screen.getByRole("heading", { name: "Oak & Vine" })).toBeVisible();
    expect(screen.getByText("No tag yet")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create a Tag" })).toHaveAttribute(
      "href",
      "/stands",
    );
    expect(
      screen.queryByRole("link", { name: "Print your code" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Preview customer page")).not.toBeInTheDocument();
    expect(screen.queryByText("Praise")).not.toBeInTheDocument();
    expect(screen.queryByText("Customers")).not.toBeInTheDocument();
  });

  it("empty without a tag or Google link still starts at Create a Tag", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false },
      stands: [],
      hasLocation: true,
    });

    render(
      <OwnerHome businessName="Oak & Vine" model={model} unreadItems={[]} />,
    );

    expect(screen.getByText("No tag yet")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create a Tag" })).toHaveAttribute(
      "href",
      "/stands",
    );
    expect(
      screen.queryByRole("link", { name: "Add Google link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Print your code" }),
    ).not.toBeInTheDocument();
  });

  it("empty missing Google link blocks the loop before print", async () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false },
      stands: [stand],
      hasLocation: true,
    });

    render(
      <OwnerHome businessName="Oak & Vine" model={model} unreadItems={[]} />,
    );

    expect(screen.getByText("Google link is missing")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Add Google link" }),
    ).toHaveAttribute("href", "/settings");
    expect(
      screen.queryByRole("link", { name: "Print your code" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: /Preview customer page/ }),
    ).toBeVisible();
  });

  it("empty with an unprogrammed tag offers print and preview, not a second green CTA", async () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [stand],
      hasLocation: true,
    });

    render(
      <OwnerHome businessName="Oak & Vine" model={model} unreadItems={[]} />,
    );

    expect(screen.getByText("Tag is not programmed yet")).toBeVisible();
    expect(screen.getByRole("link", { name: "Print your code" })).toBeVisible();
    expect(
      await screen.findByRole("link", { name: /Preview customer page/ }),
    ).toBeVisible();
    // Besides those two, only the quiet way to the full steps.
    expect(screen.getByRole("link", { name: /See all steps/ })).toHaveAttribute("href", "/stands");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("ready empty waits honestly", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [programmed],
      hasLocation: true,
    });

    render(
      <OwnerHome businessName="Oak & Vine" model={model} unreadItems={[]} />,
    );

    expect(screen.getByText("No ratings yet.")).toBeVisible();
    expect(
      screen.getByText("Your tag is ready. Put it where people pay."),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Print your code" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create a Tag" }),
    ).not.toBeInTheDocument();
  });

  it("returning home shows real unread rows and one green CTA", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 6, unread: 1 },
      stands: [stand],
      hasLocation: true,
    });

    render(
      <OwnerHome
        businessName="Oak & Vine"
        model={model}
        unreadItems={[
          {
            id: "r1",
            rating: 2,
            note: "Waited twenty minutes.",
            submittedAt: "2026-09-08T12:00:00.000Z",
            isRead: false,
            isResolved: false,
            noteCount: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText("1 new rating")).toBeVisible();
    expect(screen.getByText("Waited twenty minutes.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Read feedback" })).toHaveAttribute(
      "href",
      "/feedback",
    );
    expect(screen.getByText("1 tag · not programmed yet")).toBeVisible();
    expect(screen.queryByText("No ratings yet.")).not.toBeInTheDocument();
  });
});

describe("setup steps finished since the last visit", () => {
  // A Tag made and programmed, nothing rated yet: some steps done, some not.
  const model = () =>
    deriveHomeModel({
      counts: { ...emptyCounts, activeStands: 1 },
      stands: [programmed],
      hasLocation: true,
      hasCustomerPhoto: false,
    });

  it("draw nothing on a first visit, where everything would be new", () => {
    const { container } = render(
      <OwnerHome
        businessName="Oak & Vine"
        model={model()}
        unreadItems={[]}
        seenDone={null}
      />,
    );
    expect(container.querySelector("[data-fresh]")).toBeNull();
    expect(container.querySelector(".animate-check-draw")).toBeNull();
  });

  it("draw the tick once for a step done since then, and only that one", () => {
    const m = model();
    const done = (m.setup ?? [])
      .filter((step) => step.done)
      .map((step) => step.key);
    expect(done.length).toBeGreaterThan(0);
    const { container } = render(
      <OwnerHome
        businessName="Oak & Vine"
        model={m}
        unreadItems={[]}
        seenDone={done.slice(1)}
      />,
    );
    const fresh = container.querySelectorAll("[data-fresh]");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.closest("[data-setup-step]")).toHaveAttribute(
      "data-setup-step",
      done[0],
    );
  });

  it("draw nothing when every done step was already seen", () => {
    const m = model();
    const done = (m.setup ?? [])
      .filter((step) => step.done)
      .map((step) => step.key);
    const { container } = render(
      <OwnerHome
        businessName="Oak & Vine"
        model={m}
        unreadItems={[]}
        seenDone={done}
      />,
    );
    expect(container.querySelector("[data-fresh]")).toBeNull();
    expect(container.querySelector(".animate-step-current")).toBeNull();
  });
});

describe("parseSetupSeen", () => {
  it("reads step keys and treats anything mangled as a first visit", async () => {
    const { parseSetupSeen } =
      await import("@/features/dashboard/setup-seen-cookie");
    expect(parseSetupSeen(undefined)).toBeNull();
    expect(parseSetupSeen("tag%2Cgoogle")).toEqual(["tag", "google"]);
    expect(parseSetupSeen("%E0%A4%A")).toBeNull();
    expect(parseSetupSeen("tag,<script>,google")).toEqual(["tag", "google"]);
  });
});
