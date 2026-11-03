/**
 * The same palette as the web app (frontend/styles/globals.css, light mode),
 * chosen 18 October 2026: warm white canvas, white surfaces, near-black
 * action buttons, brand green for identity and success only. DESIGN.md §3.
 * The launch screen's #005B3E field is separate and unchanged.
 */
export const colors = {
  brand: "#00a86b",
  brandText: "#00754a",
  onBrand: "#0d2118",
  brandHover: "#009a61",
  brandActive: "#008f5b",
  action: "#1a1a19",
  actionHover: "#333331",
  actionPressed: "#000000",
  onAction: "#ffffff",

  canvas: "#FCFCFB",
  surface: "#FFFFFF",
  surfaceAlt: "#EDECE8",

  ink: "#1A1A19",
  inkMuted: "#6B6B67",
  // The web's muted grey. #9CA3AF measured 2.5:1 on white and was used for
  // statuses, times and labels; this is 5.2:1 on the canvas and 4.5:1 on
  // surfaceAlt, the darkest surface it sits on.
  inkFaint: "#6B6B67",

  border: "#E2E2E1",
  // The web's --rb-border-strong: outlines that must be seen (3.16:1).
  borderLight: "#8F8F8A",

  danger: "#b33a3a",
  dangerBg: "#FEF2F2",
  dangerBorder: "#FECACA",

  success: "#16A34A",
  successBg: "#F0FDF4",

  infoBg: "#EFF6FF",
  info: "#356d8c",

  starFilled: "#B97D0C",
  // The website's empty star (--rb-border). Filled stars carry the rating,
  // and every row of stars is read aloud as "N out of 5 stars".
  starEmpty: "#E2E2E1",

  white: "#FFFFFF",
} as const;

export const radii = {
  control: 16,
  card: 24,
  badge: 8,
} as const;

export const fonts = {
  heading: { fontWeight: "700" as const },
  subheading: { fontWeight: "600" as const },
  body: { fontWeight: "400" as const },
  label: { fontWeight: "500" as const },
} as const;

/**
 * The type scale, iPhone sizes: a large title per screen, like the website's
 * page titles and like iOS's own apps, then headline, body and footnote.
 */
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700" as const, letterSpacing: 0.2 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700" as const },
  number: { fontSize: 44, lineHeight: 50, fontWeight: "700" as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
  body: { fontSize: 17, lineHeight: 24, fontWeight: "400" as const },
  callout: { fontSize: 16, lineHeight: 22, fontWeight: "400" as const },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: "400" as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
} as const;

/**
 * White cards on the warm canvas, lifted by a soft shadow rather than a hard
 * outline: the grouped look of iOS Settings and the website's tiles. The
 * hairline keeps the edge visible where shadows are faint (Android, web).
 */
export const card = {
  backgroundColor: colors.surface,
  borderRadius: radii.card,
  borderWidth: 1,
  borderColor: "#EEEEEC",
  shadowColor: "#1A1A19",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
} as const;

export const space = { gutter: 20, section: 28 } as const;
