import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { colors, radii, fonts } from "@/theme";
import type { Organization } from "@/data/types";

export default function SelectOrgScreen() {
  const { organizations, selectOrg, name, logout, orgLoading, orgError, retryOrgs } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleSelect = (orgId: string) => {
    selectOrg(orgId);
    router.replace("/(tabs)/feed");
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    const error = await logout();
    if (error) {
      setLogoutError(error);
      setLoggingOut(false);
      return;
    }
    router.replace("/login");
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>Welcome back, {name}</Text>
            <Text style={styles.subtitle}>Select an organization</Text>
          </View>
          <Pressable
            style={styles.logoutButton}
            onPress={handleLogout}
            disabled={loggingOut}
            accessibilityRole="button"
          >
            <Text style={styles.logoutText}>
              {loggingOut ? "Signing out…" : "Sign out"}
            </Text>
          </Pressable>
        </View>
        {logoutError && <Text style={styles.errorText}>{logoutError}</Text>}
      </View>
      <FlatList
        data={organizations}
        keyExtractor={(item) => item.orgId}
        renderItem={({ item }: { item: Organization }) => (
          <Pressable
            style={styles.card}
            onPress={() => handleSelect(item.orgId)}
            accessibilityRole="button"
          >
            <Text style={styles.orgName}>{item.name}</Text>
            <Text style={styles.role}>{item.role}</Text>
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          orgLoading ? (
            <ActivityIndicator size="large" color={colors.brand} style={styles.spinner} />
          ) : orgError ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{orgError}</Text>
              <Pressable style={styles.retryButton} onPress={retryOrgs} accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.empty}>No organizations found for this account</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerText: { flex: 1 },
  greeting: { fontSize: 24, ...fonts.heading, color: colors.ink },
  subtitle: { fontSize: 15, color: colors.inkMuted, marginTop: 4 },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.badge,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginTop: 4,
  },
  logoutText: { fontSize: 13, color: colors.inkMuted, ...fonts.label },
  list: { padding: 24, gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: 16,
    backgroundColor: colors.surface,
  },
  orgName: { fontSize: 18, ...fonts.subheading, color: colors.ink },
  role: { fontSize: 14, color: colors.inkMuted, marginTop: 2, textTransform: "capitalize" },
  empty: { textAlign: "center", color: colors.inkFaint, marginTop: 40, fontSize: 15 },
  errorContainer: { alignItems: "center", marginTop: 40 },
  errorText: { textAlign: "center", color: colors.danger, fontSize: 14 },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.brand,
    borderRadius: radii.badge,
  },
  retryText: { color: colors.white, ...fonts.subheading, fontSize: 14 },
  spinner: { marginTop: 40 },
});
