import { View, Text, FlatList, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { MOCK_LIVE_FEED } from "@/data/mock";
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

      <Text style={styles.location}>{item.locationName}</Text>
    </View>
  );
}

export default function FeedScreen() {
  const { activeOrg } = useAuth();
  const feed = MOCK_LIVE_FEED.filter((e) => e.orgId === activeOrg?.orgId);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.orgBar}>
        <Text style={styles.orgName}>{activeOrg?.name ?? "—"}</Text>
      </View>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FeedCard item={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No activity yet</Text>}
      />
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
});
