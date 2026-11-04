import { AppState, View, Text, StyleSheet, ScrollView } from "react-native";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandLockup } from "@/components/brand-lockup";
import { Button } from "@/components/button";
import { Group, Row } from "@/components/group";
import { Tappable } from "@/components/tappable";
import { useAuth } from "@/data/auth-context";
import { colors, radii, space, type } from "@/theme";
import type { Organization } from "@/data/types";
import { LoadingBlock } from "@/components/loading-block";
import { OfflineBar } from "@/components/offline-bar";
import { RetryBlock } from "@/components/retry-block";
import { takeDeletionNotice } from "@/data/farewell";
import { confirmSignOut } from "@/lib/confirm-sign-out";

export default function SelectOrgScreen() {
  const {
    organizations,
    selectOrg,
    name,
    logout,
    orgLoading,
    orgError,
    refreshOrganizations,
  } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  // "Your business was deleted.", once, when that is how the owner got here.
  const [notice] = useState<string | null>(() => takeDeletionNotice());

  // A business set up on the website meanwhile shows when the owner comes
  // back to the app, without signing out and in or restarting it.
  const refresh = useRef(refreshOrganizations);
  useEffect(() => {
    refresh.current = refreshOrganizations;
  });
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh.current();
    });
    return () => subscription.remove();
  }, []);

  const handleSelect = (orgId: string) => {
    selectOrg(orgId);
    router.replace("/(tabs)/home");
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    if (!(await confirmSignOut())) return;
    setLoggingOut(true);
    setLogoutError(null);
    const error = await logout();
    if (error) {
      setLogoutError(error);
      setLoggingOut(false);
      return;
    }
    router.replace("/login");
  };

  // "Welcome back, owner@mariospizza.test" wrapped over three lines. A first
  // name, when there is one, and otherwise just the words.
  const firstName = name && !name.includes("@") ? name.trim().split(/\s+/)[0] : null;
  // "Welcome back" said to someone who has only just signed up was wrong.
  const none = !orgLoading && !orgError && organizations.length === 0;
  const greeting = none ? "Welcome" : "Welcome back";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <BrandLockup height={26} />
          <Tappable
            kind="row"
            style={styles.logoutButton}
            onPress={handleLogout}
            disabled={loggingOut}
            accessibilityRole="button"
          >
            <Text style={styles.logoutText}>{loggingOut ? "Signing out…" : "Sign out"}</Text>
          </Tappable>
        </View>
        <OfflineBar />
        {notice ? (
          <View style={styles.doneBox}>
            <Text style={styles.doneText} accessibilityLiveRegion="polite">
              {notice}
            </Text>
          </View>
        ) : null}
        <Text style={styles.greeting} accessibilityRole="header">
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </Text>
        {none ? null : <Text style={styles.subtitle}>Choose your business</Text>}
        {logoutError && <Text style={styles.errorText}>{logoutError}</Text>}

        <View style={styles.list}>
          {organizations.length > 0 ? (
            <Group>
              {organizations.map((item: Organization) => (
                <Row
                  key={item.orgId}
                  onPress={() => handleSelect(item.orgId)}
                  accessibilityLabel={`${item.name}, ${item.role}`}
                >
                  <Text style={styles.orgName}>{item.name}</Text>
                  <Text style={styles.role}>{item.role}</Text>
                </Row>
              ))}
            </Group>
          ) : orgLoading ? (
            <LoadingBlock label="Loading your businesses…" />
          ) : orgError ? (
            <RetryBlock message={orgError} retryKey="select-org" onRetry={() => void refreshOrganizations()} />
          ) : (
            <View style={styles.notice}>
              {/* A new email lands here with nothing to choose. Said as a
                  fact, with no link: businesses are set up on the website
                  (where plans are too, which this app may not point at). */}
              <Text style={styles.emptyTitle}>This email has no business yet</Text>
              <Text style={styles.emptyBody}>
                ReviewBoost businesses are set up on the website. Once yours is, it shows here.
              </Text>
              <Button label="Check again" onPress={() => void refreshOrganizations()} />
              {/* Someone with no business must still be able to delete their
                  account in the app (launch gap L1, Apple 5.1.1(v)). */}
              <Tappable kind="row" onPress={() => router.push("/delete-account")} accessibilityRole="button">
                <Text style={[styles.logoutText, styles.deleteLink]}>Delete my account</Text>
              </Tappable>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.gutter, paddingBottom: 40 },
  topBar: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  greeting: { ...type.largeTitle, color: colors.ink, marginTop: 16 },
  subtitle: { ...type.callout, color: colors.inkMuted, marginTop: 6 },
  logoutButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: radii.badge,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  logoutText: { ...type.subhead, fontWeight: "500", color: colors.inkMuted },
  list: { marginTop: 28 },
  orgName: { ...type.headline, color: colors.ink },
  role: { ...type.subhead, color: colors.inkMuted, marginTop: 2, textTransform: "capitalize" },
  notice: { gap: 12, alignItems: "stretch" },
  emptyTitle: { ...type.headline, color: colors.ink },
  emptyBody: { ...type.callout, color: colors.inkMuted, marginBottom: 8 },
  doneBox: { backgroundColor: colors.successBg, borderRadius: radii.badge, padding: 12, marginTop: 8 },
  doneText: { ...type.subhead, color: colors.ink, textAlign: "center" },
  errorText: { ...type.subhead, textAlign: "center", color: colors.danger, marginTop: 12 },
  deleteLink: { textAlign: "center", textDecorationLine: "underline", minHeight: 44, paddingTop: 12 },
});
