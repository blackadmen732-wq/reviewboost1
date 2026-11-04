import { describe, expect, it } from "vitest";

import {
  CODE_NOT_ANSWERING_MESSAGE,
  EMAIL_INCOMPLETE_MESSAGE,
  FAILED_MESSAGE,
  NOT_ANSWERING_MESSAGE,
  OFFLINE_CODE_MESSAGE,
  OFFLINE_SEND_MESSAGE,
  SLOW_CODE_MESSAGE,
  SLOW_SEND_MESSAGE,
  THROTTLED_MESSAGE,
  TOO_MANY_TRIES_MESSAGE,
  WRONG_CODE_MESSAGE,
  authUnreachable,
  isCompleteEmail,
  sendCodeResult,
  verifyCodeResult,
} from "../send-code";

/** What Supabase Auth hands back when the fetch itself threw (no signal). */
const NO_SIGNAL = { name: "AuthRetryableFetchError", status: 0 };

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

  it("blames the connection, not the address, when nothing answered", () => {
    expect(authUnreachable(NO_SIGNAL)).toBe(true);
    const result = sendCodeResult(NO_SIGNAL);
    expect(result).toEqual({ kind: "failed", message: OFFLINE_SEND_MESSAGE });
    expect(OFFLINE_SEND_MESSAGE).not.toMatch(/address/i);
  });

  it("says ReviewBoost is not answering on a server error", () => {
    expect(sendCodeResult({ name: "AuthRetryableFetchError", status: 503 })).toEqual({
      kind: "failed",
      message: NOT_ANSWERING_MESSAGE,
    });
    expect(sendCodeResult({ status: 500 })).toEqual({ kind: "failed", message: NOT_ANSWERING_MESSAGE });
  });
});

describe("verifyCodeResult", () => {
  it("signs in when Supabase accepted the code", () => {
    expect(verifyCodeResult(null)).toEqual({ kind: "signed-in" });
  });

  it("calls a refused code wrong, and points at the newest one", () => {
    expect(verifyCodeResult({ name: "AuthApiError", status: 403 })).toEqual({
      kind: "wrong",
      message: WRONG_CODE_MESSAGE,
    });
    expect(WRONG_CODE_MESSAGE).toMatch(/newest/);
  });

  it("keeps a good code when the phone is offline or the server is down", () => {
    expect(verifyCodeResult(NO_SIGNAL)).toEqual({ kind: "retry", message: OFFLINE_CODE_MESSAGE });
    expect(verifyCodeResult({ name: "AuthRetryableFetchError", status: 502 })).toEqual({
      kind: "retry",
      message: CODE_NOT_ANSWERING_MESSAGE,
    });
    expect(verifyCodeResult({ status: 429 })).toEqual({ kind: "retry", message: TOO_MANY_TRIES_MESSAGE });
    for (const message of [OFFLINE_CODE_MESSAGE, CODE_NOT_ANSWERING_MESSAGE, SLOW_CODE_MESSAGE]) {
      expect(message).not.toMatch(/not right|wrong|didn’t work/i);
    }
  });

  it("keeps every sign-in line to twelve words or fewer", () => {
    for (const message of [
      OFFLINE_SEND_MESSAGE,
      SLOW_SEND_MESSAGE,
      NOT_ANSWERING_MESSAGE,
      WRONG_CODE_MESSAGE,
      OFFLINE_CODE_MESSAGE,
      SLOW_CODE_MESSAGE,
      CODE_NOT_ANSWERING_MESSAGE,
      TOO_MANY_TRIES_MESSAGE,
      EMAIL_INCOMPLETE_MESSAGE,
    ]) {
      expect(message.split(/\s+/).length, message).toBeLessThanOrEqual(12);
    }
  });
});

describe("isCompleteEmail", () => {
  it("accepts an address a code can reach", () => {
    for (const address of ["owner@salon.com", "rosa.hair@studio.co.uk", "a@b.io", " owner@shop.com "]) {
      expect(isCompleteEmail(address), address).toBe(true);
    }
  });

  it("refuses the mistakes a thumb makes before a code goes nowhere", () => {
    for (const address of ["fresh.app.salon@example", "owner@", "@shop.com", "owner@shop.", "owner@shop.c", "owner shop@x.com", "owner@@shop.com"]) {
      expect(isCompleteEmail(address), address).toBe(false);
    }
  });
});
