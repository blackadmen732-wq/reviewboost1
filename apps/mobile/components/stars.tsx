import { View, Text, StyleSheet } from "react-native";
import { colors } from "@/theme";

export function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Text
          key={n}
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
