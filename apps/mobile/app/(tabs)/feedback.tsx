import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFeedbackList } from "@/data/use-feedback";
import { useAuth } from "@/data/auth-context";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/components/relative-time";
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
          {item.isResolved && <Text style={styles.resolvedCheck}>✓</Text>}
          <Stars rating={item.rating} size={14} />
        </View>
        <Text style={styles.time}>{relativeTime(item.submittedAt)}</Text>
      </View>

      {item.note && item.note !== "[encrypted]" && (
        <Text style={styles.note} numberOfLines={2}>
          {item.note}
        </Text>
      )}
      {item.note === "[encrypted]" && (
        <Text style={[styles.note, styles.encryptedHint]} numberOfLines={1}>
          Customer left a note
        </Text>
      )}

      {item.noteCount > 0 && (
        <Text style={styles.noteCount}>
          {item.noteCount} note{item.noteCount !== 1 ? "s" : ""}
        </Text>
      )}
    </Pressable>
  );
}

export default function FeedbackListScreen() {
  const { activeOrg } = useAuth();
  const { items, loading, error, refetch } = useFeedbackList();

  if (!activeOrg) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <Text style={styles.empty}>Select an organization to view feedback</Text>
      </SafeAreaView>
    );
  }

  if (loading && items.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <ActivityIndicator style={styles.spinner} size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={refetch}>
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
        onRefresh={refetch}
        refreshing={loading}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardUnread: { borderColor: "#2563EB", backgroundColor: "#FAFBFF" },
  cardResolved: { opacity: 0.7 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2563EB",
  },
  resolvedCheck: { fontSize: 14, color: "#16A34A", fontWeight: "700" },
  time: { fontSize: 12, color: "#9CA3AF" },
  note: { fontSize: 14, color: "#374151", marginTop: 8, lineHeight: 20 },
  encryptedHint: { fontStyle: "italic", color: "#9CA3AF" },
  noteCount: { fontSize: 12, color: "#6B7280", marginTop: 6 },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 40, fontSize: 15 },
  spinner: { marginTop: 60 },
  errorText: { textAlign: "center", color: "#DC2626", marginTop: 40, fontSize: 15 },
  retryButton: {
    alignSelf: "center",
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#2563EB",
    borderRadius: 8,
  },
  retryText: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },
});
