import { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Group, Row } from "@/components/group";
import { Icon } from "@/components/icon";
import { LoadingBlock } from "@/components/loading-block";
import { TabScreen } from "@/components/screen";
import { useAuth, useBusinessTimeZone } from "@/data/auth-context";
import { useBilling, type BillingState } from "@/data/use-billing";
import { useStands } from "@/data/use-stands";
import { lastUsedLabel, scansOffFor, scansOffLabel, tagChecks } from "@/lib/words";
import { colors, radii, type } from "@/theme";
import type { StandItem } from "@/data/types";
import { RetryBlock } from "@/components/retry-block";

/**
 * Why every Tag of this business is off, as a fact, from the plan the app
 * already reads. No pointer to where a plan is chosen (App Store 3.1.3(f)).
 */
function plansOffLine(billing: BillingState | null): string | null {
  if (!billing) return null;
  if (billing.status === "suspended") {
    return billing.planId === null
      ? "Your Tags are off. This business has no plan yet."
      : "Your Tags are off. The plan isn’t active.";
  }
  if (billing.status === "cancelled") return "Your Tags are off. The plan is cancelled.";
  return null;
}

/**
 * Tags: the things on the counter. Each row leads with a small dark tile that
 * stands in for the Tag itself and says the two things an owner checks on
 * one, as the website's Tags list does: does the printed code still work, and
 * is the chip programmed. They are shown apart because they fail apart.
 */
export default function StandsScreen() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId;
  const { stands, loading, refreshing, error, refresh } = useStands(orgId);
  // The plan, for the one thing it changes here: whether any scan works.
  const { billing, refresh: refreshBilling } = useBilling(orgId);
  const plansOff = plansOffLine(billing);

  useFocusEffect(
    useCallback(() => {
      if (orgId) {
        void refresh();
        void refreshBilling();
      }
    }, [orgId, refresh, refreshBilling]),
  );

  return (
    <TabScreen
      title="Tags"
      subtitle="Your Tags and the customer page they open."
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      {error && stands.length === 0 ? (
        <RetryBlock message={error} retryKey="stands" onRetry={() => void refresh()} />
      ) : loading && stands.length === 0 ? (
        <LoadingBlock label="Loading your Tags…" />
      ) : stands.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No Tags yet</Text>
          <Text style={styles.emptyBody}>Create your first Tag on the website. It shows up here to program and share.</Text>
        </View>
      ) : (
        <View style={styles.listArea}>
          {/* A refresh that failed keeps the Tags that were here, and says so
              above them, trying again by itself. */}
          {error ? <RetryBlock compact message={error} retryKey="stands-stale" onRetry={() => void refresh()} /> : null}
          {plansOff ? (
            <View style={styles.offNotice}>
              <View style={[styles.dot, styles.dotNeeds]} />
              <Text style={styles.offText}>{plansOff}</Text>
            </View>
          ) : null}
          <Group title="Your Tags">
            {stands.map((stand) => (
              <TagRow key={stand.standId} stand={stand} billing={billing} />
            ))}
          </Group>
        </View>
      )}
    </TabScreen>
  );
}

function TagRow({ stand, billing }: { stand: StandItem; billing: BillingState | null }) {
  const checks = tagChecks(stand);
  const live = stand.status === "active";
  const place = stand.locationName ?? "Place";
  const used = lastUsedLabel(stand.lastOpenedAt, useBusinessTimeZone());
  const state = live ? null : stand.status === "paused" ? "Paused" : "Retired";
  // A Tag nobody can use says why, in place of a green "QR ready".
  const off = live ? scansOffFor(stand, billing) : null;
  const statusWords = off ? [scansOffLabel(off)] : [checks.qr.label, checks.nfc.label];
  return (
    <Row
      onPress={() => router.push(`/stand/${stand.standId}`)}
      accessibilityLabel={[stand.label, place, used, state, ...(live ? statusWords : [])].filter(Boolean).join(". ")}
      accessibilityHint="Opens this Tag"
    >
      <View style={styles.row}>
        <View style={[styles.tile, live ? null : styles.tileOff]}>
          <Icon name="qrcode" glyph="▦" size={24} color={colors.canvas} />
        </View>
        <View style={styles.text}>
          <Text style={styles.label} numberOfLines={1}>
            {stand.label}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {place} · {state ?? used}
          </Text>
          {live && off ? (
            <View style={styles.checks}>
              <Check ok={false} label={scansOffLabel(off)} />
            </View>
          ) : live ? (
            <View style={styles.checks}>
              <Check ok={checks.qr.ok} label={checks.qr.label} />
              <Check ok={checks.nfc.ok} label={checks.nfc.label} />
            </View>
          ) : null}
        </View>
      </View>
    </Row>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={styles.check}>
      <View style={[styles.dot, { backgroundColor: ok ? colors.brand : colors.starFilled }]} />
      <Text style={[styles.checkText, ok ? null : styles.checkTodo]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { gap: 16 },
  noticeText: { ...type.callout, color: colors.ink },
  empty: { gap: 6, paddingVertical: 24 },
  emptyTitle: { ...type.headline, color: colors.ink },
  emptyBody: { ...type.callout, color: colors.inkMuted },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  tile: {
    width: 48,
    height: 48,
    borderRadius: radii.control,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  tileOff: { backgroundColor: colors.borderLight },
  text: { flex: 1, minWidth: 0 },
  label: { ...type.headline, color: colors.ink },
  meta: { ...type.subhead, color: colors.inkMuted, marginTop: 2 },
  checks: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4, marginTop: 6 },
  check: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotNeeds: { backgroundColor: colors.starFilled },
  listArea: { gap: 16 },
  offNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  offText: { ...type.callout, color: colors.ink, flex: 1 },
  checkText: { ...type.subhead, color: colors.inkMuted },
  checkTodo: { color: colors.ink, fontWeight: "500" },
});
