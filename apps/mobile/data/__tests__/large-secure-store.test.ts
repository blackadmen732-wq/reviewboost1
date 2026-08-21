import { describe, it, expect, beforeEach, vi } from "vitest";

const secureStoreData = new Map<string, string>();
const asyncStorageData = new Map<string, string>();

vi.mock("react-native-get-random-values", () => ({}));

vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn(async (k: string, v: string) => {
    secureStoreData.set(k, v);
  }),
  getItemAsync: vi.fn(async (k: string) => secureStoreData.get(k) ?? null),
  deleteItemAsync: vi.fn(async (k: string) => {
    secureStoreData.delete(k);
  }),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    setItem: vi.fn(async (k: string, v: string) => {
      asyncStorageData.set(k, v);
    }),
    getItem: vi.fn(async (k: string) => asyncStorageData.get(k) ?? null),
    removeItem: vi.fn(async (k: string) => {
      asyncStorageData.delete(k);
    }),
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

describe("LargeSecureStore", () => {
  beforeEach(() => {
    secureStoreData.clear();
    asyncStorageData.clear();
  });

  it("round-trips a session larger than 2048 bytes", async () => {
    const { LargeSecureStore } = await import("../supabase");
    const store = new LargeSecureStore();

    const largeSession = JSON.stringify({
      access_token: "a".repeat(1200),
      refresh_token: "r".repeat(600),
      user: {
        id: "00000000-0000-0000-0000-000000000001",
        email: "test@example.com",
        app_metadata: { provider: "email" },
        user_metadata: { name: "x".repeat(300) },
      },
    });

    expect(largeSession.length).toBeGreaterThan(2048);

    const key = "sb-test-auth-token";
    await store.setItem(key, largeSession);

    expect(secureStoreData.has(key)).toBe(true);
    expect(asyncStorageData.has(key)).toBe(true);

    const encryptionKeyHex = secureStoreData.get(key)!;
    expect(encryptionKeyHex.length).toBe(64);

    const restored = await store.getItem(key);
    expect(restored).toBe(largeSession);

    await store.removeItem(key);
    expect(secureStoreData.has(key)).toBe(false);
    expect(asyncStorageData.has(key)).toBe(false);

    const afterRemove = await store.getItem(key);
    expect(afterRemove).toBeNull();
  });
});
