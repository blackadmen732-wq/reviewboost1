import { useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { useLiveFeed } from "@/data/use-live-feed";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/components/relative-time";
import { colors, radii, fonts } from "@/theme";
import type { LiveFeedEntry } from "@/data/types";

function FeedCard({ item }: { item: LiveFeedEntry }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.badge,
            { backgroundColor: item.type === "feedback" ? colors.infoBg : colors.successBg },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              { color: item.type === "feedback" ? colors.info : colors.success },
            ]}
          >
            {item.type === "feedback" ? "Feedback" : "Stand tap"}
          </Text>
        </View>
        <Text style={styles.time}>{relativeTime(item.submittedAt)}</Text>
      </View>

      {item.rating !== null && (
        <View style={styles.ratingRow}>
          <Stars rating={item.rating} />
        </View>
      )}

      <Text style={styles.location}>{item.locationName ?? "Unknown location"}</Text>
    </View>
  );
}

export default function FeedScreen() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId;
  const {
    items,
    loading,
    refreshing,
    error,
    hasMore,
    loadingMore,
    load,
    refresh,
    loadMore,
  } = useLiveFeed(orgId);

  useEffect(() => {
    if (orgId) void load();
  }, [orgId, load]);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.orgBar}>
        <Text style={styles.orgName}>{activeOrg?.name ?? "—"}</Text>
      </View>
      {error && items.length === 0 ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Couldn’t load activity.</Text>
          <Pressable onPress={() => void load()} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <FeedCard item={item} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore && !loadingMore) void loadMore();
          }}
          ListEmptyComponent={
            loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : (
              <Text style={styles.empty}>No activity yet</Text>
            )
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  orgBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  orgName: { fontSize: 15, ...fonts.subheading, color: colors.ink },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.badge },
  badgeText: { fontSize: 12, ...fonts.subheading },
  time: { fontSize: 12, color: colors.inkFaint },
  ratingRow: { marginTop: 8 },
  location: { fontSize: 13, color: colors.inkMuted, marginTop: 6 },
  empty: { textAlign: "center", color: colors.inkFaint, marginTop: 40, fontSize: 15 },
  loadingBox: { marginTop: 40, alignItems: "center" },
  footerLoading: { paddingVertical: 16, alignItems: "center" },
  errorBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  errorText: { fontSize: 15, color: colors.ink, textAlign: "center" },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.brand,
    borderRadius: radii.control,
  },
  retryText: { color: colors.onBrand, ...fonts.subheading, fontSize: 14 },
});
