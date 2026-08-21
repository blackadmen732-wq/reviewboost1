import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import type { Organization } from "@/data/types";

export default function SelectOrgScreen() {
  const { organizations, selectOrg, name, logout, orgLoading, orgError } = useAuth();
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
            <ActivityIndicator size="large" color="#2563EB" style={styles.spinner} />
          ) : orgError ? (
            <Text style={styles.errorText}>{orgError}</Text>
          ) : (
            <Text style={styles.empty}>No organizations found for this account</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerText: { flex: 1 },
  greeting: { fontSize: 24, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 15, color: "#6B7280", marginTop: 4 },
  logoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    marginTop: 4,
  },
  logoutText: { fontSize: 13, color: "#6B7280", fontWeight: "500" },
  list: { padding: 24, gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 16,
    backgroundColor: "#F9FAFB",
  },
  orgName: { fontSize: 18, fontWeight: "600", color: "#111827" },
  role: { fontSize: 14, color: "#6B7280", marginTop: 2, textTransform: "capitalize" },
  empty: { textAlign: "center", color: "#9CA3AF", marginTop: 40, fontSize: 15 },
  errorText: { textAlign: "center", color: "#DC2626", marginTop: 12, fontSize: 14 },
  spinner: { marginTop: 40 },
});
