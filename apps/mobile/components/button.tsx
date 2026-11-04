import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Tappable } from "@/components/tappable";
import { recoveryWords, STILL_WORKING_AFTER_MS } from "@/data/recovery";
import { colors, radii } from "@/theme";

/**
 * True once a busy button has said the same thing for four seconds. A new
 * busy label ("Uploading… 40%") is progress, so it starts the four again.
 */
function useStillWorking(busy: boolean, busyLabel: string | undefined): boolean {
  const [slowFor, setSlowFor] = useState<string | null>(null);
  const key = busy ? (busyLabel ?? "") : null;
  useEffect(() => {
    if (key === null) return;
    const timer = setTimeout(() => setSlowFor(key), STILL_WORKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return key !== null && slowFor === key;
}

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
  // A slow save never looks frozen: after four seconds the words say it is
  // still going (with Reduce Motion, the words are what changes).
  const slow = useStillWorking(busy, busyLabel);
  const busyText = slow ? recoveryWords.stillWorking : busyLabel;
  return (
    <Tappable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      accessibilityLabel={busy && busyText ? busyText : label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      style={[styles.base, styles[variant], disabled && !busy ? styles.disabled : null, style]}
    >
      {busy ? (
        <View style={styles.row}>
          <ActivityIndicator color={fg} />
          {busyText ? <Text style={[styles.label, { color: fg }]}>{busyText}</Text> : null}
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
