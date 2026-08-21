import { Redirect } from "expo-router";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "@/data/auth-context";
import { colors } from "@/theme";

export default function Index() {
  const { isLoggedIn, isLoading, activeOrg } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!isLoggedIn) return <Redirect href="/login" />;
  if (!activeOrg) return <Redirect href="/select-org" />;
  return <Redirect href="/(tabs)/feed" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.canvas },
});
