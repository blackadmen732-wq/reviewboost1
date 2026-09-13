import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { colors, radii, fonts } from "@/theme";

export default function SettingsScreen() {
  const { activeOrg, email, logout } = useAuth();

  function confirmSignOut() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void logout() },
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>Business</Text>
          <Text style={styles.value}>{activeOrg?.name ?? "—"}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{email ?? "—"}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Help</Text>
          <Text style={styles.helpText}>
            Questions? Email help@reviewboost.app — we answer every message.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Privacy</Text>
          <Text style={styles.helpText}>
            We never ask customers for a name, phone number, or email. Private
            notes are locked so only you can read them.
          </Text>
        </View>

        <Pressable style={styles.signOutButton} onPress={confirmSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    fontSize: 13,
    color: colors.inkMuted,
    marginBottom: 4,
    ...fonts.label,
  },
  value: {
    fontSize: 16,
    color: colors.ink,
    ...fonts.subheading,
  },
  helpText: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
  },
  signOutButton: {
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
  },
  signOutText: {
    color: colors.danger,
    fontSize: 15,
    ...fonts.subheading,
  },
});
