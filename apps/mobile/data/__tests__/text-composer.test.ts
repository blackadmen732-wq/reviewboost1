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

  it("never re-sends when the answer to a send is lost: it finds the request under Recent", async () => {
    fetchMock
      .mockResolvedValueOnce(preview(true))
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({ data: { items: [{ id: "new", recipientLastFour: "0199" }, { id: "old", recipientLastFour: "0199" }] } });
    const sentLater = vi.fn();
    const { result } = renderHook(() => useTextComposer("org-a", { onSentAfterCheck: sentLater }));
    await act(() => result.current.runPreview(draft));
    await act(async () => {
      expect(await result.current.send(draft, new Set(["old"]))).toBe(false);
    });
    await vi.waitFor(() => expect(sentLater).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/text-requests/preview",
      "/api/v1/text-requests",
      "/api/v1/text-requests?limit=10",
    ]);
    expect(result.current.sendCheck.pending).toBe(false);
    expect(result.current.preview).toBeNull();
  });

  it("holds Send while it looks, and says nothing was sent once it knows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMock
        .mockResolvedValueOnce(preview(true))
        .mockRejectedValueOnce(new TypeError("Network request failed"))
        .mockResolvedValue({ data: { items: [{ id: "old", recipientLastFour: "0199" }] } });
      const { result } = renderHook(() => useTextComposer("org-a"));
      await act(() => result.current.runPreview(draft));
      await act(async () => {
        await result.current.send(draft, new Set(["old"]));
      });
      expect(result.current.sendCheck.pending).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(result.current.sendCheck.pending).toBe(false);
      expect(result.current.error).toBe("That text request didn’t go through. Nothing was sent. Try again.");
      const posts = fetchMock.mock.calls.filter(([, , init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(posts.map(([path]) => path)).toEqual(["/api/v1/text-requests/preview", "/api/v1/text-requests"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
