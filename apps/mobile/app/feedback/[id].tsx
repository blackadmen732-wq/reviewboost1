import { useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { useFeedbackDetail } from "@/data/use-feedback-detail";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/components/relative-time";
import { colors, radii, fonts } from "@/theme";

export default function FeedbackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId;
  const { item, loading, error, notFound, load } = useFeedbackDetail(
    orgId,
    id,
  );

  useEffect(() => {
    load();
  }, [load]);

  if (notFound) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: "Not found", headerShown: true }} />
        <Text style={styles.empty}>Feedback not found</Text>
      </SafeAreaView>
    );
  }

  if (loading || !item) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen
          options={{
            title: "Feedback",
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTitleStyle: { ...fonts.subheading, color: colors.ink },
            headerTintColor: colors.brandText,
          }}
        />
        {error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryButton} onPress={load} accessibilityRole="button">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator
            style={styles.spinner}
            size="large"
            color={colors.brandText}
          />
        )}
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
          headerTintColor: colors.brandText,
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
              <Text style={[styles.badgeText, styles.badgeResolvedText]}>
                Resolved
              </Text>
            </View>
          )}
        </View>

        {item.note && (
          <View style={styles.noteSection}>
            <Text style={styles.sectionTitle}>Customer note</Text>
            <Text style={styles.noteText}>{item.note}</Text>
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
  sectionTitle: {
    fontSize: 14,
    ...fonts.subheading,
    color: colors.inkMuted,
    marginBottom: 8,
  },
  noteText: { fontSize: 16, color: colors.ink, lineHeight: 24 },
  empty: {
    textAlign: "center",
    color: colors.inkFaint,
    marginTop: 40,
    fontSize: 15,
  },
  spinner: { marginTop: 60 },
  centered: { alignItems: "center", marginTop: 40, paddingHorizontal: 20 },
  errorText: {
    fontSize: 15,
    color: colors.danger,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: colors.brandText,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: radii.control,
  },
  retryText: { color: "#fff", ...fonts.subheading, fontSize: 14 },
});
