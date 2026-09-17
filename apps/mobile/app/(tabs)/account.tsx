import { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useFocusEffect } from "expo-router";
import { useAuth } from "@/data/auth-context";
import { useBilling } from "@/data/use-billing";
import { accountView } from "@/data/billing-view";
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

        {view.kind === "ready" && billing ? (
          <>
            <View style={[styles.card, view.needsAttention ? styles.cardBad : null]}>
              <Text style={styles.cardLabel}>{view.statusTitle}</Text>
              <Text style={styles.cardTitle}>{view.planName}</Text>
              <Text style={styles.cardBody}>{view.statusBody}</Text>
            </View>

            {included ? (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Your plan includes</Text>
                <Text style={styles.cardBody}>
                  {included.locations} {included.locations === 1 ? "place" : "places"} ·{" "}
                  {included.tags} {included.tags === 1 ? "Tag" : "Tags"} ·{" "}
                  {included.monthlySmsSegments} messages a month
                </Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Messages left</Text>
              <Text style={styles.cardTitle}>{billing.smsBalance.total}</Text>
              <Text style={styles.cardBody}>
                {billing.smsBalance.monthly} included · {billing.smsBalance.purchased} purchased
              </Text>
            </View>
          </>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Signed in as</Text>
          <Text style={styles.cardBody}>{email ?? "—"}</Text>
        </View>

        <Pressable style={styles.signOut} onPress={() => void logout()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        {/* Apple 5.1.1(v): an app that creates accounts has to let someone
            start deleting one from inside it. Below sign-out and styled as a
            plain row rather than a second red button, so the destructive one
            is not the thing a thumb finds first. */}
        <Link href="/delete-account" asChild>
          <Pressable style={styles.deleteRow}>
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  cardBad: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
  cardLabel: { ...fonts.label, color: colors.inkFaint },
  cardTitle: { ...fonts.heading, color: colors.ink, marginTop: 2 },
  cardBody: { ...fonts.body, color: colors.inkMuted, marginTop: 4 },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radii.control, padding: 12 },
  errorText: { ...fonts.body, color: colors.danger },
  signOut: {
    marginTop: 8,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    alignItems: "center",
  },
  signOutText: { ...fonts.body, color: colors.danger },
  deleteRow: { padding: 14, alignItems: "center" },
  deleteText: { ...fonts.body, color: colors.inkMuted },
});
