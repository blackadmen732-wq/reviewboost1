import { describe, it, expect, beforeEach, vi } from "vitest";

const keychain = new Map<string, string>();
const appStorage = new Map<string, string>();

vi.mock("react-native-get-random-values", () => ({}));

vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn(async (k: string, v: string) => {
    keychain.set(k, v);
  }),
  getItemAsync: vi.fn(async (k: string) => keychain.get(k) ?? null),
  deleteItemAsync: vi.fn(async (k: string) => {
    keychain.delete(k);
  }),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    setItem: vi.fn(async (k: string, v: string) => {
      appStorage.set(k, v);
    }),
    getItem: vi.fn(async (k: string) => appStorage.get(k) ?? null),
    removeItem: vi.fn(async (k: string) => {
      appStorage.delete(k);
    }),
  },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({})) }));

const KEY = "sb-test-auth-token";
const INSTALLED = () => appStorage.set("rb.install.v1", "1");
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
// A lone surrogate does not survive a UTF-8 round trip; a whole character does.
const survivesUtf8 = (value: string) => new TextDecoder().decode(new TextEncoder().encode(value)) === value;

function session(extra = ""): string {
  return JSON.stringify({
    access_token: "a".repeat(1200),
    refresh_token: "r".repeat(600),
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "owner@example.com",
      // Accents, CJK and an emoji: multi-byte UTF-8 and a surrogate pair.
      user_metadata: { name: `Café 東京 🍕 ${"x".repeat(300)}${extra}` },
    },
  });
}

async function freshStore() {
  vi.resetModules();
  const { KeychainSessionStore } = await import("../supabase");
  return new KeychainSessionStore();
}

describe("KeychainSessionStore", () => {
  beforeEach(() => {
    keychain.clear();
    appStorage.clear();
  });

  it("round-trips a session larger than 2048 bytes, all of it in the Keychain", async () => {
    INSTALLED();
    const store = await freshStore();
    const value = session();
    expect(utf8Bytes(value)).toBeGreaterThan(2048);

    await store.setItem(KEY, value);
    expect(await store.getItem(KEY)).toBe(value);

    // Every Keychain value fits SecureStore's 2048-byte guidance.
    for (const stored of keychain.values()) {
      expect(utf8Bytes(stored)).toBeLessThanOrEqual(2048);
    }
    // Nothing about the session is written to app storage — only the marker.
    expect([...appStorage.keys()]).toEqual(["rb.install.v1"]);
  });

  it("never splits a surrogate pair across chunks", async () => {
    const { splitForKeychain } = await import("../supabase");
    const value = `${"a".repeat(599)}🍕${"b".repeat(10)}`;
    const chunks = splitForKeychain(value, 600);
    expect(chunks.join("")).toBe(value);
    for (const chunk of chunks) {
      expect(survivesUtf8(chunk)).toBe(true);
    }
  });

  it("replacing a session removes the previous one's chunks", async () => {
    INSTALLED();
    const store = await freshStore();
    await store.setItem(KEY, session("x".repeat(2000)));
    await store.setItem(KEY, "short");
    expect(await store.getItem(KEY)).toBe("short");
    // Manifest plus one chunk.
    expect(keychain.size).toBe(2);
  });

  it("returns no session, rather than a corrupt one, when a chunk is missing", async () => {
    INSTALLED();
    const store = await freshStore();
    await store.setItem(KEY, session());
    const aChunk = [...keychain.keys()].find((k) => k !== KEY)!;
    keychain.delete(aChunk);
    expect(await store.getItem(KEY)).toBeNull();
  });

  it("starts signed out after a reinstall, even though the Keychain kept the session", async () => {
    // Previous install: session in the Keychain, legacy ciphertext in app storage.
    INSTALLED();
    const before = await freshStore();
    await before.setItem(KEY, session());
    appStorage.set(KEY, "legacy-ciphertext");

    // Deleting the app wipes app storage (and the marker) but not the Keychain.
    appStorage.clear();
    const after = await freshStore();

    expect(await after.getItem(KEY)).toBeNull();
    expect(keychain.size).toBe(0);
    expect(appStorage.get("rb.install.v1")).toBe("1");
  });

  it("keeps the session across an ordinary relaunch", async () => {
    INSTALLED();
    const first = await freshStore();
    await first.setItem(KEY, session());
    const relaunched = await freshStore();
    expect(await relaunched.getItem(KEY)).toBe(session());
  });

  it("sign-out removes every chunk and the manifest", async () => {
    INSTALLED();
    const store = await freshStore();
    await store.setItem(KEY, session());
    await store.removeItem(KEY);
    expect(keychain.size).toBe(0);
    expect(await store.getItem(KEY)).toBeNull();
  });
});
