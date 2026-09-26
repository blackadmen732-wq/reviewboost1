import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { FeedbackTabs } from "@/features/dashboard/feedback-tabs";
import { InsightsView } from "@/features/dashboard/insights/insights-view";
import { OwnerHome } from "@/features/dashboard/owner-home";
import { deriveHomeModel } from "@/features/dashboard/home-model";
import {
  insightPeriods,
  insightsHomeLine,
  summarizeInsights,
  type InsightRange,
  type InsightRow,
} from "@/lib/owner/insights";

/**
 * Feedback → Insights, rendered.
 *
 * The rules live in lib/owner/insights.ts and are tested there; this checks
 * the screen says exactly what those rules allow, at every amount of data, and
 * nothing they do not.
 */

const NOW = new Date("2026-09-24T19:30:00Z");
const TZ = "America/New_York";
const ONE_PLACE = [{ locationId: "loc-downtown", name: "Downtown" }];
const TWO_PLACES = [...ONE_PLACE, { locationId: "loc-coral", name: "Coral Springs" }];

function times(n: number, rating: number): number[] {
  return Array.from({ length: n }, () => rating);
}

function build(
  spec: { previous?: number[]; buckets?: number[][]; today?: number[]; earlier?: boolean },
  range: InsightRange = 30,
) {
  const periods = insightPeriods(TZ, range, NOW);
  const rows: InsightRow[] = [];
  const add = (bucket: number, ratings: number[]) => {
    const tally = new Map<number, number>();
    for (const rating of ratings) tally.set(rating, (tally.get(rating) ?? 0) + 1);
    for (const [rating, responses] of tally) rows.push({ bucket, rating, responses });
  };
  add(1, spec.previous ?? []);
  (spec.buckets ?? []).forEach((ratings, index) => add(index + 2, ratings));
  add(periods.buckets.length + 2, spec.today ?? []);
  return summarizeInsights(periods, rows, spec.earlier ?? false);
}

/**
 * A realistic month, day by day: 84 ratings on 29 of 30 days (day 10 had
 * none), averaging 4.27 (shown 4.3), against 71 averaging 4.0.
 */
const MONTH: number[][] = Array.from({ length: 30 }, (_, day) => {
  if (day === 10) return [];
  if (day === 20) return [5, 4, 1];
  if (day === 5 || day === 15 || day === 25) return [4, 4];
  return [5, 4, 4];
});

const FULL = {
  previous: [...times(61, 4), ...times(5, 5), ...times(5, 3)],
  buckets: MONTH,
};

function renderView(insights: ReturnType<typeof build>, locations = ONE_PLACE, locationId: string | null = null) {
  return render(<InsightsView insights={insights} locations={locations} locationId={locationId} />);
}

beforeEach(() => push.mockReset());

