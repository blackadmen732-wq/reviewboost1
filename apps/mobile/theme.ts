export const colors = {
  brand: "#00a86b",
  brandText: "#007a4d",
  onBrand: "#0d2118",
  brandHover: "#009a61",
  brandActive: "#008f5b",

  canvas: "#f6f7f5",
  surface: "#FFFFFF",
  surfaceAlt: "#F0F2F0",

  ink: "#171a18",
  inkMuted: "#6B7280",
  inkFaint: "#9CA3AF",

  border: "#E5E7EB",
  borderLight: "#D1D5DB",

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
  control: 14,
  card: 20,
  badge: 8,
} as const;

export const fonts = {
  heading: { fontWeight: "700" as const },
  subheading: { fontWeight: "600" as const },
  body: { fontWeight: "400" as const },
  label: { fontWeight: "500" as const },
} as const;
