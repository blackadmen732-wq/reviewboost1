import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { BrandLockup } from "@/components/brand-lockup";
import { Icon } from "@/components/icon";
import { Tappable } from "@/components/tappable";
import { colors, space, type } from "@/theme";

/**
 * A daily screen, laid out like the website's: ReviewBoost on the left and
 * Settings on the right at the top, then the page's large title and one line
 * saying what it is for. Settings is secondary (AGENTS.md), so it is a gear
 * here rather than a fifth tab.
 */
export function TabScreen({
  title,
  subtitle,
  children,
  refreshing = false,
  onRefresh,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        {...(onRefresh
          ? { refreshControl: <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.inkMuted} /> }
          : {})}
      >
        <View style={styles.topBar}>
          <BrandLockup height={26} />
          <Tappable
            kind="row"
            onPress={() => router.push("/account")}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={8}
            style={styles.gear}
          >
            <Icon name="gearshape" glyph="⚙" size={22} color={colors.inkMuted} />
          </Tappable>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.body}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** The native header for a pushed screen: title in the middle, back on the left. */
export function stackHeader(title: string) {
  return {
    title,
    headerShown: true,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.canvas },
    headerTitleStyle: { fontSize: 17, fontWeight: "600" as const, color: colors.ink },
    headerTintColor: colors.ink,
    headerBackButtonDisplayMode: "minimal" as const,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.gutter, paddingBottom: 40 },
  topBar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  gear: { width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" },
  title: { ...type.largeTitle, color: colors.ink, marginTop: 4 },
  subtitle: { ...type.callout, color: colors.inkMuted, marginTop: 6 },
  body: { marginTop: 24, gap: space.section },
});
