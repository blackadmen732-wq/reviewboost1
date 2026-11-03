import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Tappable } from "@/components/tappable";
import { colors, radii } from "@/theme";

/**
 * The website's buttons: one near-black action per screen, white secondary
 * buttons with a light outline, and a quiet text button. Green is the brand,
 * not a button colour (DESIGN.md §3), so nothing here is green.
 */
export function Button({
  label,
  onPress,
  variant = "action",
  disabled = false,
  busy = false,
  busyLabel,
  icon,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: "action" | "secondary" | "quiet";
  disabled?: boolean;
  busy?: boolean;
  /** Said instead of the label while busy, e.g. "Saving…". */
  busyLabel?: string;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const inactive = disabled || busy;
  const fg = variant === "action" ? colors.onAction : colors.ink;
  return (
    <Tappable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      accessibilityLabel={busy && busyLabel ? busyLabel : label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      style={[styles.base, styles[variant], disabled && !busy ? styles.disabled : null, style]}
    >
      {busy ? (
        <View style={styles.row}>
          <ActivityIndicator color={fg} />
          {busyLabel ? <Text style={[styles.label, { color: fg }]}>{busyLabel}</Text> : null}
        </View>
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.label, { color: fg }, variant === "quiet" ? styles.quietLabel : null]}>{label}</Text>
        </View>
      )}
    </Tappable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radii.control,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  action: { backgroundColor: colors.action },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  quiet: { minHeight: 44, paddingHorizontal: 8 },
  disabled: { opacity: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 17, fontWeight: "600" },
  quietLabel: { fontSize: 15, fontWeight: "500", color: colors.inkMuted },
});
