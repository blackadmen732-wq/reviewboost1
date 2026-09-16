import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

const getSession = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession } }),
}));

import { ProgramTagSheet } from "@/features/tags/program-tag-sheet";

const STAND_URL = "https://reviewboost.fit/q/abc123";

/** A stand-in for the browser's NDEFReader, recording what was written. */
class FakeNDEFReader {
  static writes: Array<{ records: Array<{ recordType: string; data: string }> }> = [];
  static onScan: ((emit: (records: unknown[]) => void, fail: () => void) => void) | null = null;
  static writeError: Error | null = null;

  private listeners = new Map<string, (event: unknown) => void>();

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.listeners.set(type, handler);
  }

  async scan() {
    FakeNDEFReader.onScan?.(
      (records) => this.listeners.get("reading")?.({ message: { records } }),
      () => this.listeners.get("readingerror")?.({}),
    );
  }

  async write(message: { records: Array<{ recordType: string; data: string }> }) {
    if (FakeNDEFReader.writeError) throw FakeNDEFReader.writeError;
    FakeNDEFReader.writes.push(message);
  }
}

/** An NDEF record as the browser hands it over: bytes plus an encoding. */
function record(recordType: string, text: string) {
  return { recordType, data: new TextEncoder().encode(text), encoding: "utf-8" };
}

/**
 * Programming a Tag is irreversible, and telling the owner it worked is a
 * promise. Two failures this covers:
 *
 * The sheet wrote without reading, so a hotel key or another business's Tag was
 * replaced silently. And it discarded the provisioning response, so a chip
 * written while the network was down still reported "Tag ready" while the Tag
 * list went on saying it needed NFC.
 */
