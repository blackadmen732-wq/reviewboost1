import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect } from "react";
import { useFeedbackDetail } from "@/data/use-feedback";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/components/relative-time";
import { colors, radii, fonts } from "@/theme";

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
        <ActivityIndicator style={styles.spinner} size="large" color={colors.brand} />
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
  encryptedHint: { fontStyle: "italic", color: colors.inkFaint },
  actionRow: { marginTop: 20 },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  actionText: { fontSize: 14, ...fonts.subheading, color: colors.ink },
  resolveButton: { backgroundColor: colors.brand, borderColor: colors.brand },
  resolveText: { color: colors.white },
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
  spinner: { marginTop: 60 },
});
