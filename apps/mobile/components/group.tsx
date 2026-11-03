import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@/components/icon";
import { Tappable } from "@/components/tappable";
import { card, colors, type } from "@/theme";

/**
 * A titled white card of rows, the way iOS Settings groups things: a small
 * grey heading above, hairlines between rows, rounded corners, a soft lift.
 */
export function Group({
  title,
  footer,
  children,
  style,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={style}>
      {title ? (
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={styles.card}>
        {rows.map((row, index) => (
          <Fragment key={row.key ?? index}>
            {index > 0 ? <View style={styles.separator} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

/** One row in a Group. With `onPress` it is a button with a chevron. */
export function Row({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  chevron = true,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  chevron?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!onPress) {
    return (
      <View style={[styles.row, style]} {...(accessibilityLabel ? { accessible: true, accessibilityLabel } : {})}>
        <View style={styles.rowBody}>{children}</View>
      </View>
    );
  }
  return (
    <Tappable
      kind="row"
      onPress={onPress}
      accessibilityRole="button"
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      style={[styles.row, style]}
    >
      <View style={styles.rowBody}>{children}</View>
      {chevron ? <Icon name="chevron.right" glyph="›" size={14} color={colors.borderLight} weight="semibold" /> : null}
    </Tappable>
  );
}

const styles = StyleSheet.create({
  title: { ...type.subhead, color: colors.inkMuted, marginBottom: 8, marginLeft: 4 },
  card: { ...card, overflow: "hidden" },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 },
  row: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowBody: { flex: 1, minWidth: 0 },
  footer: { ...type.footnote, color: colors.inkMuted, marginTop: 8, marginHorizontal: 4 },
});
