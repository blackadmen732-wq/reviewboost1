export type TagReadiness = "ready" | "needs-qr" | "needs-nfc" | "both";

export interface TagReadinessInput {
  nfcProvisionedAt: string | null;
  tokenRotatedAt: string | null;
}

export function tagNeedsRewrite(input: TagReadinessInput): boolean {
  if (input.nfcProvisionedAt === null || input.tokenRotatedAt === null) return false;
  return new Date(input.tokenRotatedAt) > new Date(input.nfcProvisionedAt);
}

export function tagReadiness(input: TagReadinessInput): TagReadiness {
  const needsNfc = input.nfcProvisionedAt === null || tagNeedsRewrite(input);
  const needsQr = tagNeedsRewrite(input);

  if (needsNfc && needsQr) return "both";
  if (needsNfc) return "needs-nfc";
  if (needsQr) return "needs-qr";
  return "ready";
}

export function tagReadinessLabel(status: TagReadiness): string {
  if (status === "ready") return "Ready";
  if (status === "needs-qr") return "Needs QR";
  if (status === "needs-nfc") return "Needs NFC";
  return "Both";
}

export function lastUsedLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "Not used yet";
  const then = new Date(iso);
  const days = Math.floor((now - then.getTime()) / 86_400_000);
  if (days <= 0) return "Used today";
  if (days === 1) return "Used yesterday";
  if (days < 7) return `Used ${days} days ago`;
  return `Used ${then.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
