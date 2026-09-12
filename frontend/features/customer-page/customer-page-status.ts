/**
 * What the page is doing, from the customer's point of view.
 *
 * `saving` and `opening` are the same request. They are separate states because
 * a save that finishes in 200ms should say nothing at all — announcing work that
 * is already done reads as slowness — while one that is still going after half a
 * second needs to admit it. The threshold lives in the page container, not here.
 */
export type CustomerPageStatus =
  | "loading"
  | "idle"
  | "saving"
  | "opening"
  | "failed"
  | "offline"
  | "saved";
