import { View, Text, StyleSheet } from "react-native";
import { colors } from "@/theme";

/**
 * A rating, drawn as five stars and read as one phrase.
 *
 * VoiceOver used to read five separate "black star" characters and never the
 * number, so a 2 and a 5 sounded the same. The row is now one accessible
 * element whose label is the rating; the glyphs themselves are decoration.
 */
export function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${rating} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Text
          key={n}
          importantForAccessibility="no"
          accessibilityElementsHidden
          style={[styles.star, { fontSize: size, color: n <= rating ? colors.starFilled : colors.starEmpty }]}
        >
          {"★"}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 2 },
  star: { lineHeight: 20 },
});
