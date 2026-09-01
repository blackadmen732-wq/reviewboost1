import { useCallback, useMemo } from "react";
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, router } from "expo-router";
import { useAuth } from "@/data/auth-context";
import { useStands } from "@/data/use-stands";
import { relativeTime } from "@/components/relative-time";
import { colors, radii, fonts } from "@/theme";
import type { StandItem } from "@/data/types";

function StandStatusBadge({ status }: { status: string }) {
  const bg = status === "active" ? colors.successBg : status === "paused" ? colors.infoBg : colors.dangerBg;
  const fg = status === "active" ? colors.success : status === "paused" ? colors.info : colors.danger;
  const label = status === "active" ? "Working" : status === "paused" ? "Paused" : "Retired";

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function NfcStatus({ stand }: { stand: StandItem }) {
  if (!stand.nfcProvisionedAt) return null;

  const needsRewrite =
    stand.tokenRotatedAt !== null &&
    new Date(stand.tokenRotatedAt) > new Date(stand.nfcProvisionedAt);

  return (
    <View
      style={[
        styles.nfcBanner,
        { backgroundColor: needsRewrite ? colors.dangerBg : colors.successBg },
      ]}
    >
      <Text
        style={[
          styles.nfcText,
          { color: needsRewrite ? colors.danger : colors.success },
        ]}
      >
        {needsRewrite
          ? "NFC tag needs rewriting — code was changed"
          : "NFC tag written"}
      </Text>
    </View>
  );
}

function StandCard({ item }: { item: StandItem }) {
  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(`/stand/${item.standId}`)}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label} numberOfLines={1}>
            {item.label}
          </Text>
          <Text style={styles.tokenPrefix}>
            Code {item.tokenPrefix}…
            {item.standType === "physical_nfc" ? " · NFC" : ""}
          </Text>
        </View>
        <StandStatusBadge status={item.status} />
      </View>

      <NfcStatus stand={item} />

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Created {relativeTime(item.createdAt)}</Text>
        {item.lastOpenedAt && (
          <Text style={styles.metaText}>Last scan {relativeTime(item.lastOpenedAt)}</Text>
        )}
      </View>

      {item.standType === "physical_nfc" && !item.nfcProvisionedAt && (
        <View style={[styles.nfcBanner, { backgroundColor: colors.infoBg }]}>
          <Text style={[styles.nfcText, { color: colors.info }]}>
            NFC tag not yet written. Use the Write NFC feature to provision this stand.
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function StandsScreen() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId;
  const { stands, loading, refreshing, error, refresh } = useStands(orgId);

  // One section per location, so writing a tag starts the way the owner
  // thinks about it: pick the location, then pick the stand.
  const sections = useMemo(() => {
    const byLocation = new Map<string, { title: string; data: StandItem[] }>();
    for (const stand of stands) {
      const key = stand.locationId;
      const existing = byLocation.get(key);
      if (existing) {
        existing.data.push(stand);
      } else {
        byLocation.set(key, {
          title: stand.locationName ?? "Location",
          data: [stand],
        });
      }
    }
    return [...byLocation.values()];
  }, [stands]);

  useFocusEffect(
    useCallback(() => {
      if (orgId) void refresh();
    }, [orgId, refresh]),
  );

  if (loading && stands.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator size="large" color={colors.brandText} />
      </SafeAreaView>
    );
  }

  if (error && stands.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.standId}
        renderItem={({ item }) => <StandCard item={item} />}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.brandText}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No stands yet</Text>
            <Text style={styles.emptyDesc}>
              Create a stand from the web dashboard to get started.
            </Text>
          </View>
        }
      />
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
    paddingHorizontal: 24,
  },
  list: { padding: 16, gap: 12 },
  sectionHeader: {
    fontSize: 14,
    color: colors.inkMuted,
    marginTop: 8,
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    ...fonts.label,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  label: {
    fontSize: 17,
    color: colors.ink,
    ...fonts.subheading,
  },
  tokenPrefix: {
    fontSize: 13,
    color: colors.inkMuted,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.badge,
  },
  badgeText: {
    fontSize: 12,
    ...fonts.label,
  },
  metaRow: {
    marginTop: 12,
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: colors.inkFaint,
  },
  nfcBanner: {
    marginTop: 10,
    padding: 10,
    borderRadius: radii.control,
  },
  nfcText: {
    fontSize: 13,
    ...fonts.label,
  },
  errorText: {
    color: colors.danger,
    fontSize: 15,
    textAlign: "center",
  },
  emptyTitle: {
    fontSize: 18,
    color: colors.ink,
    marginBottom: 8,
    ...fonts.subheading,
  },
  emptyDesc: {
    fontSize: 14,
    color: colors.inkMuted,
    textAlign: "center",
  },
});
