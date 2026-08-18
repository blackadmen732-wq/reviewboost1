import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

const SecureStoreAdapter = {
  getItem: (key: string): string | null => {
    if (Platform.OS === "web") return localStorage.getItem(key);
    return SecureStore.getItem(key);
  },
  setItem: (key: string, value: string): void => {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    SecureStore.setItem(key, value);
  },
  removeItem: (key: string): void => {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
