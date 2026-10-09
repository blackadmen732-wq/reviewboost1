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

  border: "#D8DED9",
  borderLight: "#B7C0BA",

  danger: "#b33a3a",
  dangerBg: "#FEF2F2",
  dangerBorder: "#FECACA",

  success: "#16A34A",
  successBg: "#F0FDF4",

  infoBg: "#EFF6FF",
  info: "#356d8c",

  starFilled: "#bf7d00",
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
