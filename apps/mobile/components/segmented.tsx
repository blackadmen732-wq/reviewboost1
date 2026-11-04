import { StyleSheet, Text, View } from "react-native";
import { Tappable } from "@/components/tappable";
import { colors, type } from "@/theme";

/**
 * Two or three views of one list, as underlined words like the website's
 * Feedback tabs ("Needs you · Everything"). Each is a tab for VoiceOver.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Tappable
            key={option.value}
            kind="row"
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={styles.tab}
          >
            <Text style={[styles.label, selected ? styles.selected : null]}>{option.label}</Text>
            <View style={[styles.bar, selected ? styles.barOn : null]} />
          </Tappable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 24, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { minHeight: 44, justifyContent: "flex-end" },
  label: { ...type.callout, color: colors.inkMuted, paddingBottom: 10 },
  selected: { color: colors.ink, fontWeight: "600" },
  bar: { height: 2, borderRadius: 1, backgroundColor: "transparent" },
  barOn: { backgroundColor: colors.ink },
});
