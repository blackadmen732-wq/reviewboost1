import { View, Text, Pressable, StyleSheet, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { MOCK_LOCATIONS } from "@/data/mock";
import type { Organization } from "@/data/types";

export default function SelectOrgScreen() {
  const { organizations, selectOrg, name } = useAuth();
  const router = useRouter();

  const handleSelect = (orgId: string) => {
    selectOrg(orgId);
    router.replace("/(tabs)/feed");
  };

  const renderOrg = ({ item }: { item: Organization }) => {
    const locations = MOCK_LOCATIONS.filter((l) => l.orgId === item.orgId);
    return (
      <Pressable style={styles.card} onPress={() => handleSelect(item.orgId)}>
        <Text style={styles.orgName}>{item.name}</Text>
        <Text style={styles.role}>{item.role}</Text>
        <Text style={styles.locationCount}>
          {locations.length} location{locations.length !== 1 ? "s" : ""}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome back, {name}</Text>
        <Text style={styles.subtitle}>Select an organization</Text>
      </View>
      <FlatList
        data={organizations}
        keyExtractor={(item) => item.orgId}
        renderItem={renderOrg}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  greeting: { fontSize: 24, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 15, color: "#6B7280", marginTop: 4 },
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
  locationCount: { fontSize: 13, color: "#9CA3AF", marginTop: 6 },
});
