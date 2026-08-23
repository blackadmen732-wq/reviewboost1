import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/data/auth-context";
import { MOCK_FEEDBACK } from "@/data/mock";
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
  const items = MOCK_FEEDBACK.filter((f) => f.orgId === activeOrg?.orgId);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FeedbackRow item={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No feedback yet</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
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
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
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
  noteCount: { fontSize: 12, color: colors.inkMuted, marginTop: 6 },
  empty: { textAlign: "center", color: colors.inkFaint, marginTop: 40, fontSize: 15 },
});