describe("no ratings ever", () => {
  it("says so plainly, and offers nothing to filter", async () => {
    const { container } = renderView(build({}));
    expect(screen.getByRole("heading", { name: "No customer feedback yet." })).toBeVisible();
    expect(screen.getByText("Your insights will appear as customers respond.")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Period" })).toBeNull();
    expect(screen.queryByRole("img", { name: /average rating/i })).toBeNull();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("a quiet period", () => {
  it("names the empty period, mentions today, and offers a longer view", () => {
    renderView(build({ earlier: true, today: [5, 4] }, 7));
    expect(screen.getByRole("heading", { name: "No ratings in the last 7 days." })).toBeVisible();
    expect(screen.getByText("Plus 2 ratings today. They join these numbers tomorrow.")).toBeVisible();
    expect(screen.getByRole("link", { name: "See the last 90 days" })).toHaveAttribute(
      "href",
      "/feedback/insights?days=90",
    );
  });
});

describe("1 to 9 ratings", () => {
  const starting = build({ previous: times(30, 4), buckets: [[5, 4], [], [1]] });

  it("shows the count and the spread, and no average, trend or direction", async () => {
    const { container } = renderView(starting);
    expect(screen.getByText("3 ratings")).toBeVisible();
    expect(screen.queryByText("/ 5")).toBeNull();
    expect(screen.queryByText(/Improving|About the same|Declining/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Average rating" })).toBeNull();
    expect(screen.getByText(/starting to collect feedback/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "How customers rated you" })).toBeVisible();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("10 or more ratings", () => {
  const full = build(FULL);

  it("leads with the average and the ratings it rests on", () => {
    renderView(full);
    expect(full.current.total).toBe(84);
    const summary = screen.getByRole("region", { name: "Customer experience" });
    expect(within(summary).getByText("4.3")).toBeVisible();
    expect(within(summary).getByText("/ 5")).toBeVisible();
    expect(screen.getByText("84 ratings · Aug 25 – Sep 23")).toBeVisible();
  });

  it("compares with the previous period and names its exact days", () => {
    renderView(full);
    expect(screen.getByText("Improving")).toBeVisible();
    expect(screen.getByText("· from 4.0")).toBeVisible();
    expect(screen.getByText("Previous 30 days: Jul 26 – Aug 24 · 71 ratings")).toBeVisible();
  });

  it("does not compare with a previous period that had too few ratings", () => {
    renderView(build({ ...FULL, previous: times(9, 2) }));
    const summary = screen.getByRole("region", { name: "Customer experience" });
    expect(within(summary).getByText("4.3")).toBeVisible();
    expect(screen.queryByText(/Improving|About the same|Declining/)).toBeNull();
  });

  it("draws the month day by day, breaking the line where nobody rated", () => {
    const { container } = renderView(full);
    const chart = screen.getByRole("img", { name: /average rating by day, aug 25 – sep 23/i });
    expect(chart).toBeVisible();
    // Day 10 had no ratings: two runs, not one line bridged across it.
    expect(container.querySelectorAll('[data-testid="trend-line"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="trend-area"]')).toHaveLength(2);
    // A clean month line: only the latest point carries a dot until one is chosen.
    expect(container.querySelectorAll('[data-testid="trend-point"]')).toHaveLength(1);
  });

  it("dates the axis a week apart, counted back from yesterday", () => {
    renderView(full);
    expect(screen.getAllByTestId("trend-tick").map((tick) => tick.textContent)).toEqual([
      "Aug 26",
      "Sep 2",
      "Sep 9",
      "Sep 16",
      "Sep 23",
    ]);
  });

  it("leaves the wash out under short runs between gaps", () => {
    const gappy = MONTH.map((day, index) => (index % 4 === 1 ? [] : day));
    const { container } = renderView(build({ ...FULL, buckets: gappy }));
    expect(container.querySelectorAll('[data-testid="trend-line"]').length).toBeGreaterThan(3);
    expect(container.querySelectorAll('[data-testid="trend-area"]')).toHaveLength(0);
  });

  it("puts the change in words beside the chart", () => {
    renderView(full);
    expect(screen.getByText("Up 0.3 on the previous 30 days · Each point is one day")).toBeVisible();
  });

  it("lists every day in a table, gaps included", () => {
    renderView(full);
    const table = screen.getByRole("table", { name: "Average rating by day, Aug 25 – Sep 23" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(30);
    expect(within(rows[10]!).getByText("No ratings")).toBeInTheDocument();
    expect(within(rows[10]!).getByText("0")).toBeInTheDocument();
  });

  it("reads out a day on keyboard focus — date, average, ratings — and moves with the arrows", () => {
    renderView(full);
    const chart = screen.getByRole("img", { name: /average rating by day/i });
    fireEvent.focus(chart);
    const tooltip = () => screen.getByTestId("trend-tooltip");
    expect(tooltip()).toHaveTextContent("Sep 23");
    expect(tooltip()).toHaveTextContent("4.3 average");
    expect(tooltip()).toHaveTextContent("3 ratings");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(tooltip()).toHaveTextContent("Aug 25");
    for (let step = 0; step < 10; step += 1) fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(tooltip()).toHaveTextContent("Sep 4");
    expect(tooltip()).toHaveTextContent("No ratings");
    expect(screen.getByTestId("trend-crosshair")).toBeInTheDocument();
  });

  it("keeps the real 1–5 scale in view: 5, 4, 3 — and lower only if the data goes lower", () => {
    const { container, unmount } = renderView(full);
    const labels = () =>
      [...container.querySelectorAll("figure span")]
        .map((span) => span.textContent)
        .filter((text) => /^[1-5]$/.test(text ?? ""));
    expect(labels()).toEqual(["5", "4", "3"]);
    unmount();

    const rough = MONTH.map((day, index) => (index === 3 ? [2, 2, 1] : day));
    const view = renderView(build({ ...FULL, buckets: rough }));
    expect(
      [...view.container.querySelectorAll("figure span")]
        .map((span) => span.textContent)
        .filter((text) => /^[1-5]$/.test(text ?? "")),
    ).toEqual(["5", "4", "3", "2", "1"]);
  });

  it("dots every day of a week, where each point matters", () => {
    const week = build({ previous: times(12, 4), buckets: [[5, 4], [4], [4, 4], [], [3, 5], [5, 5], [4, 5]] }, 7);
    const { container } = renderView(week);
    expect(container.querySelectorAll('[data-testid="trend-point"]')).toHaveLength(6);
    expect(screen.getAllByTestId("trend-tick").map((tick) => tick.textContent)).toEqual([
      "Sep 17",
      "Sep 19",
      "Sep 21",
      "Sep 23",
    ]);
  });

  it("opens the ratings behind each star row in Everything, same days and place", () => {
    renderView(full, TWO_PLACES, "loc-coral");
    const link = screen.getByRole("link", { name: /^1 star: 1 rating\. Show them\.$/ });
    const url = new URL(link.getAttribute("href")!, "https://reviewboost.fit");
    expect(url.pathname).toBe("/feedback");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      show: "all",
      rating: "1",
      location: "loc-coral",
      from: "2026-08-25",
      to: "2026-09-23",
    });
  });

  it("does not link a star value nobody chose", () => {
    renderView(build({ buckets: [times(12, 5)] }));
    expect(screen.getByRole("img", { name: "2 stars: 0 ratings" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /2 stars/ })).toBeNull();
  });

  it("passes an accessibility audit", async () => {
    const { container } = renderView(full, TWO_PLACES);
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe("what the screen never shows", () => {
  it("has no percentages, scores, themes or Google activity", () => {
    const { container } = renderView(build(FULL), TWO_PLACES);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/score|health|theme|benchmark|top \d|google|reviews? (received|posted)/i);
    expect(text).not.toMatch(/significan/i);
  });

  it("keeps gold for the star icons and ink for the bars", () => {
    const { container } = renderView(build(FULL));
    const bars = container.querySelectorAll("li span.bg-ink\\/70");
    expect(bars).toHaveLength(5);
    expect(container.innerHTML).not.toMatch(/bg-\[color:var\(--rb-star\)\]/);
  });
});

describe("filters", () => {
  it("offers 7, 30 and 90 days, marking the current one", () => {
    renderView(build(FULL, 30), TWO_PLACES, "loc-coral");
    const period = screen.getByRole("navigation", { name: "Period" });
    const links = within(period).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["7 days", "30 days", "90 days"]);
    expect(links[1]).toHaveAttribute("aria-current", "true");
    // The place is kept when the period changes.
    expect(links[0]).toHaveAttribute("href", "/feedback/insights?days=7&location=loc-coral");
    expect(links[1]).toHaveAttribute("href", "/feedback/insights?location=loc-coral");
  });

  it("shows no location picker for a business with one place", () => {
    renderView(build(FULL), ONE_PLACE);
    expect(screen.queryByRole("combobox", { name: "Location" })).toBeNull();
  });

  it("offers All locations and each place when there are two or more", () => {
    renderView(build(FULL), TWO_PLACES);
    const picker = screen.getByRole("combobox", { name: "Location" });
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All locations",
      "Downtown",
      "Coral Springs",
    ]);
    fireEvent.change(picker, { target: { value: "loc-coral" } });
    expect(push).toHaveBeenCalledWith("/feedback/insights?location=loc-coral");
  });

  it("names an empty location rather than the whole business", () => {
    renderView(build({}), TWO_PLACES, "loc-coral");
    expect(screen.getByRole("heading", { name: "No customer feedback for Coral Springs yet." })).toBeVisible();
    // And keeps the way back to all locations.
    expect(screen.getByRole("combobox", { name: "Location" })).toHaveValue("loc-coral");
  });
});

describe("Feedback tabs", () => {
  it("are Needs you, Everything and Insights, one of them current", () => {
    render(<FeedbackTabs active="insights" />);
    const nav = screen.getByRole("navigation", { name: "Feedback views" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Needs you", "/feedback"],
      ["Everything", "/feedback?show=all"],
      ["Insights", "/feedback/insights"],
    ]);
    expect(links[2]).toHaveAttribute("aria-current", "page");
    expect(links[0]).not.toHaveAttribute("aria-current");
  });
});

describe("Home's one line", () => {
  const counts = {
    ratingsToday: 0,
    unread: 0,
    activeStands: 1,
    recentCount: 20,
    hasGoogleLink: true,
  };
  const stands = [
    { standId: "s1", label: "Front", status: "active", nfcProvisionedAt: "2026-09-01T00:00:00Z", tokenRotatedAt: null },
  ];

  it("summarises a full month and points to Insights", () => {
    const line = insightsHomeLine(build(FULL));
    expect(line).toBe("4.3 average · 84 ratings · Improving");
    render(
      <OwnerHome
        businessName="Mario's"
        model={deriveHomeModel({ counts, stands, hasLocation: true })}
        unreadItems={[]}
        insightsLine={line}
      />,
    );
    const link = screen.getByRole("link", { name: /View insights/ });
    expect(link).toHaveAttribute("href", "/feedback/insights");
    expect(link).toHaveTextContent("Last 30 days");
    expect(link).toHaveTextContent("4.3 average · 84 ratings · Improving");
    // A line, never a chart.
    expect(screen.queryByRole("img", { name: /average rating/i })).toBeNull();
  });

  it("leaves the direction out when there was nothing to compare with", () => {
    expect(insightsHomeLine(build({ ...FULL, previous: [] }))).toBe("4.3 average · 84 ratings");
  });

  it("says nothing on a thin month", () => {
    expect(insightsHomeLine(build({ buckets: [times(9, 5)] }))).toBeNull();
    expect(insightsHomeLine(build({}))).toBeNull();
  });
});
