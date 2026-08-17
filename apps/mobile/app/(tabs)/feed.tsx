import { View, Text, FlatList, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { MOCK_LIVE_FEED } from "@/data/mock";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/components/relative-time";
import type { LiveFeedEntry } from "@/data/types";

function FeedCard({ item }: { item: LiveFeedEntry }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.badge,
            { backgroundColor: item.type === "feedback" ? "#EFF6FF" : "#F0FDF4" },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              { color: item.type === "feedback" ? "#2563EB" : "#16A34A" },
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

      <Text style={styles.location}>{item.locationName}</Text>
    </View>
  );
}

export default function FeedScreen() {
  const { activeOrg } = useAuth();

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.orgBar}>
        <Text style={styles.orgName}>{activeOrg?.name ?? "—"}</Text>
      </View>
      <FlatList
        data={MOCK_LIVE_FEED}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FeedCard item={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No activity yet</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  orgBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  orgName: { fontSize: 15, fontWeight: "600", color: "#111827" },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 12, fontWeight: "600" },
  time: { fontSize: 12, color: "#9CA3AF" },
  ratingRow: { marginTop: 8 },
  location: { fontSize: 13, color: "#6B7280", marginTop: 6 },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 40, fontSize: 15 },
});
