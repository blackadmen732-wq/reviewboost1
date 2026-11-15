import "server-only";

import { createHash } from "node:crypto";
import { JWT } from "google-auth-library";
import { z } from "zod";

export interface DeliveryJob {
  id: string;
  leaseToken: string;
  orgId: string;
  memberId: string;
  provider: "google_wallet" | "webhook";
  target: string;
  title: string;
  body: string;
}
export type DeliveryResult =
  | { state: "accepted"; reference: string }
  | { state: "rejected" | "unknown"; code: string };
export interface DeliveryProvider {
  name: DeliveryJob["provider"];
  send(job: DeliveryJob): Promise<DeliveryResult>;
}

const credentialSchema = z.object({
  client_email: z.email(),
  private_key: z.string().min(100),
});
function credentials() {
  try {
    return credentialSchema.parse(
      JSON.parse(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON ?? ""),
    );
  } catch {
    return null;
  }
}
export function googleObjectId(orgId: string, memberId: string): string {
  const issuer = process.env.GOOGLE_WALLET_ISSUER_ID ?? "";
  if (!/^[0-9]{8,30}$/.test(issuer))
    throw new Error("Google Wallet is not connected.");
  return `${issuer}.rb_${createHash("sha256").update(`${orgId}:${memberId}`).digest("hex").slice(0, 40)}`;
}

export class GoogleWalletProvider implements DeliveryProvider {
  readonly name = "google_wallet" as const;
  private client: JWT;
  constructor() {
    const c = credentials();
    if (!c) throw new Error("Google Wallet is not connected.");
    this.client = new JWT({
      email: c.client_email,
      key: c.private_key,
      scopes: ["https://www.googleapis.com/auth/wallet_object.issuer"],
      transporterOptions: { timeout: 5000, retry: false },
    });
  }
  async passIsSaved(orgId: string, memberId: string): Promise<boolean> {
    const objectId = googleObjectId(orgId, memberId);
    const { token } = await this.client.getAccessToken();
    if (!token) throw new Error("Google authorization failed.");
    const response = await fetch(
      `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
        cache: "no-store",
      },
    );
    if (response.status === 404) return false;
    if (!response.ok)
      throw new Error("Google Wallet could not verify this pass.");
    const pass = z
      .object({ id: z.string(), hasUsers: z.boolean().optional() })
      .parse(await response.json());
    return pass.id === objectId && pass.hasUsers === true;
  }
  async send(job: DeliveryJob): Promise<DeliveryResult> {
    // The destination is derived from the tenant/member, never a client URL.
    if (job.target !== googleObjectId(job.orgId, job.memberId))
      return { state: "rejected", code: "destination_mismatch" };
    try {
      if (!(await this.passIsSaved(job.orgId, job.memberId)))
        return { state: "rejected", code: "wallet_not_saved" };
    } catch {
      return { state: "rejected", code: "wallet_check_failed" };
    }
    let token: string | null | undefined;
    try {
      token = (await this.client.getAccessToken()).token;
    } catch {
      return { state: "rejected", code: "provider_authorization_failed" };
    }
    if (!token)
      return { state: "rejected", code: "provider_authorization_failed" };
    try {
      // fetch does not retry. Google permits duplicate message IDs, so a
      // timeout or ambiguous response is UNKNOWN and never automatically resent.
      const response = await fetch(
        `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(job.target)}/addMessage`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              id: job.id,
              header: job.title,
              body: job.body,
              messageType: "TEXT_AND_NOTIFY",
            },
          }),
          signal: AbortSignal.timeout(5000),
          redirect: "error",
          cache: "no-store",
        },
      );
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408
      )
        return { state: "rejected", code: `google_${response.status}` };
      if (!response.ok)
        return { state: "unknown", code: `google_${response.status}` };
      const receipt = z
        .object({ resource: z.object({ id: z.string() }) })
        .safeParse(await response.json());
      if (!receipt.success || receipt.data.resource.id !== job.target)
        return { state: "unknown", code: "google_invalid_receipt" };
      return { state: "accepted", reference: job.id };
    } catch {
      return { state: "unknown", code: "provider_response_unknown" };
    }
  }
}

class WebhookProvider implements DeliveryProvider {
  readonly name = "webhook" as const;
  constructor(
    private endpoint: string,
    private secret: string,
  ) {}
  async send(job: DeliveryJob): Promise<DeliveryResult> {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${this.secret}`,
          "Content-Type": "application/json",
          "Idempotency-Key": job.id,
        },
        body: JSON.stringify({
          id: job.id,
          memberId: job.memberId,
          target: job.target,
          title: job.title,
          body: job.body,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408
      )
        return { state: "rejected", code: `gateway_${response.status}` };
      if (!response.ok)
        return { state: "unknown", code: `gateway_${response.status}` };
      const payload = z
        .object({
          accepted: z.boolean(),
          reference: z.string().min(1).max(256).optional(),
        })
        .safeParse(await response.json());
      if (
        !payload.success ||
        (payload.data.accepted && !payload.data.reference)
      )
        return { state: "unknown", code: "gateway_invalid_receipt" };
      return payload.data.accepted
        ? { state: "accepted", reference: payload.data.reference! }
        : { state: "rejected", code: "gateway_rejected" };
    } catch {
      return { state: "unknown", code: "provider_response_unknown" };
    }
  }
}

export function deliveryProviders(): DeliveryProvider[] {
  const providers: DeliveryProvider[] = [];
  if (
    credentials() &&
    /^[0-9]{8,30}$/.test(process.env.GOOGLE_WALLET_ISSUER_ID ?? "")
  )
    providers.push(new GoogleWalletProvider());
  const endpoint = process.env.ENGAGEMENT_DELIVERY_WEBHOOK_URL;
  const secret = process.env.ENGAGEMENT_DELIVERY_WEBHOOK_SECRET;
  if (endpoint && secret && secret.length >= 32) {
    try {
      const url = new URL(endpoint);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.hash
      )
        providers.push(new WebhookProvider(url.href, secret));
    } catch {
      /* Missing or invalid configuration never enables a sender. */
    }
  }
  return providers;
}
