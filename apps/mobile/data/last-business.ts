import AsyncStorage from "@react-native-async-storage/async-storage";
import { lastOrgKey } from "./org-choice";

/**
 * The business last chosen on this phone: an id, nothing else. Losing it only
 * costs the picker one extra tap, so every failure is quiet.
 */
export async function readLastBusiness(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(lastOrgKey(userId));
  } catch {
    return null;
  }
}

export function rememberLastBusiness(userId: string, orgId: string): void {
  void AsyncStorage.setItem(lastOrgKey(userId), orgId).catch(() => undefined);
}

export function forgetLastBusiness(userId: string): void {
  void AsyncStorage.removeItem(lastOrgKey(userId)).catch(() => undefined);
}
