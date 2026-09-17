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
  DONE_DWELL_MS,
  NFC_SCENE_COPY,
  sceneForWriteState,
} from "@/lib/nfc-scenes";
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

  const scene = sceneForWriteState(writeState);
  const sceneCopy = NFC_SCENE_COPY[scene];
  // The one place the existing contents are worth naming: the owner is about
  // to erase them.
  const sceneBody =
    scene === "conflict" && existingContentDesc
      ? `This Tag already has ${existingContentDesc} on it. Replacing it will erase what is there.`
      : scene === "unreadable" && writeError
        ? writeError
        : sceneCopy.body;

  // Success closes itself, the way the web sheet does.
  useEffect(() => {
    if (scene !== "done") return undefined;
    const timer = setTimeout(() => setWriteState("idle"), DONE_DWELL_MS);
    return () => clearTimeout(timer);
  }, [scene]);

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

        {/* Programming a Tag.
            One visible operation. The machine underneath still checks the chip,
            refuses an unreadable one, writes, verifies and records — but
            "Checking NFC and reading tag…", "Hold your phone to the NFC tag…"
            and "Verifying…" were three screens for something the owner
            experiences as holding a Tag against a phone until it says Done. */}
        {Platform.OS !== "web" && nfcSupported && canProvision && (
          <View style={styles.nfcStage}>
            {scene === "done" ? (
              <View style={styles.checkWrap}>
                <Text style={styles.check}>✓</Text>
              </View>
            ) : null}

            <Text style={styles.nfcTitle}>{sceneCopy.title}</Text>
            {sceneBody ? <Text style={styles.nfcBody}>{sceneBody}</Text> : null}

            {scene === "waiting" ? (
              <ActivityIndicator
                size="large"
                color={colors.brandText}
                style={{ marginTop: 20 }}
              />
            ) : null}

            {/* The success scene has no controls. It is finished, and it leaves
                on its own — a button there is one more decision after the work
                is done, and an invitation to program the same Tag twice. */}
            {scene !== "done" && sceneCopy.action ? (
              <Pressable
                style={[styles.nfcButton, { marginTop: 20 }]}
                disabled={!standUrl}
                onPress={() => {
                  if (scene === "conflict") void handleWriteNfc(true);
                  else if (scene === "partial") void retryServerRecord();
                  else void handleWriteNfc();
                }}
              >
                <Text style={styles.nfcButtonText}>{sceneCopy.action}</Text>
              </Pressable>
            ) : null}

            {scene !== "done" && sceneCopy.dismiss ? (
              <Pressable
                style={[styles.nfcButton, styles.cancelButton, { marginTop: 8 }]}
                onPress={() => {
                  if (scene === "waiting") {
                    cancelledRef.current = true;
                    cancelNfcRequest();
                  }
                  setWriteState("idle");
                }}
              >
                <Text style={[styles.nfcButtonText, { color: colors.danger }]}>
                  {sceneCopy.dismiss}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}

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
            <Pressable
              style={styles.nfcButton}
              onPress={() => void Linking.openURL(standUrl)}
            >
              <Text style={styles.nfcButtonText}>Open customer page</Text>
            </Pressable>
          </View>
        )}

        {/* Share the stand link — the same URL the QR and NFC tag carry */}
        {standUrl && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tag link</Text>
            <Text style={styles.sectionDesc}>
              The same link the QR code and the NFC chip both carry.
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
  // The programming stage. One centred column so nothing competes with the
  // Tag the owner is holding against the phone.
  nfcStage: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 36,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    gap: 6,
  },
  checkWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 6,
    borderColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  check: {
    fontSize: 52,
    lineHeight: 58,
    color: colors.success,
    fontWeight: "700",
  },
  nfcTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
  },
  nfcBody: {
    fontSize: 15,
    color: colors.inkMuted,
    textAlign: "center",
    maxWidth: 280,
    marginTop: 4,
  },
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
