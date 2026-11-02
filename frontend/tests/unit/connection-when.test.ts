import { describe, expect, it } from "vitest";

import { formatWhen, formatWhenStable } from "@/features/connections/connection-words";

/** "Last updated" on a connected app, in words a person uses. */
describe("when a connection last updated", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  it("says minutes and hours for the last few hours", () => {
    expect(formatWhen(ago(0), now)).toBe("Just now");
    expect(formatWhen(ago(1), now)).toBe("1 minute ago");
    expect(formatWhen(ago(24), now)).toBe("24 minutes ago");
    expect(formatWhen(ago(60), now)).toBe("1 hour ago");
    expect(formatWhen(ago(5 * 60 + 59), now)).toBe("5 hours ago");
  });

  it("gives the date and time after that, and 'Not yet' with nothing", () => {
    expect(formatWhen(ago(7 * 60), now)).toMatch(/Nov 2/);
    expect(formatWhen(null, now)).toBe("Not yet");
    expect(formatWhen("not a date", now)).toBe("Not yet");
  });

  it("prints the same thing on the server and in any browser before hydration", () => {
    // UTC and English, whatever the machine: the server and the first browser
    // pass must agree or React reports a mismatch.
    expect(formatWhenStable("2026-11-02T03:30:00Z")).toBe("Nov 2");
    expect(formatWhenStable(null)).toBe("Not yet");
  });
});
