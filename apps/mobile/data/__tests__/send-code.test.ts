import { describe, expect, it } from "vitest";

import { FAILED_MESSAGE, THROTTLED_MESSAGE, sendCodeResult } from "../send-code";

describe("sendCodeResult", () => {
  it("is sent when Supabase accepted the request", () => {
    expect(sendCodeResult(null)).toEqual({ kind: "sent" });
  });

  it("still reaches the code step when sending is throttled, without claiming a new code", () => {
    const result = sendCodeResult({ status: 429 });
    expect(result).toEqual({ kind: "throttled", message: THROTTLED_MESSAGE });
    expect(THROTTLED_MESSAGE).not.toMatch(/we sent|new code is on its way/i);
  });

  it("stays on the email step for any other failure", () => {
    expect(sendCodeResult({ status: 400 })).toEqual({ kind: "failed", message: FAILED_MESSAGE });
    expect(sendCodeResult({})).toEqual({ kind: "failed", message: FAILED_MESSAGE });
  });
});
