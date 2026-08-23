import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { MOCK_FEEDBACK, MOCK_NOTES } from "@/data/mock";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/components/relative-time";
import { colors, radii, fonts } from "@/theme";

export default function FeedbackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeOrg } = useAuth();
  const item = MOCK_FEEDBACK.find(
    (f) => f.id === id && f.orgId === activeOrg?.orgId,
  );
  const notes = MOCK_NOTES[id ?? ""] ?? [];

  if (!item) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: "Not found", headerShown: true }} />
        <Text style={styles.empty}>Feedback not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: "Feedback",
          headerShown: true,
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { ...fonts.subheading, color: colors.ink },
          headerTintColor: colors.brand,
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.ratingSection}>
          <Stars rating={item.rating} size={24} />
          <Text style={styles.time}>{relativeTime(item.submittedAt)}</Text>
        </View>

        <View style={styles.statusRow}>
          {!item.isRead && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Unread</Text>
            </View>
          )}
          {item.isResolved && (
            <View style={[styles.badge, styles.badgeResolved]}>
              <Text style={[styles.badgeText, styles.badgeResolvedText]}>Resolved</Text>
            </View>
          )}
        </View>

        {item.note && (
          <View style={styles.noteSection}>
            <Text style={styles.sectionTitle}>Customer note</Text>
            <Text style={styles.noteText}>{item.note}</Text>
          </View>
        )}

        {notes.length > 0 && (
          <View style={styles.notesSection}>
            <Text style={styles.sectionTitle}>
              Owner notes ({notes.length})
            </Text>
            {notes.map((note) => (
              <View key={note.id} style={styles.ownerNote}>
                <View style={styles.noteHeader}>
                  <Text style={styles.noteAuthor}>{note.authorName}</Text>
                  <Text style={styles.noteTime}>{relativeTime(note.createdAt)}</Text>
                </View>
                <Text style={styles.noteBody}>{note.body}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20 },
  ratingSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  time: { fontSize: 13, color: colors.inkFaint },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  badge: {
    backgroundColor: colors.infoBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.badge,
  },
  badgeText: { fontSize: 12, ...fonts.subheading, color: colors.info },
  badgeResolved: { backgroundColor: colors.successBg },
  badgeResolvedText: { color: colors.success },
  noteSection: { marginTop: 24 },
  sectionTitle: { fontSize: 14, ...fonts.subheading, color: colors.inkMuted, marginBottom: 8 },
  noteText: { fontSize: 16, color: colors.ink, lineHeight: 24 },
  notesSection: { marginTop: 28 },
  ownerNote: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.control,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  noteAuthor: { fontSize: 13, ...fonts.subheading, color: colors.ink },
  noteTime: { fontSize: 12, color: colors.inkFaint },
  noteBody: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  empty: { textAlign: "center", color: colors.inkFaint, marginTop: 40, fontSize: 15 },
});
