import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/toast", () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

const getSession = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession } }),
}));

import { ProgramTagSheet } from "@/features/tags/program-tag-sheet";

// A real token is 43 URL-safe characters; the public API accepts 8 to 128.
const STAND_URL = "https://reviewboost.fit/q/abc123DEF456ghi";

/** A stand-in for the browser's NDEFReader, recording what was written. */
class FakeNDEFReader {
  static writes: Array<{
    records: Array<{ recordType: string; data: string }>;
  }> = [];
  static onScan:
    ((emit: (records: unknown[]) => void, fail: () => void) => void) | null =
    null;
  static writeError: Error | null = null;
  static scanError: Error | null = null;
  static scans = 0;
  static writeGate: Promise<void> | null = null;

  private listeners = new Map<string, (event: unknown) => void>();

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.listeners.set(type, handler);
  }

  async scan() {
    FakeNDEFReader.scans += 1;
    if (FakeNDEFReader.scanError) throw FakeNDEFReader.scanError;
    FakeNDEFReader.onScan?.(
      (records) => this.listeners.get("reading")?.({ message: { records } }),
      () => this.listeners.get("readingerror")?.({}),
    );
  }

  async write(message: {
    records: Array<{ recordType: string; data: string }>;
  }) {
    if (FakeNDEFReader.writeGate) await FakeNDEFReader.writeGate;
    if (FakeNDEFReader.writeError) throw FakeNDEFReader.writeError;
    FakeNDEFReader.writes.push(message);
  }
}

