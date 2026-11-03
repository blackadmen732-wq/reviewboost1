import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/icon";
import { Tappable } from "@/components/tappable";
import { colors, radii, type } from "@/theme";

/** One of several answers: a radio circle, the words, and a card outline that darkens when chosen. */
export function RadioCard({
  selected,
  onPress,
  children,
  disabled = false,
}: {
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tappable
      kind="row"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={[styles.card, selected ? styles.cardOn : null]}
    >
      <View style={[styles.radio, selected ? styles.radioOn : null]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.body}>{typeof children === "string" ? <Text style={styles.text}>{children}</Text> : children}</View>
    </Tappable>
  );
}

/** A yes the owner has to give on purpose: unticked until they tick it. */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Tappable
      kind="row"
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      style={styles.checkRow}
    >
      <View style={[styles.box, checked ? styles.boxOn : null]}>
        {checked ? <Icon name="checkmark" glyph="✓" size={14} color={colors.onAction} weight="bold" /> : null}
      </View>
      <Text style={[styles.text, styles.body]}>{label}</Text>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    minHeight: 52,
    padding: 14,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardOn: { borderColor: colors.ink, borderWidth: 1.5 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  radioOn: { borderColor: colors.ink },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.ink },
  body: { flex: 1 },
  text: { ...type.callout, color: colors.ink },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: 44, paddingVertical: 4 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    backgroundColor: colors.surface,
  },
  boxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
});
