import { describe, expect, it } from "vitest";

import { relativeDayTime } from "@/lib/utils/relative-day";

describe("relativeDayTime", () => {
  // 3 Nov 2026, 9:00 PM in New York.
  const now = Date.parse("2026-11-04T02:00:00.000Z");
  const zone = "America/New_York";

  it("gives the hour for today and yesterday, on the business's clock", () => {
    expect(relativeDayTime("2026-11-03T19:30:00.000Z", zone, now)).toBe("Today at 2:30 PM");
    expect(relativeDayTime("2026-11-02T23:05:00.000Z", zone, now)).toBe("Yesterday at 6:05 PM");
  });

  it("gives just the day further back", () => {
    expect(relativeDayTime("2026-10-31T15:00:00.000Z", zone, now)).toBe("3 days ago");
    expect(relativeDayTime("2026-10-01T15:00:00.000Z", zone, now)).toBe("Oct 1");
  });
});
