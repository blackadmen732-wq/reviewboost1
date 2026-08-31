import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useAuth } from "@/data/auth-context";
import { apiFetch, ApiError } from "@/data/api";
import { colors, radii, fonts } from "@/theme";
import {
  isNfcSupported,
  isNfcEnabled,
  initNfc,
  writeNfcTag,
  cancelNfcRequest,
  type NfcWriteResult,
} from "@/lib/nfc";

type WriteState = "idle" | "checking" | "ready" | "writing" | "verifying" | "success" | "error";

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
  const [nfcEnabled, setNfcEnabled] = useState(false);
  const [writeState, setWriteState] = useState<WriteState>("idle");
  const [writeResult, setWriteResult] = useState<NfcWriteResult | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !id) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ data: { token: string; standUrl: string; label: string } }>(
          `/api/v1/review-stands/${id}/qr`,
          orgId,
          { headers: { Accept: "application/json" } },
        );
        setStandUrl(res.data.standUrl);
        setStandLabel(res.data.label);
      } catch (e) {
        // QR endpoint returns SVG, not JSON with the URL.
        // Instead, use the stands list to get info and construct the URL
        // from the token endpoint. For v1 we just show a helpful message.
        setError("Stand URL could not be loaded. Use the web dashboard for NFC provisioning.");
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
        const enabled = await isNfcEnabled();
        setNfcEnabled(enabled);
      }
    })();
  }, []);

  const handleWriteNfc = useCallback(async () => {
    if (!standUrl || !canProvision) return;

    setWriteState("checking");
    setWriteError(null);
    setWriteResult(null);

    const supported = await isNfcSupported();
    if (!supported) {
      setWriteState("error");
      setWriteError("NFC is not supported on this device.");
      return;
    }

    const enabled = await isNfcEnabled();
    if (!enabled) {
      setWriteState("error");
      setWriteError("NFC is turned off. Enable it in Settings.");
      return;
    }

    setWriteState("writing");

    const result = await writeNfcTag(standUrl);
    setWriteResult(result);

    if (!result.success) {
      setWriteState("error");
      setWriteError(result.error ?? "NFC write failed.");
      return;
    }

    if (!result.verified) {
      setWriteState("error");
      setWriteError(
        "Tag was written but read-back verification failed. Please tap the tag with your phone to confirm it works.",
      );
      return;
    }

    // Record provisioning on the server
    if (orgId) {
      try {
        await apiFetch(`/api/v1/review-stands/${id}/nfc-provision`, orgId, {
          method: "POST",
          body: JSON.stringify({ nfcUid: result.tagUid }),
        });
      } catch {
        // Non-fatal: the tag is written, just the server record failed
      }
    }

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
        <Stack.Screen options={{ title: "Stand" }} />
        <ActivityIndicator size="large" color={colors.brandText} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen options={{ title: standLabel || "Stand" }} />
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
              Hold an NFC tag to the back of your phone to write this stand&apos;s URL.
              Use NTAG213, NTAG215, or NTAG216 tags.
            </Text>

            {writeState === "idle" && (
              <Pressable
                style={styles.nfcButton}
                onPress={handleWriteNfc}
                disabled={!standUrl}
              >
                <Text style={styles.nfcButtonText}>Write to NFC Tag</Text>
              </Pressable>
            )}

            {writeState === "checking" && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={colors.brandText} />
                <Text style={styles.statusText}>Checking NFC...</Text>
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

            {writeState === "success" && writeResult && (
              <View style={[styles.resultBanner, { backgroundColor: colors.successBg }]}>
                <Text style={[styles.resultText, { color: colors.success }]}>
                  NFC tag written and verified successfully
                  {writeResult.tagUid ? ` (UID: ${writeResult.tagUid})` : ""}
                </Text>
              </View>
            )}

            {writeState === "error" && (
              <View style={[styles.resultBanner, { backgroundColor: colors.dangerBg }]}>
                <Text style={[styles.resultText, { color: colors.danger }]}>
                  {writeError}
                </Text>
                <Pressable
                  style={[styles.nfcButton, { marginTop: 12 }]}
                  onPress={handleWriteNfc}
                >
                  <Text style={styles.nfcButtonText}>Try Again</Text>
                </Pressable>
              </View>
            )}

            {writeState !== "idle" && writeState !== "error" && writeState !== "success" && (
              <Pressable
                style={[styles.nfcButton, styles.cancelButton]}
                onPress={() => {
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
            <Text style={styles.step}>4. Paste the stand URL from the web dashboard</Text>
            <Text style={styles.step}>5. Tap Write and hold your phone to the tag</Text>
            <Text style={styles.step}>6. Verify: tap the tag to confirm it opens the correct page</Text>
          </View>
          <Text style={[styles.sectionDesc, { marginTop: 8, fontStyle: "italic" }]}>
            Do not permanently write-lock tags. If the code is rotated, the tag must be rewritten.
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
