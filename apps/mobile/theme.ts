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
  starEmpty: "#8F8F8A",

  white: "#FFFFFF",
} as const;

export const radii = {
  control: 12,
  card: 16,
  badge: 8,
} as const;

export const fonts = {
  heading: { fontWeight: "700" as const },
  subheading: { fontWeight: "600" as const },
  body: { fontWeight: "400" as const },
  label: { fontWeight: "500" as const },
} as const;
