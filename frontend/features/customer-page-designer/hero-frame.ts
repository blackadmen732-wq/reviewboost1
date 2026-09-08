/**
 * The shape of the customer page, as the owner's tools need to know it.
 *
 * The preview and the crop editor both have to agree with the real page about
 * how tall the hero is, or the owner positions a photograph against a frame the
 * customer never sees. These are the numbers the CSS composition resolves to on
 * a phone, kept in one place so the two tools cannot disagree.
 */

/** The device the preview stands in for: a mid-size modern phone. */
export const previewWidth = 390;
export const previewHeight = 844;

/** The rating sheet takes a little under a third; the hero takes the rest. */
export const heroHeightRatio = 0.677;

export const heroAspectRatio = previewWidth / (previewHeight * heroHeightRatio);
