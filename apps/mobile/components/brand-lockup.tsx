import { Image, Text, View } from "react-native";

import { colors } from "@/theme";

/**
 * The horizontal lockup, `[mark] ReviewBoost`, for the app's own screens.
 *
 * The mark is a raster of `Branding/Mark.svg`, written by
 * `scripts/brand/generate-brand-assets.mjs` at 48pt and 2x/3x, so it stays
 * sharp at any height up to that. Regenerate it there; never edit the PNGs.
 *
 * Proportions follow the web header and `Branding/Logo.svg`: type at 0.6 of
 * the mark's height, a gap of a quarter of it, "Review" in ink and "Boost" in
 * the one brand green, same weight, one word.
 */

/** Width over height of Branding/Mark.svg's box (290.09 x 269.09). */
const MARK_ASPECT = 290.09 / 269.09;

export function BrandLockup({ height = 28 }: { height?: number }) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: height * 0.25 }}
      accessible
      accessibilityRole="image"
      accessibilityLabel="ReviewBoost"
    >
      <Image
        source={require("../assets/logo-mark.png")}
        style={{ width: height * MARK_ASPECT, height }}
        accessibilityIgnoresInvertColors
      />
      <Text
        style={{
          fontSize: height * 0.6,
          fontWeight: "600",
          letterSpacing: height * 0.6 * -0.02,
          color: colors.ink,
        }}
        importantForAccessibility="no"
      >
        Review<Text style={{ color: colors.brand }}>Boost</Text>
      </Text>
    </View>
  );
}
