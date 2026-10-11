export const colors = {
  brand: "#00a86b",
  brandText: "#007a4d",
  onBrand: "#0d2118",
  brandHover: "#009a61",
  brandActive: "#008f5b",
  action: "#007a4d",
  actionHover: "#006b43",
  actionPressed: "#005b39",
  onAction: "#ffffff",

  canvas: "#F6F7F5",
  surface: "#FFFFFF",
  surfaceAlt: "#F0F2F0",

  ink: "#171A18",
  inkMuted: "#5D655F",
  // The web's muted grey. #9CA3AF measured 2.5:1 on white and was used for
  // statuses, times and labels; this is 5.1:1 on white and 4.6:1 on the
  // darkest surface it sits on.
  inkFaint: "#66706a",

  // The web palette's --rb-border. These three had drifted — #D8DED9,
  // #B7C0BA and #BF7D00 against the web's #dce2de, #b9c3bd and #b97d0c —
  // the same names in two places, which is the whole problem. Measured,
  // the differences are under 0.1:1 on the hairlines and the web's star is
  // the better one (3.50:1 against 3.42:1, and a star has to clear 3:1).
  border: "#dce2de",
  borderLight: "#b9c3bd",

  danger: "#b33a3a",
  dangerBg: "#FEF2F2",
  dangerBorder: "#FECACA",

  success: "#16A34A",
  successBg: "#F0FDF4",

  infoBg: "#EFF6FF",
  info: "#356d8c",

  starFilled: "#b97d0c",
  starEmpty: "#D1D5DB",

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
