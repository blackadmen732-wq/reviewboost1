/**
 * What each role may do, as the API and database enforce it.
 *
 * This file decides only what the interface *offers*. The authority stays
 * where it was: `requireRole` in each route handler and the role checks inside
 * the SECURITY DEFINER RPCs. The point of mirroring them here is that a screen
 * never shows an enabled button whose request is going to come back 403.
 *
 * Every entry names the check it mirrors, and `permissions.test.ts` reads those
 * route files so the two cannot drift silently.
 */

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface Permissions {
  /** Checkout and the Stripe portal. `api/v1/billing` POST: owner. */
  manageBilling: boolean;
  /**
   * Create a Tag, load or download its code, program NFC, make a new code.
   * `api/v1/review-stands` POST, `[standId]/qr`, `nfc-provision`,
   * `rotate-token`: owner, admin.
   */
  manageTags: boolean;
  /** Send, preview and cancel. `api/v1/text-requests` POST: owner, admin. */
  sendTextRequests: boolean;
  /**
   * Business name, Google link, locations. `api/v1/settings` PATCH and
   * `api/v1/locations` POST: owner, admin.
   */
  editSettings: boolean;
  /** Draft, upload, publish. `api/v1/customer-page`: owner, admin. */
  editCustomerPage: boolean;
  /** Delete the business. `api/v1/account/deletion`: owner. */
  deleteBusiness: boolean;
}

const NONE: Permissions = {
  manageBilling: false,
  manageTags: false,
  sendTextRequests: false,
  editSettings: false,
  editCustomerPage: false,
  deleteBusiness: false,
};

/**
 * An unknown role gets nothing. A role string the frontend does not recognise
 * is a backend it has not been updated for, and guessing up is the wrong way
 * to be wrong.
 */
export function permissionsFor(role: string | null | undefined): Permissions {
  switch (role) {
    case "owner":
      return {
        manageBilling: true,
        manageTags: true,
        sendTextRequests: true,
        editSettings: true,
        editCustomerPage: true,
        deleteBusiness: true,
      };
    case "admin":
      return {
        ...NONE,
        manageTags: true,
        sendTextRequests: true,
        editSettings: true,
        editCustomerPage: true,
      };
    default:
      return NONE;
  }
}

/** One sentence for a control a role cannot use. Names who can. */
export function ownerOnly(action: string): string {
  return `Only the owner can ${action}.`;
}

export function ownerOrAdmin(action: string): string {
  return `Only an owner or admin can ${action}.`;
}
