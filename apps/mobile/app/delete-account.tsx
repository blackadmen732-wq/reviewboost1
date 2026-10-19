import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";

import { Tappable } from "@/components/tappable";
import { accountFetch, apiFetch, ApiError } from "@/data/api";
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
  const { activeOrg, logout, refreshOrganizations } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);

  const businessName = activeOrg?.name ?? "";
  const matches =
    businessName.length > 0 &&
    typed.trim().toLowerCase() === businessName.trim().toLowerCase();
  const isOwner = activeOrg?.role === "owner";

  async function remove() {
    if (!matches || busy || uncertain || !activeOrg) return;
    setBusy(true);
    setError(null);

    try {
      const result = await apiFetch<{ data: { signInRemoved: boolean } }>(
        "/api/v1/account/deletion",
        activeOrg.orgId,
        {
          method: "POST",
          body: JSON.stringify({ confirmation: typed.trim() }),
        },
      );
      if (!result.data.signInRemoved) {
        await refreshOrganizations();
        router.replace("/select-org");
        return;
      }
      const signOutError = await logout();
      if (signOutError) {
        setError(
          "Business deleted. Could not clear your local sign-in. Try signing out from Account.",
        );
        return;
      }
      router.replace("/login");
    } catch (caught) {
      setUncertain(!(caught instanceof ApiError) || caught.status >= 500);
      setBusy(false);
      // The server distinguishes "we could not cancel your subscription" from
      // "that is not the business name", and both are actionable, so its
      // sentence is shown rather than a generic one.
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not confirm whether deletion finished. Check your businesses before trying again.",
      );
      return;
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen options={{ title: "Delete account" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {!isOwner ? (
          <PersonalDeletion hasBusiness={Boolean(activeOrg)} />
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

            {uncertain ? (
              <Tappable
                style={styles.cancel}
                onPress={() => {
                  void refreshOrganizations().then(() =>
                    router.replace("/select-org"),
                  );
                }}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Check my businesses</Text>
              </Tappable>
            ) : null}

            <Tappable
              style={[
                styles.destructive,
                !matches || busy || uncertain ? styles.disabled : null,
              ]}
              disabled={!matches || busy || uncertain}
              onPress={() => void remove()}
              accessibilityRole="button"
              accessibilityState={{ disabled: !matches || busy || uncertain, busy }}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.destructiveText}>Delete this business</Text>
              )}
            </Tappable>

            <Tappable style={styles.cancel} onPress={() => router.back()}>
              <Text style={styles.cancelText}>Keep my account</Text>
            </Tappable>

            <Text style={styles.body}>
              To keep the business and remove only yourself, the business needs
              another owner first. Then a team member can delete their own
              account here.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Deleting your own login (launch gap L1, Apple 5.1.1(v)).
 *
 * For a team member, or someone signed in with no business. Uses the same
 * endpoint as the web. The server refuses the only owner of a business and
 * says which one; that is shown rather than a generic failure.
 */
function PersonalDeletion({ hasBusiness }: { hasBusiness: boolean }) {
  const { logout } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);

  async function remove() {
    if (busy || uncertain) return;
    if (typed.trim().toLowerCase() !== "delete") {
      setError("Type delete to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await accountFetch<{ data: { deleted: boolean } }>(
        "/api/v1/account/personal-deletion",
        { method: "POST", body: JSON.stringify({ confirmation: typed.trim() }) },
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "owns_business") {
        setBlocked(caught.message);
      } else {
        const unknownOutcome = !(caught instanceof ApiError) || caught.status >= 500;
        setUncertain(unknownOutcome);
        setError(
          caught instanceof ApiError && !unknownOutcome
            ? caught.message
            : "We couldn't confirm whether your account was deleted. Sign in again to check before trying again.",
        );
      }
      setBusy(false);
      return;
    }
    // The login is gone server-side; clearing the local copy can't undo that.
    await logout();
    setBusy(false);
    router.replace("/login");
  }

  if (blocked) {
    return (
      <View style={styles.card}>
        <Text style={styles.body}>{blocked}</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>This cannot be undone.</Text>
        <Text style={styles.warningBody}>
          {hasBusiness
            ? "Your sign-in is deleted and you're removed from every team. The business keeps its ratings and Tags. Notes you wrote stay, marked Former team member."
            : "Your sign-in is deleted. You won't be able to sign in with it again."}
        </Text>
      </View>

      <View>
        <Text style={styles.label}>Type delete to confirm</Text>
        <TextInput
          style={styles.input}
          value={typed}
          onChangeText={(value) => {
            setTyped(value);
            if (error === "Type delete to confirm.") setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          accessibilityLabel="Type delete to confirm deleting your account"
        />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {uncertain ? (
        <Tappable
          style={styles.cancel}
          onPress={() => {
            void logout().then(() => router.replace("/login"));
          }}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>Sign in again to check</Text>
        </Tappable>
      ) : (
        <Tappable
          style={[styles.destructive, busy ? styles.disabled : null]}
          disabled={busy}
          onPress={() => void remove()}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.destructiveText}>Delete my account</Text>
          )}
        </Tappable>
      )}

      <Tappable style={styles.cancel} onPress={() => router.back()}>
        <Text style={styles.cancelText}>Keep my account</Text>
      </Tappable>
    </>
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
