import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Platform,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { isReviewBoostTagUrl } from "@/lib/tag-url";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { stackHeader } from "@/components/screen";
import { useAuth } from "@/data/auth-context";
import { apiFetch, authorizedImage } from "@/data/api";
import { useStands } from "@/data/use-stands";
import { lastUsedLabel, tagChecks, tagNeedsRewrite } from "@/lib/words";
import { card, colors, radii, space, type } from "@/theme";
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
  const [loading, setLoading] = useState(canProvision);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  // The list row for this Tag: its place, when it was last used, and whether
  // the printed code and the chip are current.
  const { stands, refresh: refreshStands } = useStands(orgId);
  const stand = stands.find((item) => item.standId === id) ?? null;

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
    void refreshStands();
  }, [refreshStands]);

  useEffect(() => {
    // The link and the code are owner/admin at the API; anyone else sees the
    // Tag's state and is told who can print or program it.
    if (!orgId || !id || !canProvision) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<{ data: { standUrl: string; label: string } }>(
          `/api/v1/review-stands/${id}/qr?format=json`,
          orgId,
        );
        // Only a plain ReviewBoost /q/ link is ever written to a chip; anything
        // else fails closed as a load error rather than being programmed.
        if (!isReviewBoostTagUrl(res.data.standUrl)) throw new Error("not a Tag URL");
        setStandUrl(res.data.standUrl);
        setStandLabel(res.data.label);
        setCode(await authorizedImage(`/api/v1/review-stands/${id}/qr?format=png&size=600`, orgId).catch(() => null));
      } catch {
        setError("Could not load this Tag. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, id, canProvision]);

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
        void refreshStands();
      } catch {
        if (run !== runRef.current) return;
        setWriteState("partial");
      }
    },
    [orgId, id, refreshStands],
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

  const title = standLabel || stand?.label || "Tag";
  const checks = stand ? tagChecks(stand) : null;
  const nfcLine = !stand
    ? null
    : tagNeedsRewrite(stand)
      ? "The code changed, so the chip still has the old link. Program it again."
      : stand.nfcProvisionedAt === null
        ? "Not programmed yet. Write your link to the Tag’s chip and a phone tap opens your page."
        : "Programmed. A phone tap opens your customer page.";

  if (loading && !stand) {
    return (
      <SafeAreaView style={styles.center}>
        <Stack.Screen options={stackHeader("")} />
        <ActivityIndicator size="large" color={colors.inkMuted} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {/* The large title below names the Tag; the bar only carries Back. */}
      <Stack.Screen options={stackHeader("")} />
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {stand ? (
            <Text style={styles.meta}>
              {[stand.locationName ?? "Place", checks?.nfc.ok ? null : "NFC not programmed", lastUsedLabel(stand.lastOpenedAt)]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* The printed code: the same link the chip carries. */}
        {canProvision && standUrl ? (
          <View style={styles.section}>
            {code ? (
              <Image
                source={{ uri: code }}
                style={styles.code}
                resizeMode="contain"
                accessible
                accessibilityLabel={`QR code for ${title}`}
              />
            ) : null}
            {checks && !checks.qr.ok ? (
              <Text style={styles.sectionDesc}>The code changed. Print it again: the old printout opens nothing.</Text>
            ) : null}
            <Button
              label="Preview customer page"
              variant="secondary"
              onPress={() => void Linking.openURL(standUrl)}
              accessibilityHint="Opens in your browser"
            />
            <Button
              label="Share link"
              variant="secondary"
              icon={<Icon name="square.and.arrow.up" glyph="⇪" size={17} color={colors.ink} />}
              onPress={() => {
                Share.share(Platform.OS === "ios" ? { url: standUrl } : { message: standUrl }).catch(() => {
                  // react-native-web rejects when the browser has no Web
                  // Share API, and users can dismiss the native sheet — a
                  // no-op is the right outcome, not an unhandled rejection.
                });
              }}
            />
          </View>
        ) : null}

        {/* Programming a Tag. The button only opens the sheet: scanning
            starts when the owner presses Program NFC inside it, holding the
            Tag, and not a moment before. */}
        {canProvision ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>NFC</Text>
            {nfcLine ? <Text style={styles.sectionDesc}>{nfcLine}</Text> : null}
            {Platform.OS !== "web" && nfcSupported ? (
              <Button
                label={stand && stand.nfcProvisionedAt !== null && !tagNeedsRewrite(stand) ? "Program again" : "Program NFC"}
                variant={checks && !checks.nfc.ok ? "action" : "secondary"}
                disabled={!standUrl}
                onPress={() => setSheetOpen(true)}
                icon={
                  <Icon
                    name="wave.3.right"
                    glyph="◎"
                    size={17}
                    color={checks && !checks.nfc.ok ? colors.onAction : colors.ink}
                  />
                }
              />
            ) : nfcSupported === null && Platform.OS !== "web" ? null : (
              // The QR code on the same Tag works without any of this, which is
              // the useful thing to say — not a list of third-party tools.
              <Text style={styles.sectionDesc}>
                This phone can’t program Tags. The QR code still works; to add NFC, program it from an iPhone or an
                Android phone with NFC.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionDesc}>
              Only owners and admins can print or program Tags. Ask the account owner for access.
            </Text>
          </View>
        )}

        <NfcProgramSheet
          visible={sheetOpen}
          scene={scene}
          copy={sceneCopy}
          onPrimary={onPrimary}
          onDismiss={closeSheet}
        />

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
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.canvas },
  content: { padding: space.gutter, gap: 20, paddingBottom: 48 },
  title: { ...type.title, color: colors.ink },
  meta: { ...type.callout, color: colors.inkMuted, marginTop: 6 },
  section: { ...card, padding: 16, gap: 12 },
  code: { width: "100%", aspectRatio: 1, maxWidth: 280, alignSelf: "center" },
  sectionTitle: { ...type.headline, color: colors.ink },
  sectionDesc: { ...type.subhead, color: colors.inkMuted },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.control,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: { color: colors.danger, fontSize: 14 },
});
