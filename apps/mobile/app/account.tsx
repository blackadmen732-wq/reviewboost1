import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router, useFocusEffect } from "expo-router";
import * as Linking from "expo-linking";
import { Button } from "@/components/button";
import { Group, Row } from "@/components/group";
import { stackHeader } from "@/components/screen";
import { useAuth } from "@/data/auth-context";
import { useHome } from "@/data/home";
import { useBilling } from "@/data/use-billing";
import { accountView, includedView } from "@/data/billing-view";
import { PUBLIC_LINKS } from "@/data/public-links";
import { colors, space, type } from "@/theme";
import { OfflineBar } from "@/components/offline-bar";
import { RetryBlock } from "@/components/retry-block";
import { confirmSignOut } from "@/lib/confirm-sign-out";

/**
 * Settings: which business, the plan and what is left, who is signed in, the
 * public pages, sign out, and delete account. Secondary to the four daily
 * tabs, so it opens from the gear at the top of each.
 *
 * Nothing here is a placeholder. There is no assumed plan, no assumed trial,
 * and no invented balance — until the backend answers, the screen says it is
 * loading, and if it cannot answer it says that instead of showing a plan the
 * business may not have. Nothing here sells or points at where to pay
 * (App Store 3.1.3(f)).
 */
export default function AccountScreen() {
  const { activeOrg, organizations, switchBusiness, logout, email } = useAuth();
  const { billing, loading, refreshing, error, refresh } = useBilling(activeOrg?.orgId);
  // Texts are not shown while the server says texting is off (data/features.ts).
  const { features } = useHome();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const view = accountView(billing, error);
  // What the server enforces (a trial is one place and one Tag), not the
  // catalog's numbers for the plan the trial will become.
  const included = view.kind === "ready" ? includedView(billing) : null;
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (signingOut || !(await confirmSignOut())) return;
    setSigningOut(true);
    await logout();
    setSigningOut(false);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen options={stackHeader("Settings")} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.inkMuted} />}
      >
        <OfflineBar />
        <Group title="Business">
          <Row>
            <Text style={styles.value}>{activeOrg?.name ?? "—"}</Text>
            {activeOrg ? (
              <Text style={styles.detail}>{activeOrg.role.charAt(0).toUpperCase() + activeOrg.role.slice(1)}</Text>
            ) : null}
          </Row>
          {organizations.length > 1 ? (
            <Row onPress={switchBusiness} accessibilityHint="Choose another of your businesses">
              <Text style={styles.action}>Switch business</Text>
            </Row>
          ) : null}
        </Group>

        <Group title="Plan">
          {view.kind === "loading" ? (
            <Row>{loading ? <ActivityIndicator color={colors.inkMuted} /> : <Text style={styles.detail}>Loading…</Text>}</Row>
          ) : view.kind === "error" ? (
            // Tries again by itself (3 s, 10 s, 30 s, or when back online),
            // never stuck on "Couldn't load billing." after an offline moment.
            <Row>
              <RetryBlock message={view.message} retryKey="billing" onRetry={() => void refresh()} />
            </Row>
          ) : (
            <Row>
              <View style={styles.planHead}>
                <Text style={styles.value}>{view.planName}</Text>
                {view.statusTitle ? (
                  <Text style={[styles.status, view.needsAttention ? styles.statusBad : null]}>{view.statusTitle}</Text>
                ) : null}
              </View>
              <Text style={styles.detail}>{view.statusBody}</Text>
            </Row>
          )}
          {included ? (
            <Row>
              <Text style={styles.label}>{included.label}</Text>
              <Text style={styles.detail}>
                {included.locations} {included.locations === 1 ? "place" : "places"} · {included.tags}{" "}
                {included.tags === 1 ? "Tag" : "Tags"}
                {features.texting ? ` · ${included.texts.toLocaleString("en-US")} texts a month` : ""}
              </Text>
            </Row>
          ) : null}
          {view.kind === "ready" && billing && features.texting ? (
            <Row>
              <View style={styles.planHead}>
                <Text style={styles.label}>Texts left</Text>
                <Text style={styles.number}>{billing.smsBalance.total.toLocaleString("en-US")}</Text>
              </View>
              <Text style={styles.detail}>
                {billing.smsBalance.monthly.toLocaleString("en-US")} included this month ·{" "}
                {billing.smsBalance.purchased.toLocaleString("en-US")} purchased
              </Text>
            </Row>
          ) : null}
        </Group>

        <Group title="Signed in as">
          <Row>
            <Text style={styles.value} numberOfLines={1}>
              {email ?? "—"}
            </Text>
          </Row>
        </Group>

        {/* Apple 5.1.1(i) wants the privacy policy reachable in the app, and
            1.5 a way to reach us. Plain rows that open the public pages. */}
        <Group>
          {PUBLIC_LINKS.map((link) => (
            <Row
              key={link.key}
              onPress={() => void Linking.openURL(link.url)}
              accessibilityHint="Opens in your browser"
            >
              <Text style={styles.value}>{link.label}</Text>
            </Row>
          ))}
        </Group>

        <View style={styles.footer}>
          <Button
            label="Sign out"
            variant="secondary"
            busy={signingOut}
            busyLabel="Signing out…"
            onPress={() => void signOut()}
          />
          {/* Apple 5.1.1(v): an app that creates accounts has to let someone
              start deleting one from inside it. Below sign-out and styled as a
              plain row rather than a second red button, so the destructive one
              is not the thing a thumb finds first. */}
          <Button label="Delete account" variant="quiet" onPress={() => router.push("/delete-account")} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.gutter, gap: space.section, paddingBottom: 48 },
  value: { ...type.callout, color: colors.ink },
  label: { ...type.subhead, fontWeight: "500", color: colors.inkMuted },
  detail: { ...type.subhead, color: colors.inkMuted, marginTop: 2, textTransform: "none" },
  action: { ...type.callout, fontWeight: "500", color: colors.ink },
  planHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  status: { ...type.subhead, fontWeight: "500", color: colors.inkMuted },
  statusBad: { color: colors.danger },
  number: { ...type.headline, color: colors.ink, fontVariant: ["tabular-nums"] },
  error: { ...type.subhead, color: colors.danger },
  footer: { gap: 4 },
});
