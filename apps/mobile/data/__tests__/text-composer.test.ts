/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("expo-crypto", () => ({ randomUUID: vi.fn(() => `key-${Math.random().toString(16).slice(2)}`) }));
vi.mock("../api", () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));

import * as api from "../api";
import { useTextComposer, type TextPreview } from "../text-composer";

const fetchMock = api.apiFetch as ReturnType<typeof vi.fn>;
const draft = { phone: " +1 555 010 0199 ", standId: "stand-1", templateId: "thanks_v1" };
const preview = (allowed: boolean, reason: string | null = null): { data: TextPreview } => ({
  data: {
    body: "Mario's Pizza: Thanks for visiting today. How did we do? https://reviewboost.fit/q/abc\nReply STOP to opt out.",
    segments: 1,
    encoding: "GSM-7",
    unitCount: 120,
    recipientLastFour: "0199",
    eligibility: { allowed, reason, message: allowed ? null : "No agreement is on record for this number." },
    consentStatement: "I confirm this customer agreed to receive a text from Mario's Pizza asking about their visit.",
  },
});
const bodyOf = (index: number) => JSON.parse((fetchMock.mock.calls[index]![2] as RequestInit).body as string);

beforeEach(() => fetchMock.mockReset());

describe("sending one text request", () => {
  it("previews the exact text, then sends what was previewed with one key", async () => {
    fetchMock.mockResolvedValueOnce(preview(true)).mockResolvedValueOnce({ data: { created: true } });
    const { result } = renderHook(() => useTextComposer("org-a"));
    await act(() => result.current.runPreview(draft));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/text-requests/preview");
    expect(bodyOf(0)).toEqual({ phone: "+1 555 010 0199", standId: "stand-1", templateId: "thanks_v1" });

    await act(async () => {
      expect(await result.current.send(draft)).toBe(true);
    });
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/v1/text-requests");
    const sent = bodyOf(1);
    expect(sent).toMatchObject({ phone: "+1 555 010 0199", standId: "stand-1", templateId: "thanks_v1" });
    expect(typeof sent.idempotencyKey).toBe("string");
    // Sending never carries or records consent.
    expect(sent).not.toHaveProperty("consent");
    expect(result.current.preview).toBeNull();
  });

  it("will not send a number with no agreement on record", async () => {
    fetchMock.mockResolvedValueOnce(preview(false, "no_consent"));
    const { result } = renderHook(() => useTextComposer("org-a"));
    await act(() => result.current.runPreview(draft));
    await act(async () => {
      expect(await result.current.send(draft)).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records agreement only as its own explicit step, then allows the send", async () => {
    fetchMock
      .mockResolvedValueOnce(preview(false, "no_consent"))
      .mockResolvedValueOnce({ data: { eligibility: { allowed: true, reason: null, message: null } } });
    const { result } = renderHook(() => useTextComposer("org-a"));
    await act(() => result.current.runPreview(draft));
    await act(async () => {
      await result.current.recordConsent(draft, "in_person", "owner-attestation-v1");
    });
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/v1/text-requests/consent");
    expect(bodyOf(1)).toEqual({
      phone: "+1 555 010 0199",
      standId: "stand-1",
      method: "in_person",
      wordingVersion: "owner-attestation-v1",
      confirmed: true,
    });
    expect(result.current.preview?.eligibility.allowed).toBe(true);
  });

  it("never re-sends when the answer to a send is lost; it asks to check Recent", async () => {
    fetchMock.mockResolvedValueOnce(preview(true)).mockRejectedValueOnce(new TypeError("Network request failed"));
    const { result } = renderHook(() => useTextComposer("org-a"));
    await act(() => result.current.runPreview(draft));
    await act(async () => {
      expect(await result.current.send(draft)).toBe(false);
    });
    expect(result.current.sendUncertain).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