/** An NDEF record as the browser hands it over: bytes plus an encoding. */
function record(recordType: string, text: string) {
  return {
    recordType,
    data: new TextEncoder().encode(text),
    encoding: "utf-8",
  };
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
    FakeNDEFReader.scanError = null;
    FakeNDEFReader.scans = 0;
    FakeNDEFReader.writeGate = null;
    getSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });
    vi.stubGlobal("NDEFReader", FakeNDEFReader);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  /** url lookup → ok; provisioning POST → caller's choice. */
  function mockFetch({
    provisionOk = true,
    standUrl = STAND_URL,
  }: { provisionOk?: boolean; standUrl?: string } = {}) {
    const calls: string[] = [];
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/qr")) {
        return new Response(JSON.stringify({ data: { standUrl } }), {
          status: 200,
        });
      }
      return new Response("{}", { status: provisionOk ? 200 : 503 });
    });
    vi.stubGlobal("fetch", mock);
    return calls;
  }

  /** The sheet's own state, rather than copy that appears in title and body. */
  function phase(): string | null {
    return (
      document
        .querySelector("[data-nfc-phase]")
        ?.getAttribute("data-nfc-phase") ?? null
    );
  }

  async function hold() {
    fireEvent.click(screen.getByRole("button", { name: /^program nfc$/i }));
  }

  /** The owner-visible scene, as opposed to the machine phase underneath. */
  function scene(): string | null {
    return (
      document
        .querySelector("[data-nfc-scene]")
        ?.getAttribute("data-nfc-scene") ?? null
    );
  }

  function renderSheet(onReady = vi.fn(), onClose = vi.fn()) {
    render(
      <ProgramTagSheet
        standId="stand-1"
        open
        onClose={onClose}
        onReady={onReady}
      />,
    );
    return onReady;
  }

  function title(): string | null {
    const titleId = screen.getByRole("dialog").getAttribute("aria-labelledby");
    return document.getElementById(titleId ?? "")?.textContent ?? null;
  }

  it("never programs a chip with anything but a ReviewBoost /q/ link — not even one the server sent", async () => {
    for (const standUrl of [
      "https://search.google.com/local/writereview?placeid=ChIJRouteMain0001",
      "https://g.page/r/RouteMain/review",
      `${STAND_URL}?next=https://g.page/r/RouteMain/review`,
    ]) {
      const calls = mockFetch({ standUrl });
      FakeNDEFReader.onScan = (emit) => act(() => emit([]));
      const { unmount } = render(
        <ProgramTagSheet
          standId="stand-1"
          open
          onClose={vi.fn()}
          onReady={vi.fn()}
        />,
      );
      await hold();
      await waitFor(() => expect(phase()).toBe("failed"));
      expect(FakeNDEFReader.writes, standUrl).toHaveLength(0);
      expect(
        calls.filter((call) => call.startsWith("POST")),
        standUrl,
      ).toHaveLength(0);
      unmount();
    }
  });

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
    FakeNDEFReader.onScan = (emit) =>
      act(() => emit([record("url", STAND_URL)]));

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
    expect(screen.getByText(/nothing on the tag was changed/i)).toBeVisible();
    expect(scene()).toBe("error");
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
          return new Response(
            JSON.stringify({ data: { standUrl: STAND_URL } }),
            { status: 200 },
          );
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

  it("does not start scanning until the owner asks", async () => {
    mockFetch();
    renderSheet();

    expect(scene()).toBe("ready");
    expect(title()).toBe("Program your Tag");
    expect(FakeNDEFReader.scans).toBe(0);
  });

  it("stays on one working screen, and only changes its words once the Tag is found", async () => {
    mockFetch();
    let emit: ((records: unknown[]) => void) | null = null;
    FakeNDEFReader.onScan = (e) => {
      emit = e;
    };
    let release: () => void = () => undefined;
    FakeNDEFReader.writeGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    renderSheet();
    await hold();

    await waitFor(() => expect(scene()).toBe("writing"));
    expect(title()).toBe("Hold near your Tag");
    // Android's reader is on the back; nothing may claim a distance.
    expect(screen.getByText(/back of your phone/i)).toBeVisible();
    expect(screen.queryByText(/%|\bcm\b/)).toBeNull();

    act(() => emit?.([]));
    await waitFor(() => expect(title()).toBe("Writing Tag…"));
    // Reading, writing and checking are one scene, not three.
    expect(scene()).toBe("writing");

    act(() => release());
    await waitFor(() => expect(scene()).toBe("success"));
    expect(title()).toBe("Tag ready");
    // It closes itself: nothing to press.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("writes nothing once the owner cancels, even if the Tag arrives afterwards", async () => {
    mockFetch();
    let emit: ((records: unknown[]) => void) | null = null;
    FakeNDEFReader.onScan = (e) => {
      emit = e;
    };
    const onClose = vi.fn();
    const onReady = renderSheet(vi.fn(), onClose);
    await hold();
    await waitFor(() => expect(scene()).toBe("writing"));

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();

    // The chip comes into range after the owner has walked away.
    await act(async () => emit?.([]));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(FakeNDEFReader.writes).toHaveLength(0);
    expect(onReady).not.toHaveBeenCalled();
  });

  it("says when NFC is not allowed, and that nothing changed", async () => {
    mockFetch();
    FakeNDEFReader.scanError = new DOMException("denied", "NotAllowedError");

    renderSheet();
    await hold();

    await waitFor(() => expect(scene()).toBe("error"));
    expect(title()).toBe("NFC isn’t allowed");
    expect(screen.getByText(/nothing on the tag was changed/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /^try again$/i })).toBeVisible();
    expect(FakeNDEFReader.writes).toHaveLength(0);
  });

  it("says when the phone's NFC is switched off", async () => {
    mockFetch();
    FakeNDEFReader.scanError = new DOMException("off", "NotReadableError");

    renderSheet();
    await hold();

    await waitFor(() => expect(title()).toBe("NFC is turned off"));
  });

  it("says when it could not reach ReviewBoost, before touching the Tag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );

    renderSheet();
    await hold();

    await waitFor(() => expect(title()).toBe("Couldn’t reach ReviewBoost"));
    expect(screen.getByText(/nothing on the tag was changed/i)).toBeVisible();
    expect(FakeNDEFReader.scans).toBe(0);
  });

  it("does not offer a retry on a phone that cannot program Tags", async () => {
    mockFetch();
    vi.stubGlobal("NDEFReader", undefined);
    // `"NDEFReader" in window` must be false, not merely undefined.
    delete (window as unknown as Record<string, unknown>).NDEFReader;

    renderSheet();
    await hold();

    await waitFor(() => expect(title()).toBe("This phone can’t program Tags"));
    expect(screen.getByText(/QR code on the Tag still works/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeVisible();
  });

  it("does not claim nothing changed when the write itself failed part-way", async () => {
    mockFetch();
    FakeNDEFReader.onScan = (emit) => act(() => emit([]));
    FakeNDEFReader.writeError = new DOMException("lost", "NetworkError");

    renderSheet();
    await hold();

    await waitFor(() => expect(scene()).toBe("error"));
    expect(title()).toBe("Couldn’t program this Tag");
    expect(screen.queryByText(/nothing on the tag was changed/i)).toBeNull();
  });

  it("gives up on a Tag that never answers, and says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockFetch();
      FakeNDEFReader.onScan = () => undefined;

      renderSheet();
      await hold();
      await waitFor(() => expect(scene()).toBe("writing"));

      await act(async () => {
        vi.advanceTimersByTime(4_100);
      });

      await waitFor(() => expect(title()).toBe("No Tag found"));
      expect(FakeNDEFReader.writes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
