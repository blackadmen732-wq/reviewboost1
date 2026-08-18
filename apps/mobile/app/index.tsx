import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "@/data/auth-context";

export default function Index() {
  const { isLoggedIn, isLoading, activeOrg } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  if (!isLoggedIn) return <Redirect href="/login" />;
  if (!activeOrg) return <Redirect href="/select-org" />;
  return <Redirect href="/(tabs)/feed" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FFFFFF" },
});
