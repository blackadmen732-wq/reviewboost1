import { useEffect, useRef, useState } from "react";
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
import { OfflineBar } from "@/components/offline-bar";
import { OutcomeCheckNotice } from "@/components/outcome-check-notice";
import { stackHeader } from "@/components/screen";

import { Button } from "@/components/button";
import { Tappable } from "@/components/tappable";
import { accountFetch, apiFetch, ApiError } from "@/data/api";
import { useAuth } from "@/data/auth-context";
import {
  DELETED_BUSINESS,
  DELETED_BUSINESS_AND_SIGN_IN,
  DELETED_SIGN_IN,
  sayAfterDeletion,
} from "@/data/farewell";
import { useOutcomeCheck } from "@/data/use-outcome-check";
import { sameTypedName } from "@/lib/typed-name";
import { colors, radii, type } from "@/theme";

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
  const { activeOrg, organizations, logout, refreshOrganizations } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyMe, setOnlyMe] = useState(false);
  /** What a check found gone: the whole login, or just this business. */
  const gone = useRef<"login" | "business">("business");
  // A lost answer is settled by asking the server whether the business is
  // still there, never by deleting again or sending the owner to look.
  const check = useOutcomeCheck({
    onDone: () => void leave(gone.current === "login"),
    onNotDone: () => setError("Your business was not deleted. Nothing changed. Try again."),
    onExpired: setError,
  });
  const holding = busy || check.pending;

  const businessName = activeOrg?.name ?? "";
  // Case, spaces and curly versus straight quotes aside (lib/typed-name.ts).
  const matches = sameTypedName(typed, businessName);
  const isOwner = activeOrg?.role === "owner";

  /**
   * Whether "Delete only my account" can work: the server refuses the only
   * owner of a business. Asked first, so an only owner is not led into a
   * flow just to be turned away. Unknown (the check failed) keeps the option:
   * the server still says no, and that screen offers the way that works.
   */
  const [onlyOwner, setOnlyOwner] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isOwner) return;
    let live = true;
    accountFetch<{ data: { allowed: boolean } }>("/api/v1/account/personal-deletion")
      .then((res) => {
        if (live) setOnlyOwner(!res.data.allowed);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isOwner]);

  async function leave(signInRemoved: boolean) {
    if (!signInRemoved) {
      sayAfterDeletion(DELETED_BUSINESS);
      await refreshOrganizations();
      router.replace("/select-org");
      return;
    }
    sayAfterDeletion(DELETED_BUSINESS_AND_SIGN_IN);
    const signOutError = await logout();
    if (signOutError) {
      setError(
        "Business deleted. Could not clear your local sign-in. Try signing out from Account.",
      );
      return;
    }
    router.replace("/login");
  }

  async function remove() {
    if (!matches || holding || !activeOrg) return;
    const orgId = activeOrg.orgId;
    setBusy(true);
    setError(null);

    /** Gone: its places stop answering for it (404), or the login is gone (401). */
    const isDeleted = async (signal: AbortSignal): Promise<boolean> => {
      try {
        await apiFetch("/api/v1/locations", orgId, { signal });
        return false;
      } catch (read) {
        if (read instanceof ApiError && (read.status === 404 || read.status === 401)) {
          gone.current = read.status === 401 ? "login" : "business";
          return true;
        }
        throw read;
      }
    };

    try {
      const result = await apiFetch<{ data: { signInRemoved: boolean } }>(
        "/api/v1/account/deletion",
        orgId,
        {
          method: "POST",
          // The business's own name once the typing matches, so the
          // database's exact check passes whichever apostrophe was typed.
          body: JSON.stringify({ confirmation: businessName.trim() }),
        },
      );
      setBusy(false);
      await leave(result.data.signInRemoved);
    } catch (caught) {
      setBusy(false);
      // The server distinguishes "we could not cancel your subscription" from
      // "that is not the business name", and both are actionable, so its
      // sentence is shown rather than a generic one.
      if (caught instanceof ApiError && caught.status < 500) {
        setError(caught.message);
        return;
      }
      check.start(isDeleted, {
        serverAnswered: caught instanceof ApiError && caught.status >= 500,
      });
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen options={stackHeader("Delete account")} />
      <ScrollView contentContainerStyle={styles.content}>
        <OfflineBar />
        {!isOwner || onlyMe ? (
          <PersonalDeletion
            hasBusiness={Boolean(activeOrg)}
            businessName={businessName}
            onDeleteBusiness={isOwner ? () => setOnlyMe(false) : undefined}
          />
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
                editable={!holding}
                accessibilityLabel={`Type ${businessName} to confirm deletion`}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <OutcomeCheckNotice check={check} />

            <Tappable
              style={[
                styles.destructive,
                !matches || holding ? styles.disabled : null,
              ]}
              disabled={!matches || holding}
              onPress={() => void remove()}
              accessibilityRole="button"
              accessibilityState={{ disabled: !matches || holding, busy }}
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

            {onlyOwner ? (
              // Deleting the business is the only way out for its only owner,
              // and it takes the sign-in with it when nothing else needs it.
              <Text style={styles.body}>
                {organizations.length > 1
                  ? "You’re the only owner. Your sign-in stays for your other businesses."
                  : "You’re the only owner, so your sign-in is deleted with it."}
              </Text>
            ) : (
              <>
                {/* A co-owner may leave and keep the business running. */}
                <Tappable
                  style={styles.cancel}
                  onPress={() => setOnlyMe(true)}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelText}>Delete only my account</Text>
                </Tappable>
                <Text style={styles.body}>Keeps the business for its other owner.</Text>
              </>
            )}
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
function PersonalDeletion({
  hasBusiness,
  businessName,
  onDeleteBusiness,
}: {
  hasBusiness: boolean;
  businessName: string;
  /** For an owner refused as the only one: back to deleting the business. */
  onDeleteBusiness: (() => void) | undefined;
}) {
  const { logout } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const check = useOutcomeCheck({
    onDone: () => void signedOut(),
    onNotDone: () => setError("Your account was not deleted. Nothing changed. Try again."),
    onExpired: setError,
  });

  async function signedOut() {
    // The login is gone server-side; clearing the local copy can't undo that.
    sayAfterDeletion(DELETED_SIGN_IN);
    await logout();
    router.replace("/login");
  }

  /** Is the login gone? A deleted one is refused (401) where it used to be read. */
  async function isGone(signal: AbortSignal): Promise<boolean> {
    try {
      await accountFetch("/api/v1/account/personal-deletion", { signal });
      return false;
    } catch (read) {
      if (read instanceof ApiError && read.status === 401) return true;
      throw read;
    }
  }

  async function remove() {
    if (busy || check.pending) return;
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
      setBusy(false);
      if (caught instanceof ApiError && caught.code === "owns_business") {
        setBlocked(caught.message);
      } else if (caught instanceof ApiError && caught.status < 500) {
        setError(caught.message);
      } else {
        // The answer was lost: ask the server, which refuses a deleted login,
        // rather than ask the person to sign in again to find out.
        check.start(isGone, {
          serverAnswered: caught instanceof ApiError && caught.status >= 500,
        });
      }
      return;
    }
    setBusy(false);
    await signedOut();
  }

  if (blocked) {
    // The server's "delete that business first, then delete your account"
    // was one step too many: deleting the business removes the sign-in too
    // when it is the last thing it belongs to. So the way out is offered.
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {businessName ? `You’re the only owner of ${businessName}.` : blocked}
        </Text>
        <Text style={styles.body}>
          Delete the business instead. Your sign-in goes with it when it’s your last.
        </Text>
        {onDeleteBusiness ? (
          <Button
            label="Delete the business instead"
            variant="secondary"
            onPress={onDeleteBusiness}
            style={styles.cardButton}
          />
        ) : null}
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
          editable={!busy && !check.pending}
          accessibilityLabel="Type delete to confirm deleting your account"
        />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <OutcomeCheckNotice check={check} />
      <Tappable
        style={[styles.destructive, busy || check.pending ? styles.disabled : null]}
        disabled={busy || check.pending}
        onPress={() => void remove()}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || check.pending, busy }}
      >
        {busy ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.destructiveText}>Delete my account</Text>
        )}
      </Tappable>

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
    gap: 8,
  },
  cardTitle: { ...type.headline, color: colors.ink },
  cardButton: { marginTop: 8 },
  warning: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    padding: 16,
    gap: 6,
  },
  warningTitle: { ...type.headline, color: colors.danger },
  warningBody: { ...type.callout, color: colors.ink },
  body: { ...type.callout, color: colors.inkMuted },
  label: { ...type.subhead, fontWeight: "600", color: colors.ink, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    ...type.body,
    color: colors.ink,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.control,
    padding: 12,
  },
  errorText: { ...type.callout, color: colors.danger },
  destructive: {
    backgroundColor: colors.danger,
    borderRadius: radii.control,
    padding: 16,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  destructiveText: { ...type.headline, color: colors.white },
  cancel: {
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: "center",
  },
  cancelText: { ...type.callout, color: colors.ink },
});