describe("Program Tag sheet", () => {
  beforeEach(() => {
    FakeNDEFReader.writes = [];
    FakeNDEFReader.onScan = null;
    FakeNDEFReader.writeError = null;
    getSession.mockResolvedValue({ data: { session: { access_token: "token" } } });
    vi.stubGlobal("NDEFReader", FakeNDEFReader);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  /** url lookup → ok; provisioning POST → caller's choice. */
  function mockFetch({ provisionOk = true }: { provisionOk?: boolean } = {}) {
    const calls: string[] = [];
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/qr")) {
        return new Response(JSON.stringify({ data: { standUrl: STAND_URL } }), { status: 200 });
      }
      return new Response("{}", { status: provisionOk ? 200 : 503 });
    });
    vi.stubGlobal("fetch", mock);
    return calls;
  }

  /** The sheet's own state, rather than copy that appears in title and body. */
  function phase(): string | null {
    return document.querySelector("[data-nfc-phase]")?.getAttribute("data-nfc-phase") ?? null;
  }

  async function hold() {
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
  }

  /** The owner-visible scene, as opposed to the machine phase underneath. */
  function scene(): string | null {
    return document.querySelector("[data-nfc-scene]")?.getAttribute("data-nfc-scene") ?? null;
  }

  function renderSheet(onReady = vi.fn()) {
    render(
      <ProgramTagSheet standId="stand-1" open onClose={vi.fn()} onReady={onReady} />,
    );
    return onReady;
  }

  it("writes a blank Tag without stopping to ask", async () => {
    mockFetch();
    FakeNDEFReader.onScan = (emit) => act(() => emit([]));

    const onReady = renderSheet();
    await hold();

    await waitFor(() => expect(phase()).toBe("ready"));
    expect(FakeNDEFReader.writes).toHaveLength(1);
    expect(FakeNDEFReader.writes[0]?.records[0]?.data).toBe(STAND_URL);
    expect(onReady).toHaveBeenCalled();
  });

  it("never writes over somebody else's Tag without being told to", async () => {
    mockFetch();
    FakeNDEFReader.onScan = (emit) =>
      act(() => emit([record("url", "https://hotel.example/room-402")]));

    renderSheet();
    await hold();

    await waitFor(() => expect(phase()).toBe("conflict"));
    // The decisive assertion: nothing was written.
    expect(FakeNDEFReader.writes).toHaveLength(0);
    expect(screen.getByText(/hotel\.example/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeVisible();
  });

  it("writes over it only once the owner says so", async () => {
    mockFetch();
    FakeNDEFReader.onScan = (emit) =>
      act(() => emit([record("url", "https://hotel.example/room-402")]));

    renderSheet();
    await hold();
    await waitFor(() => expect(phase()).toBe("conflict"));

    fireEvent.click(screen.getByRole("button", { name: /^replace$/i }));

    await waitFor(() => expect(FakeNDEFReader.writes).toHaveLength(1));
    expect(FakeNDEFReader.writes[0]?.records[0]?.data).toBe(STAND_URL);
  });

  it("does not rewrite a Tag that already points here", async () => {
    const calls = mockFetch();
    FakeNDEFReader.onScan = (emit) => act(() => emit([record("url", STAND_URL)]));

    const onReady = renderSheet();
    await hold();

    await waitFor(() => expect(phase()).toBe("ready"));
    // No write cycle spent on a chip that was already correct…
    expect(FakeNDEFReader.writes).toHaveLength(0);
    // …but the server is still told, since that record was what was missing.
    expect(calls.some((call) => call.includes("nfc-provision"))).toBe(true);
    expect(onReady).toHaveBeenCalled();
  });

  it("refuses to write a Tag it could not read", async () => {
    mockFetch();
    FakeNDEFReader.onScan = (_emit, fail) => act(() => fail());

    renderSheet();
    await hold();

    await waitFor(() => expect(phase()).toBe("failed"));
    expect(FakeNDEFReader.writes).toHaveLength(0);
    expect(screen.getByText(/nothing was written/i)).toBeVisible();
    expect(scene()).toBe("unreadable");
  });

  it("tells the truth when the chip was written but the server was not told", async () => {
    mockFetch({ provisionOk: false });
    FakeNDEFReader.onScan = (emit) => act(() => emit([]));

    const onReady = renderSheet();
    await hold();

    await waitFor(() => expect(phase()).toBe("unconfirmed"));
    expect(screen.getByText(/couldn’t finish saving/i)).toBeVisible();
    // The chip really was written, so this is not a failure state…
    expect(FakeNDEFReader.writes).toHaveLength(1);
    expect(phase()).not.toBe("ready");
    // …and readiness must not be announced on an unrecorded Tag.
    expect(onReady).not.toHaveBeenCalled();
  });

  it("retries the confirmation without touching the Tag again", async () => {
    let provisionOk = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/qr")) {
          return new Response(JSON.stringify({ data: { standUrl: STAND_URL } }), { status: 200 });
        }
        return new Response("{}", { status: provisionOk ? 200 : 503 });
      }),
    );
    FakeNDEFReader.onScan = (emit) => act(() => emit([]));

    const onReady = renderSheet();
    await hold();
    await waitFor(() => expect(phase()).toBe("unconfirmed"));
    expect(FakeNDEFReader.writes).toHaveLength(1);

    provisionOk = true;
    fireEvent.click(screen.getByRole("button", { name: /finish setup/i }));

    await waitFor(() => expect(phase()).toBe("ready"));
    // The whole point of a separate retry: still exactly one write.
    expect(FakeNDEFReader.writes).toHaveLength(1);
    expect(onReady).toHaveBeenCalled();
  });

  it("does not claim readiness when the write itself fails", async () => {
    mockFetch();
    FakeNDEFReader.onScan = (emit) => act(() => emit([]));
    FakeNDEFReader.writeError = new Error("write failed");

    const onReady = renderSheet();
    await hold();

    await waitFor(() => expect(phase()).toBe("failed"));
    expect(onReady).not.toHaveBeenCalled();
  });
});
