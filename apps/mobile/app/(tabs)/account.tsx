import { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Linking from "expo-linking";
import { ProfileCard } from "@/components/profile-card";
import { SettingGroup, SettingRow } from "@/components/setting-list";
import { useAuth } from "@/data/auth-context";
import { useBilling } from "@/data/use-billing";
import { accountView } from "@/data/billing-view";
import { PUBLIC_LINKS } from "@/data/public-links";
import { colors, radii, fonts } from "@/theme";

/**
 * Account: the plan, what it includes, and what is left.
 *
 * Nothing here is a placeholder. There is no assumed plan, no assumed trial,
 * and no invented balance — until the backend answers, the screen says it is
 * loading, and if it cannot answer it says that instead of showing a plan the
 * business may not have.
 */
export default function AccountScreen() {
  const { activeOrg, logout, email } = useAuth();
  const { billing, loading, refreshing, error, refresh } = useBilling(activeOrg?.orgId);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const view = accountView(billing, error);
  const included = billing?.planId ? billing.plans[billing.planId] : null;

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {view.kind === "loading" && loading ? (
          <ActivityIndicator color={colors.brandText} />
        ) : null}

        {view.kind === "error" ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{view.message}</Text>
          </View>
        ) : null}

        <ProfileCard businessName={activeOrg?.name ?? "Your business"} email={email ?? null} />

        {view.kind === "ready" && billing ? (
          <>
            <SettingGroup label="Plan">
              <SettingRow first title={view.planName} description={view.statusBody} value={view.statusTitle} />
              {included ? (
                <SettingRow
                  title="Your plan includes"
                  description={`${included.locations} ${included.locations === 1 ? "place" : "places"} · ${included.tags} ${included.tags === 1 ? "Tag" : "Tags"} · ${included.monthlySmsSegments} messages a month`}
                />
              ) : null}
              <SettingRow
                title="Messages left"
                description={`${billing.smsBalance.monthly} included · ${billing.smsBalance.purchased} purchased`}
                value={String(billing.smsBalance.total)}
              />
            </SettingGroup>
          </>
        ) : null}

        {/* Apple 5.1.1(i) wants the privacy policy reachable in the app, and
            1.5 a way to reach us. Rows that open the public pages. */}
        <SettingGroup label="Help">
          {PUBLIC_LINKS.map((link, index) => (
            <SettingRow
              key={link.key}
              first={index === 0}
              title={link.label}
              onPress={() => void Linking.openURL(link.url)}
              accessibilityHint="Opens in your browser"
            />
          ))}
        </SettingGroup>

        {/* Apple 5.1.1(v): an app that creates accounts has to let someone
            start deleting one from inside it. Below sign out, and tinted
            rather than given a second red button, so the destructive one is
            not the thing a thumb finds first. */}
        <SettingGroup label="Account">
          <SettingRow first title="Sign out" onPress={() => void logout()} />
          <SettingRow title="Delete account" tone="danger" href="/delete-account" />
        </SettingGroup>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 20 },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radii.control, padding: 12 },
  errorText: { ...fonts.body, color: colors.danger },
});
