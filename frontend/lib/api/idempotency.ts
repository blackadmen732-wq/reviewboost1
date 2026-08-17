export type CustomerMutation =
  "session" | "response" | "google-click" | "team-praise";

export function createIdempotencyKey(operation: CustomerMutation): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) {
    throw new Error(
      "A secure UUID generator is required for customer submissions.",
    );
  }
  if (cryptoApi.randomUUID) return `rb_${operation}_${cryptoApi.randomUUID()}`;
  if (!cryptoApi.getRandomValues)
    throw new Error(
      "A secure UUID generator is required for customer submissions.",
    );
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  const uuid = `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  return `rb_${operation}_${uuid}`;
}
