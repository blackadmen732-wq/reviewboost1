import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";

import { apiFetch, ApiError } from "@/data/api";
import { useAuth } from "@/data/auth-context";
import { colors, fonts, radii } from "@/theme";

/**
 * Deleting the account, from inside the app.
 *
 * Apple 5.1.1(v): an app that lets people create an account has to let them
 * begin deleting it here, not by finding an email address on a website. This
 * is the same endpoint the web uses — one deletion path, one set of rules,
 * rather than a second implementation that will drift.
 *
 * Typing the business name rather than a confirm alert, for the same reason as
 * the web: an alert is muscle memory, and the alerts that mattered looked
 * exactly like the ones that did not. The database checks the name too.
 */
export default function DeleteAccountScreen() {
  const { activeOrg, logout } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessName = activeOrg?.name ?? "";
  const matches =
    businessName.length > 0 &&
    typed.trim().toLowerCase() === businessName.trim().toLowerCase();
  const isOwner = activeOrg?.role === "owner";

  async function remove() {
    if (!matches || busy || !activeOrg) return;
    setBusy(true);
    setError(null);

    try {
      await apiFetch("/api/v1/account/deletion", activeOrg.orgId, {
        method: "POST",
        body: JSON.stringify({ confirmation: typed.trim() }),
      });
    } catch (caught) {
      setBusy(false);
      // The server distinguishes "we could not cancel your subscription" from
      // "that is not the business name", and both are actionable, so its
      // sentence is shown rather than a generic one.
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Something went wrong and nothing has been deleted.",
      );
      return;
    }

    // The login this session belonged to is gone on the usual path, so the
    // stored session is worthless. Signing out clears it and sends the app
    // back to the login screen through the normal auth flow.
    await logout();
    router.replace("/login");
  }

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen options={{ title: "Delete account" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {!isOwner ? (
          <View style={styles.card}>
            <Text style={styles.body}>
              Only an owner can delete the business. If you want your own access
              removed, ask an owner to remove you from the team.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.warning}>
              <Text style={styles.warningTitle}>This cannot be undone.</Text>
              <Text style={styles.warningBody}>
                The Tags on your counter stop working. Every rating your
                customers left is deleted. Your subscription is cancelled as
                part of this.
              </Text>
            </View>

            {/* States the distinction without instructing a step that cannot
                be taken here — cancelling lives in Billing on the web, and
                pointing at it from inside the app is what 3.1.3(b) restricts.
                The sentence still earns its place: somebody about to delete
                when they meant to pause needs to know those are different. */}
            <Text style={styles.body}>
              Cancelling your plan stops the billing without deleting anything,
              and keeps your ratings. Deleting is not the way to pause.
            </Text>

            <View>
              <Text style={styles.label}>Type {businessName} to confirm</Text>
              <TextInput
                style={styles.input}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                accessibilityLabel={`Type ${businessName} to confirm deletion`}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.destructive, !matches || busy ? styles.disabled : null]}
              disabled={!matches || busy}
              onPress={() => void remove()}
              accessibilityRole="button"
              accessibilityState={{ disabled: !matches || busy, busy }}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.destructiveText}>Delete this business</Text>
              )}
            </Pressable>

            <Pressable style={styles.cancel} onPress={() => router.back()}>
              <Text style={styles.cancelText}>Keep my account</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  warning: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    padding: 16,
    gap: 6,
  },
  warningTitle: { ...fonts.heading, color: colors.danger },
  warningBody: { ...fonts.body, color: colors.ink },
  body: { ...fonts.body, color: colors.inkMuted },
  label: { ...fonts.label, color: colors.ink, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    ...fonts.body,
    color: colors.ink,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.control,
    padding: 12,
  },
  errorText: { ...fonts.body, color: colors.danger },
  destructive: {
    backgroundColor: colors.danger,
    borderRadius: radii.control,
    padding: 16,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  destructiveText: { ...fonts.body, color: colors.white, fontWeight: "600" },
  cancel: {
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: "center",
  },
  cancelText: { ...fonts.body, color: colors.ink },
});
