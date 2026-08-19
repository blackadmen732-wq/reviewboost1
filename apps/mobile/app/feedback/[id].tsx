import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect } from "react";
import { useFeedbackDetail } from "@/data/use-feedback";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/components/relative-time";

export default function FeedbackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { item, notes, loading, error, markRead, resolve, reopen } =
    useFeedbackDetail(id);

  useEffect(() => {
    if (item && !item.isRead) {
      markRead();
    }
  }, [item?.id, item?.isRead]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: "Feedback", headerShown: true }} />
        <ActivityIndicator style={styles.spinner} size="large" color="#2563EB" />
      </SafeAreaView>
    );
  }

  if (error || !item) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: "Not found", headerShown: true }} />
        <Text style={styles.empty}>{error ?? "Feedback not found"}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: "Feedback",
          headerShown: true,
          headerStyle: { backgroundColor: "#FFFFFF" },
          headerTitleStyle: { fontWeight: "600", color: "#111827" },
          headerTintColor: "#2563EB",
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
            {item.note === "[encrypted]" ? (
              <Text style={[styles.noteText, styles.encryptedHint]}>
                Note content is encrypted
              </Text>
            ) : (
              <Text style={styles.noteText}>{item.note}</Text>
            )}
          </View>
        )}

        <View style={styles.actionRow}>
          {item.isResolved ? (
            <Pressable style={styles.actionButton} onPress={reopen}>
              <Text style={styles.actionText}>Reopen</Text>
            </Pressable>
          ) : (
            <Pressable style={[styles.actionButton, styles.resolveButton]} onPress={resolve}>
              <Text style={[styles.actionText, styles.resolveText]}>Mark resolved</Text>
            </Pressable>
          )}
        </View>

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
                {note.body === "[encrypted]" ? (
                  <Text style={[styles.noteBody, styles.encryptedHint]}>
                    Note content is encrypted
                  </Text>
                ) : (
                  <Text style={styles.noteBody}>{note.body}</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { padding: 20 },
  ratingSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  time: { fontSize: 13, color: "#9CA3AF" },
  statusRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  badge: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { fontSize: 12, fontWeight: "600", color: "#2563EB" },
  badgeResolved: { backgroundColor: "#F0FDF4" },
  badgeResolvedText: { color: "#16A34A" },
  noteSection: { marginTop: 24 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#6B7280", marginBottom: 8 },
  noteText: { fontSize: 16, color: "#111827", lineHeight: 24 },
  encryptedHint: { fontStyle: "italic", color: "#9CA3AF" },
  actionRow: { marginTop: 20 },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignSelf: "flex-start",
  },
  actionText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  resolveButton: { backgroundColor: "#16A34A", borderColor: "#16A34A" },
  resolveText: { color: "#FFFFFF" },
  notesSection: { marginTop: 28 },
  ownerNote: {
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  noteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  noteAuthor: { fontSize: 13, fontWeight: "600", color: "#374151" },
  noteTime: { fontSize: 12, color: "#9CA3AF" },
  noteBody: { fontSize: 14, color: "#374151", lineHeight: 20 },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 40, fontSize: 15 },
  spinner: { marginTop: 60 },
});
