import { useCallback } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Button } from "@/components/button";
import { Group, Row } from "@/components/group";
import { Icon } from "@/components/icon";
import { TabScreen } from "@/components/screen";
import { useAuth, useBusinessTimeZone } from "@/data/auth-context";
import { useStands } from "@/data/use-stands";
import { lastUsedLabel, tagChecks } from "@/lib/words";
import { colors, radii, type } from "@/theme";
import type { StandItem } from "@/data/types";

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

  useFocusEffect(
    useCallback(() => {
      if (orgId) void refresh();
    }, [orgId, refresh]),
  );

  return (
    <TabScreen
      title="Tags"
      subtitle="Your Tags and the customer page they open."
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      {error && stands.length === 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{error}</Text>
          <Button label="Try again" variant="secondary" onPress={() => void refresh()} />
        </View>
      ) : loading && stands.length === 0 ? (
        <ActivityIndicator style={styles.spinner} color={colors.inkMuted} />
      ) : stands.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No Tags yet</Text>
          <Text style={styles.emptyBody}>Create your first Tag on the website. It shows up here to program and share.</Text>
        </View>
      ) : (
        <Group title="Your Tags">
          {stands.map((stand) => (
            <TagRow key={stand.standId} stand={stand} />
          ))}
        </Group>
      )}
    </TabScreen>
  );
}

function TagRow({ stand }: { stand: StandItem }) {
  const checks = tagChecks(stand);
  const live = stand.status === "active";
  const place = stand.locationName ?? "Place";
  const used = lastUsedLabel(stand.lastOpenedAt, useBusinessTimeZone());
  const state = live ? null : stand.status === "paused" ? "Paused" : "Retired";
  return (
    <Row
      onPress={() => router.push(`/stand/${stand.standId}`)}
      accessibilityLabel={[stand.label, place, used, state, checks.qr.label, checks.nfc.label].filter(Boolean).join(". ")}
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
          {live ? (
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
  spinner: { marginTop: 32 },
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
  checkText: { ...type.subhead, color: colors.inkMuted },
  checkTodo: { color: colors.ink, fontWeight: "500" },
});
