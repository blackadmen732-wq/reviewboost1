import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Platform,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { useAuth } from "@/data/auth-context";
import { apiFetch } from "@/data/api";
import { colors, radii, fonts } from "@/theme";
import {
  isNfcSupported,
  isNfcEnabled,
  initNfc,
  readExistingNfcContent,
  writeNfcTag,
  cancelNfcRequest,
} from "@/lib/nfc";

type WriteState = "idle" | "checking" | "confirm-overwrite" | "writing" | "verifying" | "success" | "partial" | "error";

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
  const [writeState, setWriteState] = useState<WriteState>("idle");
  const [writeError, setWriteError] = useState<string | null>(null);
  const [existingContentDesc, setExistingContentDesc] = useState<string | null>(null);
  const cancelledRef = useRef(false);

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
        setError("Could not load tag details. Please try again.");
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

  const retryServerRecord = useCallback(async () => {
    if (!orgId || !id) return;
    setWriteState("verifying");
    try {
      await apiFetch(`/api/v1/review-stands/${id}/nfc-provision`, orgId, {
        method: "POST",
        body: "{}",
      });
      if (cancelledRef.current) return;
      setWriteState("success");
    } catch {
      if (cancelledRef.current) return;
      setWriteState("partial");
    }
  }, [orgId, id]);

  const handleWriteNfc = useCallback(async (skipContentCheck = false) => {
    if (!standUrl || !canProvision) return;

    cancelledRef.current = false;
    setWriteState("checking");
    setWriteError(null);
    setExistingContentDesc(null);

    const supported = await isNfcSupported();
    if (cancelledRef.current) return;
    if (!supported) {
      setWriteState("error");
      setWriteError("NFC is not supported on this device.");
      return;
    }

    const enabled = await isNfcEnabled();
    if (cancelledRef.current) return;
    if (!enabled) {
      setWriteState("error");
      setWriteError("NFC is turned off. Enable it in Settings.");
      return;
    }

    // Check existing content before writing
    if (!skipContentCheck) {
      try {
        const existing = await readExistingNfcContent(standUrl);
        if (cancelledRef.current) return;

        if (existing.existingContent === "same-url") {
          if (orgId) {
            try {
              await apiFetch(`/api/v1/review-stands/${id}/nfc-provision`, orgId, {
                method: "POST",
                body: "{}",
              });
            } catch {
              if (cancelledRef.current) return;
              setWriteState("partial");
              return;
            }
          }
          if (cancelledRef.current) return;
          setWriteState("success");
          return;
        }

        if (existing.existingContent === "different") {
          setExistingContentDesc(existing.description ?? "Unknown content");
          setWriteState("confirm-overwrite");
          return;
        }
      } catch {
        if (cancelledRef.current) return;
        setWriteState("error");
        setWriteError(
          "ReviewBoost couldn't safely read this tag. Try again or use a blank NFC tag.",
        );
        return;
      }
    }

    setWriteState("writing");

    const result = await writeNfcTag(standUrl);
    if (cancelledRef.current) return;

    if (!result.success) {
      setWriteState("error");
      setWriteError(result.error ?? "NFC write failed.");
      return;
    }

    if (!result.verified) {
      setWriteState("error");
      setWriteError(
        "Tag was written but verification could not confirm the contents. Please tap the tag with your phone to check it works, then try again.",
      );
      return;
    }

    // Record provisioning on the server
    if (orgId) {
      try {
        await apiFetch(`/api/v1/review-stands/${id}/nfc-provision`, orgId, {
          method: "POST",
          body: "{}",
        });
      } catch {
        if (cancelledRef.current) return;
        setWriteState("partial");
        return;
      }
    }

    if (cancelledRef.current) return;
    setWriteState("success");
  }, [standUrl, canProvision, orgId, id]);

  useEffect(() => {
    return () => {
      cancelNfcRequest();
    };
  }, []);

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

        {/* NFC Write Section */}
        {Platform.OS !== "web" && nfcSupported && canProvision && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Write NFC Tag</Text>
            <Text style={styles.sectionDesc}>
              Hold an NFC tag to the back of your phone to write this tag&apos;s URL.
              Use NTAG213 or NTAG215 tags.
            </Text>

            {writeState === "idle" && (
              <Pressable
                style={styles.nfcButton}
                onPress={() => void handleWriteNfc()}
                disabled={!standUrl}
              >
                <Text style={styles.nfcButtonText}>Write to NFC Tag</Text>
              </Pressable>
            )}

            {writeState === "checking" && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={colors.brandText} />
                <Text style={styles.statusText}>Checking NFC and reading tag...</Text>
              </View>
            )}

            {writeState === "confirm-overwrite" && (
              <View style={[styles.resultBanner, { backgroundColor: colors.infoBg }]}>
                <Text style={[styles.resultText, { color: colors.info }]}>
                  This tag already has content ({existingContentDesc}). Writing will replace it.
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <Pressable
                    style={[styles.nfcButton, { flex: 1 }]}
                    onPress={() => void handleWriteNfc(true)}
                  >
                    <Text style={styles.nfcButtonText}>Overwrite</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.nfcButton, styles.cancelButton, { flex: 1 }]}
                    onPress={() => setWriteState("idle")}
                  >
                    <Text style={[styles.nfcButtonText, { color: colors.danger }]}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {writeState === "writing" && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={colors.brandText} />
                <Text style={styles.statusText}>
                  Hold your phone to the NFC tag...
                </Text>
              </View>
            )}

            {writeState === "verifying" && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={colors.brandText} />
                <Text style={styles.statusText}>Verifying...</Text>
              </View>
            )}

            {writeState === "success" && (
              <View style={[styles.resultBanner, { backgroundColor: colors.successBg }]}>
                <Text style={[styles.resultText, { color: colors.success }]}>
                  NFC tag written and verified successfully
                </Text>
              </View>
            )}

            {writeState === "partial" && (
              <View style={[styles.resultBanner, { backgroundColor: colors.infoBg }]}>
                <Text style={[styles.resultText, { color: colors.info }]}>
                  Your NFC tag works, but ReviewBoost couldn&apos;t save its setup status.
                </Text>
                <Pressable
                  style={[styles.nfcButton, { marginTop: 12 }]}
                  onPress={() => void retryServerRecord()}
                >
                  <Text style={styles.nfcButtonText}>Retry saving status</Text>
                </Pressable>
              </View>
            )}

            {writeState === "error" && (
              <View style={[styles.resultBanner, { backgroundColor: colors.dangerBg }]}>
                <Text style={[styles.resultText, { color: colors.danger }]}>
                  {writeError}
                </Text>
                <Pressable
                  style={[styles.nfcButton, { marginTop: 12 }]}
                  onPress={() => void handleWriteNfc()}
                >
                  <Text style={styles.nfcButtonText}>Try Again</Text>
                </Pressable>
              </View>
            )}

            {(writeState === "checking" || writeState === "writing") && (
              <Pressable
                style={[styles.nfcButton, styles.cancelButton]}
                onPress={() => {
                  cancelledRef.current = true;
                  cancelNfcRequest();
                  setWriteState("idle");
                }}
              >
                <Text style={[styles.nfcButtonText, { color: colors.danger }]}>Cancel</Text>
              </Pressable>
            )}
          </View>
        )}

        {Platform.OS !== "web" && nfcSupported === false && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>NFC Not Available</Text>
            <Text style={styles.sectionDesc}>
              This device does not support NFC. Use the NFC Tools app on a
              compatible phone, or write tags from the web dashboard on Android
              Chrome.
            </Text>
          </View>
        )}

        {!canProvision && (
          <View style={styles.section}>
            <Text style={styles.sectionDesc}>
              Only owners and admins can write NFC tags. Ask your organization
              owner for access.
            </Text>
          </View>
        )}

        {/* Test tag */}
        {standUrl && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Test this tag</Text>
            <Text style={styles.sectionDesc}>
              Open the live customer page to verify this tag works correctly.
            </Text>
            <Pressable
              style={styles.nfcButton}
              onPress={() => void Linking.openURL(standUrl)}
            >
              <Text style={styles.nfcButtonText}>Open tag page</Text>
            </Pressable>
          </View>
        )}

        {/* Share the stand link — the same URL the QR and NFC tag carry */}
        {standUrl && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Copy NFC Link</Text>
            <Text style={styles.sectionDesc}>
              Share or copy this tag&apos;s link. It is the same link the QR code
              and NFC tag use.
            </Text>
            <Pressable
              style={styles.nfcButton}
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
            </Pressable>
          </View>
        )}

        {/* NFC Tools fallback */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alternative: NFC Tools App</Text>
          <Text style={styles.sectionDesc}>
            If native NFC write is not available, use the free NFC Tools app:
          </Text>
          <View style={styles.steps}>
            <Text style={styles.step}>1. Install NFC Tools from App Store or Play Store</Text>
            <Text style={styles.step}>2. Open the app → tap Write</Text>
            <Text style={styles.step}>3. Add a record → URL / URI</Text>
            <Text style={styles.step}>4. Copy the tag link from the web dashboard and paste it</Text>
            <Text style={styles.step}>5. Tap Write and hold your phone to the tag</Text>
            <Text style={styles.step}>6. Verify: tap the tag to confirm it opens the correct page</Text>
          </View>
          <Text style={[styles.sectionDesc, { marginTop: 8, fontStyle: "italic" }]}>
            Do not permanently write-lock tags. If the tag is rotated, the NFC tag must be rewritten.
          </Text>
        </View>
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
  cancelButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    marginTop: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  statusText: {
    fontSize: 15,
    color: colors.ink,
  },
  resultBanner: {
    borderRadius: radii.control,
    padding: 12,
  },
  resultText: {
    fontSize: 14,
    ...fonts.label,
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
  steps: {
    gap: 6,
  },
  step: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
  },
});
