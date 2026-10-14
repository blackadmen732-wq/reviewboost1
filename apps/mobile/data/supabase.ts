import "react-native-get-random-values";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Where the signed-in session lives on the phone: the iOS Keychain (Android
 * Keystore) and nowhere else.
 *
 * WHY NOT THE OLD WAY
 * -------------------
 * The session used to be encrypted in JavaScript with `aes-js` and written to
 * AsyncStorage, with only the key in SecureStore. That put an AES
 * implementation of our own in the binary, which is "an industry standard
 * algorithm, not provided within the Apple operating system" for export
 * compliance and needs a French encryption declaration. Keeping the session in
 * the Keychain uses the operating system's encryption only, and keeps the
 * token out of app files entirely.
 *
 * CHUNKS
 * ------
 * SecureStore warns above 2048 bytes per value and a session can be larger, so
 * the value is split. Each chunk is at most CHUNK_UNITS UTF-16 units — at most
 * 3 UTF-8 bytes each — and never splits a surrogate pair. Chunks are written
 * under a fresh generation and the manifest is written last, so an interrupted
 * write leaves the previous session readable or none at all, never half of one.
 *
 * REINSTALL
 * ---------
 * Keychain items outlive the app; app storage does not. A marker in app
 * storage tells a fresh install from a relaunch, and a fresh install starts
 * signed out, as someone who deleted the app would expect.
 */
const CHUNK_UNITS = 600;
const INSTALL_MARKER = "rb.install.v1";

interface Manifest {
  generation: string;
  chunks: number;
}

export function splitForKeychain(value: string, size = CHUNK_UNITS): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + size, value.length);
    // Never end a chunk on the first half of a surrogate pair.
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks.length > 0 ? chunks : [""];
}

function chunkKey(key: string, generation: string, index: number): string {
  return `${key}.${generation}.${index}`;
}

function newGeneration(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class KeychainSessionStore {
  private installChecked: Promise<void> | null = null;

  private async readManifest(key: string): Promise<Manifest | null> {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<Manifest>;
      if (typeof parsed.generation !== "string" || typeof parsed.chunks !== "number") return null;
      return { generation: parsed.generation, chunks: parsed.chunks };
    } catch {
      return null;
    }
  }

  private async deleteGeneration(key: string, manifest: Manifest): Promise<void> {
    for (let i = 0; i < manifest.chunks; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, manifest.generation, i));
    }
  }

  private async clear(key: string): Promise<void> {
    const manifest = await this.readManifest(key);
    if (manifest) await this.deleteGeneration(key, manifest);
    await SecureStore.deleteItemAsync(key);
    // The ciphertext the previous storage left in AsyncStorage, if any.
    await AsyncStorage.removeItem(key);
  }

  /** A fresh install forgets any session the Keychain kept from before. */
  private ensureInstallChecked(key: string): Promise<void> {
    if (!this.installChecked) {
      this.installChecked = (async () => {
        const marker = await AsyncStorage.getItem(INSTALL_MARKER);
        if (marker) return;
        await this.clear(key);
        await AsyncStorage.setItem(INSTALL_MARKER, "1");
      })();
    }
    return this.installChecked;
  }

  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") return localStorage.getItem(key);
    await this.ensureInstallChecked(key);
    const manifest = await this.readManifest(key);
    if (!manifest) return null;
    const parts: string[] = [];
    for (let i = 0; i < manifest.chunks; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, manifest.generation, i));
      // A missing chunk means an unfinished or damaged write: no session,
      // rather than a corrupt one.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join("");
  }

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    await this.ensureInstallChecked(key);
    const previous = await this.readManifest(key);
    const generation = newGeneration();
    const chunks = splitForKeychain(value);
    for (let i = 0; i < chunks.length; i += 1) {
      await SecureStore.setItemAsync(chunkKey(key, generation, i), chunks[i]!);
    }
    await SecureStore.setItemAsync(key, JSON.stringify({ generation, chunks: chunks.length }));
    if (previous) await this.deleteGeneration(key, previous);
  }

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    await this.clear(key);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: new KeychainSessionStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
