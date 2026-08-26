import { useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/data/auth-context";
import { useFeedback } from "@/data/use-feedback";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/components/relative-time";
import { colors, radii, fonts } from "@/theme";
import type { FeedbackItem } from "@/data/types";

function FeedbackRow({ item }: { item: FeedbackItem }) {
  const router = useRouter();

  return (
    <Pressable
      style={[
        styles.card,
        !item.isRead && styles.cardUnread,
        item.isResolved && styles.cardResolved,
      ]}
      onPress={() => router.push(`/feedback/${item.id}`)}
    >
      <View style={styles.topRow}>
        <View style={styles.statusRow}>
          {!item.isRead && <View style={styles.unreadDot} />}
          {item.isResolved && <Text style={styles.resolvedCheck}>{"✓"}</Text>}
          <Stars rating={item.rating} size={14} />
        </View>
        <Text style={styles.time}>{relativeTime(item.submittedAt)}</Text>
      </View>

      {item.note && (
        <Text style={styles.note} numberOfLines={2}>
          {item.note}
        </Text>
      )}
    </Pressable>
  );
}

export default function FeedbackListScreen() {
  const { activeOrg } = useAuth();
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
  } = useFeedback(activeOrg?.orgId);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && items.length === 0) {
    return (
      <SafeAreaView style={styles.centered} edges={["bottom"]}>
        <ActivityIndicator size="large" color={colors.brand} />
      </SafeAreaView>
    );
  }

  if (error && items.length === 0) {
    return (
      <SafeAreaView style={styles.centered} edges={["bottom"]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={load}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FeedbackRow item={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No feedback yet</Text>}
        refreshing={refreshing}
        onRefresh={refresh}
        onEndReached={hasMore ? loadMore : undefined}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator
              style={styles.footer}
              size="small"
              color={colors.brand}
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  centered: {
    flex: 1,
    backgroundColor: colors.canvas,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardUnread: { borderColor: colors.brand, backgroundColor: "#f2faf6" },
  cardResolved: { opacity: 0.7 },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand,
  },
  resolvedCheck: { fontSize: 14, color: colors.success, ...fonts.heading },
  time: { fontSize: 12, color: colors.inkFaint },
  note: { fontSize: 14, color: colors.ink, marginTop: 8, lineHeight: 20 },
  empty: {
    textAlign: "center",
    color: colors.inkFaint,
    marginTop: 40,
    fontSize: 15,
  },
  errorText: {
    fontSize: 15,
    color: colors.danger,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: colors.brand,
    borderRadius: radii.control,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryText: { color: colors.onBrand, fontSize: 15, ...fonts.subheading },
  footer: { paddingVertical: 16 },
});
