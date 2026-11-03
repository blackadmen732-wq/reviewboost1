/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

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
import { useFeedbackDetail } from "../use-feedback-detail";

const fetchMock = api.apiFetch as ReturnType<typeof vi.fn>;
const ApiError = api.ApiError as unknown as new (message: string, status: number) => Error;

const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
function detail(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      responseId: ID,
      locationId: "loc-1",
      rating: 2,
      note: "Cold pizza",
      submittedAt: "2026-11-02T12:00:00Z",
      isRead: false,
      isResolved: false,
      tagLabel: "Front Desk",
      notes: [],
      ...overrides,
    },
    requestId: "r",
  };
}
const calls = () => fetchMock.mock.calls.map(([path, , init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${path}`);

beforeEach(() => fetchMock.mockReset());

describe("a rating's actions", () => {
  it("reads the Tag and the team's notes", async () => {
    fetchMock.mockResolvedValueOnce(
      detail({ notes: [{ noteId: "n1", body: "Called them", authorName: "Mark", createdAt: "2026-11-02T13:00:00Z" }] }),
    );
    const { result } = renderHook(() => useFeedbackDetail("org-a", ID));
    await act(() => result.current.load());
    expect(result.current.item?.tagLabel).toBe("Front Desk");
    expect(result.current.item?.notes).toEqual([
      { id: "n1", feedbackId: ID, body: "Called them", authorName: "Mark", createdAt: "2026-11-02T13:00:00Z" },
    ]);
  });

  it("marks it read", async () => {
    fetchMock.mockResolvedValueOnce(detail()).mockResolvedValueOnce({ data: { isRead: true } });
    const { result } = renderHook(() => useFeedbackDetail("org-a", ID));
    await act(() => result.current.load());
    await act(async () => {
      expect(await result.current.markRead()).toBe(true);
    });
    expect(calls()).toEqual([`GET /api/v1/customer-responses/${ID}`, `POST /api/v1/customer-responses/${ID}/read`]);
    expect(result.current.item?.isRead).toBe(true);
  });

  it("sorts it, and checks the server rather than guessing when the answer is lost", async () => {
    fetchMock
      .mockResolvedValueOnce(detail())
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(detail({ isResolved: true }));
    const { result } = renderHook(() => useFeedbackDetail("org-a", ID));
    await act(() => result.current.load());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.setResolved(true);
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.item?.isResolved).toBe(true);
    expect(calls().at(-1)).toBe(`GET /api/v1/customer-responses/${ID}`);
  });

  it("never sends a note twice: a lost answer is checked against the saved notes", async () => {
    fetchMock
      .mockResolvedValueOnce(detail())
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(detail());
    const { result } = renderHook(() => useFeedbackDetail("org-a", ID));
    await act(() => result.current.load());
    let outcome: { ok: boolean; message?: string } = { ok: true };
    await act(async () => {
      outcome = await result.current.addNote("  Refunded them  ");
    });
    // Not there after the check: the text stays, and nothing was re-sent.
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/Check the saved notes/);
    expect(calls().filter((call) => call.startsWith("POST")).length).toBe(1);
    expect(JSON.parse((fetchMock.mock.calls[1]![2] as RequestInit).body as string)).toEqual({ body: "Refunded them" });
  });

  it("counts a lost answer as saved when the note is there", async () => {
    fetchMock
      .mockResolvedValueOnce(detail())
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(
        detail({ notes: [{ noteId: "n1", body: "Refunded them", authorName: "Mark", createdAt: "2026-11-02T13:00:00Z" }] }),
      );
    const { result } = renderHook(() => useFeedbackDetail("org-a", ID));
    await act(() => result.current.load());
    let outcome: { ok: boolean } = { ok: false };
    await act(async () => {
      outcome = await result.current.addNote("Refunded them");
    });
    expect(outcome.ok).toBe(true);
  });

  it("says a refused write plainly, without a second try", async () => {
    fetchMock.mockResolvedValueOnce(detail()).mockRejectedValueOnce(new ApiError("Please try again shortly.", 503));
    const { result } = renderHook(() => useFeedbackDetail("org-a", ID));
    await act(() => result.current.load());
    let outcome: { ok: boolean; message?: string } = { ok: true };
    await act(async () => {
      outcome = await result.current.addNote("Spoke to the team");
    });
    expect(outcome).toEqual({ ok: false, message: "Could not save that. Your text is still here." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
