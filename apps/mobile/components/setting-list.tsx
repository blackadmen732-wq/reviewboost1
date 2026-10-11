import type { ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Link, type Href } from "expo-router";

import { Tappable } from "@/components/tappable";
import { colors, radii, fonts } from "@/theme";

/**
 * The grouped settings list — the app's half of the one on the website.
 *
 * `frontend/components/ui/setting-list.tsx` is the other half. Same shape, on
 * purpose: a quiet caption, then a card of rows, then the next caption. The
 * app had a flat stack of unlabelled cards and a separate list of plain link
 * rows, which is the before-and-after in the reference exactly — same
 * information, no grouping, nothing telling you which setting leads where.
 *
 * `value` is the half that earns the most: `Theme  Light ›` tells someone
 * what a door leads to before they open it. Without it every row is a
 * question mark and the only way to read a setting is to tap it.
 *
 * No icons: React Native has no icon library here, and icons are not what
 * changes between the two halves of the reference — they are in both. The
 * grouping and the values are the difference, so those are what this carries.
 *
 * The divider is `borderLight`, not `border`: inside a card the hairline is
 * the only thing separating one row from the next, and `border` on white is
 * 1.31:1 — close to invisible on a phone in daylight. Same reasoning, and the
 * same token pair, as the web component.
 */
export function SettingGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      {label ? <Text style={styles.caption}>{label}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function SettingRow({
  title,
  description,
  value,
  first = false,
  tone = "default",
  href,
  onPress,
  accessibilityHint,
}: {
  title: string;
  description?: string | undefined;
  /** Right-aligned current value, as in `Messages left  420 ›`. */
  value?: string | undefined;
  /** Rows after the first draw the hairline above themselves. */
  first?: boolean;
  /** Danger tints the title only; the row keeps its place in the list. */
  tone?: "default" | "danger";
  /** A route. `href` makes the row a link, `onPress` a button, neither a
   *  plain readout — the same three shapes the web SettingRow has. */
  href?: Href | undefined;
  onPress?: (() => void) | undefined;
  accessibilityHint?: string | undefined;
}) {
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.title, tone === "danger" ? styles.titleDanger : null]}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {href || onPress ? (
        <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
          ›
        </Text>
      ) : null}
    </>
  );

  const shell = [styles.row, first ? null : styles.rowDivider];

  if (href) {
    return (
      <Link href={href} asChild>
        <Tappable
          kind="row"
          style={shell}
          accessibilityRole="button"
          {...(accessibilityHint ? { accessibilityHint } : {})}
        >
          {body}
        </Tappable>
      </Link>
    );
  }

  if (!onPress) return <View style={shell}>{body}</View>;

  return (
    <Tappable
      kind="row"
      style={shell}
      onPress={onPress}
      accessibilityRole="button"
      {...(accessibilityHint ? { accessibilityHint } : {})}
    >
      {body}
    </Tappable>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  caption: {
    paddingHorizontal: 4,
    fontSize: 14,
    ...fonts.label,
    color: colors.inkFaint,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  rowText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, ...fonts.label, color: colors.ink },
  titleDanger: { color: colors.danger },
  description: { marginTop: 2, fontSize: 14, ...fonts.body, color: colors.inkFaint },
  value: { fontSize: 14, ...fonts.body, color: colors.inkFaint },
  chevron: { fontSize: 20, color: colors.borderLight },
});
