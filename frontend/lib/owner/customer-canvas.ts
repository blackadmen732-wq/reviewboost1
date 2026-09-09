/**
 * Canonical customer page canvas (Owner Systems Spec v1.9 / v1.10).
 *
 * Mario’s Pizza mock is the visual SoT. The owner phone frame and live `/q`
 * must share this geometry so drag/pinch framing is the same crop the
 * customer sees. The rating card is a fixed share of the stage — it never
 * moves or resizes when the photo is positioned.
 */

export const CUSTOMER_CANVAS = {
  width: 390,
  height: 844,
  /** CSS `aspect-ratio` for the phone screen and live stage. */
  aspectRatio: "390 / 844",
  /** Hero (photo) share of stage height. Card is the remainder. */
  heroShare: 0.54,
  cardShare: 0.46,
} as const;
