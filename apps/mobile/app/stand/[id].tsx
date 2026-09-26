import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { Tappable } from "@/components/tappable";
import { useAuth } from "@/data/auth-context";
import { apiFetch } from "@/data/api";
import { colors, radii, fonts } from "@/theme";
import { NfcProgramSheet } from "@/components/nfc-program-sheet";
import {
  DONE_DWELL_MS,
  failureCopy,
  HOLD_HINT,
  NFC_SCENE_COPY,
  sceneForWriteState,
  tagDetected,
  writingCopy,
  type NfcFailure,
  type NfcPlatform,
  type SceneCopy,
  type WriteState,
} from "@/lib/nfc-scenes";
import {
  cancelNfcRequest,
  initNfc,
  isNfcEnabled,
  isNfcSupported,
  programTag,
} from "@/lib/nfc";

const PLATFORM: NfcPlatform = Platform.OS === "ios" ? "ios" : "android";

export default function StandDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId;
  const role = activeOrg?.role;

  const canProvision = role === "owner" || role === "admin";

  const [standUrl, setStandUrl] = useState<string | null>(null);
  const [standLabel, setStandLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [writeState, setWriteState] = useState<WriteState>("idle");
  const [failure, setFailure] = useState<NfcFailure | null>(null);
  const [conflict, setConflict] = useState<{ description: string; tagId: string | null } | null>(
    null,
  );
  /**
   * Which run is current. Every await checks it, so a run the owner cancelled
   * — or one a newer run replaced — can never move the screen, or reach the
   * write, after the fact.
   */
  const runRef = useRef(0);

  useEffect(() => {
    if (!orgId || !id) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ data: { standUrl: string; label: string } }>(
          `/api/v1/review-stands/${id}/qr?format=json`,
          orgId,
        );
        setStandUrl(res.data.standUrl);
        setStandLabel(res.data.label);
      } catch {
        setError("Could not load this Tag. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, id]);

  useEffect(() => {
    if (Platform.OS === "web") {
      setNfcSupported(false);
      return;
    }
    (async () => {
      const supported = await isNfcSupported();
      setNfcSupported(supported);
      if (supported) {
        await initNfc();
      }
    })();
  }, []);

  /**
   * Tell ReviewBoost the Tag is programmed. Separate from the write, so a
   * failure here is retried on its own: the chip is already correct, and
   * retrying must never mean writing to it again.
   */
  const recordWithServer = useCallback(
    async (run: number) => {
      if (!orgId || !id) return;
      setWriteState("verifying");
      try {
        await apiFetch(`/api/v1/review-stands/${id}/nfc-provision`, orgId, {
          method: "POST",
          body: "{}",
        });
        if (run !== runRef.current) return;
        setWriteState("success");
      } catch {
        if (run !== runRef.current) return;
        setWriteState("partial");
      }
    },
    [orgId, id],
  );

  const retryServerRecord = useCallback(() => {
    const run = ++runRef.current;
    void recordWithServer(run);
  }, [recordWithServer]);

  /**
   * One press, one operation: read, decide, write, read back, record. The
   * owner sees Writing throughout; only a Tag that already carries something
   * stops to ask, and `replace` is how their answer comes back in.
   */
  const program = useCallback(
    async (replace: { tagId: string | null; description: string } | null) => {
      if (!standUrl || !canProvision) return;
      const run = ++runRef.current;
      const stale = () => run !== runRef.current;

      setFailure(null);
      setWriteState("checking");

      if (!(await isNfcSupported())) {
        if (stale()) return;
        setFailure("unsupported");
        setWriteState("error");
        return;
      }
      if (!(await isNfcEnabled())) {
        if (stale()) return;
        setFailure("nfc-off");
        setWriteState("error");
        return;
      }
      if (stale()) return;

      const outcome = await programTag(standUrl, {
        platform: PLATFORM,
        alertMessage: HOLD_HINT[PLATFORM],
        replace,
        onDetected: () => {
          if (!stale()) setWriteState("writing");
        },
      });
      if (stale()) return;

      switch (outcome.kind) {
        case "cancelled":
          // The owner closed the iPhone's own sheet: back to Ready, not an error.
          setWriteState("idle");
          return;
        case "conflict":
          setConflict({ description: outcome.description, tagId: outcome.tagId });
          setWriteState("confirm-overwrite");
          return;
        case "failed":
          setFailure(outcome.failure);
          setWriteState("error");
          return;
        case "already":
        case "written":
          // Past this point the chip is correct whatever happens next.
          await recordWithServer(run);
          return;
      }
    },
    [standUrl, canProvision, recordWithServer],
  );

  const closeSheet = useCallback(() => {
    runRef.current += 1;
    void cancelNfcRequest();
    setSheetOpen(false);
    setWriteState("idle");
    setFailure(null);
    setConflict(null);
  }, []);

  useEffect(() => {
    return () => {
      runRef.current += 1;
      void cancelNfcRequest();
    };
  }, []);

  const scene = sceneForWriteState(writeState);
  const sceneCopy: SceneCopy =
    scene === "writing"
      ? writingCopy(tagDetected(writeState), PLATFORM)
      : scene === "error"
        ? failureCopy(failure)
        : scene === "conflict" && conflict
          ? // The one place the existing contents are worth naming: the owner
            // is about to erase them.
            {
              ...NFC_SCENE_COPY.conflict,
              body: `This Tag already has ${conflict.description} on it. Replacing it will erase what is there.`,
            }
          : NFC_SCENE_COPY[scene];

  const onPrimary = useCallback(() => {
    if (scene === "conflict") void program(conflict);
    else if (scene === "partial") retryServerRecord();
    else void program(null);
  }, [conflict, program, retryServerRecord, scene]);

  // Success closes itself, the way the web sheet does, back to Tag detail.
  useEffect(() => {
    if (scene !== "success") return undefined;
    const timer = setTimeout(closeSheet, DONE_DWELL_MS);
    return () => clearTimeout(timer);
  }, [scene, closeSheet]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <Stack.Screen options={{ title: "Tag" }} />
        <ActivityIndicator size="large" color={colors.brandText} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen options={{ title: standLabel || "Tag" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Programming a Tag. The button only opens the sheet: scanning
            starts when the owner presses Program NFC inside it, holding the
            Tag, and not a moment before. */}
        {Platform.OS !== "web" && nfcSupported && canProvision && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>NFC</Text>
            <Text style={styles.sectionDesc}>
              Program the chip so customers can tap the Tag instead of scanning it.
            </Text>
            <Tappable
              accessibilityRole="button"
              style={styles.nfcButton}
              disabled={!standUrl}
              onPress={() => setSheetOpen(true)}
            >
              <Text style={styles.nfcButtonText}>Program NFC</Text>
            </Tappable>
          </View>
        )}

        <NfcProgramSheet
          visible={sheetOpen}
          scene={scene}
          copy={sceneCopy}
          onPrimary={onPrimary}
          onDismiss={closeSheet}
        />

        {Platform.OS !== "web" && nfcSupported === false && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>This phone cannot program Tags</Text>
            {/* The QR code on the same Tag works without any of this, which is
                the useful thing to say — not a list of third-party tools. */}
            <Text style={styles.sectionDesc}>
              The QR code on this Tag still works. To add NFC, program it from a
              phone that supports it.
            </Text>
          </View>
        )}

        {!canProvision && (
          <View style={styles.section}>
            <Text style={styles.sectionDesc}>
              Only owners and admins can program Tags. Ask the account owner for
              access.
            </Text>
          </View>
        )}

        {/* Test Stand */}
        {standUrl && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Preview customer page</Text>
            <Text style={styles.sectionDesc}>
              See exactly what a customer sees when they tap or scan this Tag.
            </Text>
            <Tappable
              style={styles.nfcButton}
              onPress={() => void Linking.openURL(standUrl)}
              accessibilityRole="link"
              accessibilityHint="Opens in your browser"
            >
              <Text style={styles.nfcButtonText}>Open customer page</Text>
            </Tappable>
          </View>
        )}

        {/* Share the stand link — the same URL the QR and NFC tag carry */}
        {standUrl && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tag link</Text>
            <Text style={styles.sectionDesc}>
              The same link the QR code and the NFC chip both carry.
            </Text>
            <Tappable
              style={styles.nfcButton}
              accessibilityRole="button"
              onPress={() => {
                Share.share(
                  Platform.OS === "ios"
                    ? { url: standUrl }
                    : { message: standUrl },
                ).catch(() => {
                  // react-native-web rejects when the browser has no Web
                  // Share API, and users can dismiss the native sheet — a
                  // no-op is the right outcome, not an unhandled rejection.
                });
              }}
            >
              <Text style={styles.nfcButtonText}>Share Link</Text>
            </Tappable>
          </View>
        )}

        {/* A six-step tutorial for a third-party app used to sit here, on every
            Tag screen, unconditionally. Programming happens above; a phone that
            cannot do it is told so, and the QR code on the same Tag works
            regardless. Sending an owner to another app to hand-enter a URL is
            not a feature of this product. */}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.canvas,
  },
  content: { padding: 16, gap: 16 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 17,
    color: colors.ink,
    marginBottom: 6,
    ...fonts.subheading,
  },
  sectionDesc: {
    fontSize: 14,
    color: colors.inkMuted,
    lineHeight: 20,
    marginBottom: 12,
  },
  nfcButton: {
    backgroundColor: colors.brand,
    borderRadius: radii.control,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  nfcButtonText: {
    color: colors.onBrand,
    fontSize: 16,
    ...fonts.subheading,
  },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.control,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
});
