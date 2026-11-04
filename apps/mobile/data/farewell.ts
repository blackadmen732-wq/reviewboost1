/**
 * One line to say once, on the next screen, after something was deleted:
 * "Your business and sign-in were deleted." A deletion that ends on a bare
 * sign-in screen reads as a crash, or as nothing having happened.
 *
 * Kept in memory only: it is for the screen shown right after, in this run of
 * the app, and is gone once read.
 */
let pending: string | null = null;

export function sayAfterDeletion(message: string): void {
  pending = message;
}

/** The line, once. A second call returns null. */
export function takeDeletionNotice(): string | null {
  const message = pending;
  pending = null;
  return message;
}

export const DELETED_BUSINESS_AND_SIGN_IN = "Your business and sign-in were deleted.";
export const DELETED_SIGN_IN = "Your sign-in was deleted.";
export const DELETED_BUSINESS = "Your business was deleted.";
