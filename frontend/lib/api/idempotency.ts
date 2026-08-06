export type CustomerMutation = "session" | "response" | "google-click" | "team-praise";

export function createIdempotencyKey(operation: CustomerMutation): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.randomUUID) {
    throw new Error("A secure UUID generator is required for customer submissions.");
  }
  return `rb_${operation}_${cryptoApi.randomUUID()}`;
}

